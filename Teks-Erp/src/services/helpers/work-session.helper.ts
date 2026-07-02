// =============================================================================
// TeksERP - Work Session Helper (aktif oturum çözümü + tembel idle kapatma)
// =============================================================================
// Aktif oturumun TEK çözüm noktası. Idle enforce TEMBELDİR — arka plan timer/cron
// YOK (repo ilkesi): oturum okunduğu anda lastActivityAt, workSession.idleTimeoutMinutes
// ayarından eskiyse IDLE ile kapatılır ve null döner. lastActivityAt güncellemesi
// device.middleware'in lastSeenAt throttle'ına piggyback'tir (device.service.ts).
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readWorkSessionIdleTimeoutMinutes } from "../system-setting.service";
import type { WorkSessionEndReason } from "@prisma/client";

export interface ActiveWorkSession {
  id: string;
  userId: string;
  deviceId: string;
  machineId: string | null;
  stationId: string;
  startedAt: Date;
  lastActivityAt: Date;
}

const ACTIVE_SELECT = {
  id: true,
  userId: true,
  deviceId: true,
  machineId: true,
  stationId: true,
  startedAt: true,
  lastActivityAt: true,
} as const;

/**
 * Cihazın (devices.id — PK) aktif oturumunu çözer. Süresi dolmuşsa (idle) atomik
 * olarak IDLE ile kapatır ve null döner — force-close/yeni-open yarışının kaybedeni
 * updateMany'de 0 satır eşler (çifte kapanış yok).
 */
export async function resolveActiveSession(deviceRowId: string): Promise<ActiveWorkSession | null> {
  const session = await prisma.workSession.findFirst({
    where: { deviceId: deviceRowId, endedAt: null },
    select: ACTIVE_SELECT,
  });
  if (!session) return null;

  const idleMin = await readWorkSessionIdleTimeoutMinutes();
  if (idleMin > 0 && session.lastActivityAt.getTime() < Date.now() - idleMin * 60_000) {
    await prisma.workSession.updateMany({
      where: { id: session.id, endedAt: null },
      data: { endedAt: new Date(), endReason: "IDLE" as WorkSessionEndReason },
    });
    return null;
  }
  return session;
}

/** Üretim atfı damga bağlamı — controller'ların tek geçidi (getStampContext). */
export interface StampContext {
  sessionId: string;
  machineId: string | null;
  stationId: string;
}

/**
 * İstekteki cihazın aktif oturumundan damga bağlamını çözer (üretim atfı:
 * RollOperation/RollMovement.machineId, Roll.createdMachineId). Kurallar:
 * - req.device yok (web) → null; işlem oturumsuz devam eder (machineId=null).
 * - Aktif oturum yok/idle düştü → null; `enforceForMobile` açıksa 409
 *   WORK_SESSION_REQUIRED — mobil interceptor yer onayı ekranını yeniden açar.
 *   DESKTOP (Electron) cihazlar zorunluluktan MUAF — panel akışları oturumsuz
 *   çalışır (Electron da x-device-id gönderir; kind ayrımı bu yüzden şart).
 * - Tx DIŞINDA çağrılmalı (tx süresi kısa kuralı) — indexed tek sorgu + tembel idle.
 */
export async function getStampContext(
  req: { device?: { id: string; kind?: string } },
  opts?: { enforceForMobile?: boolean },
): Promise<StampContext | null> {
  if (!req.device) return null;
  const session = await resolveActiveSession(req.device.id);
  if (!session) {
    if (opts?.enforceForMobile && req.device.kind !== "DESKTOP") {
      throw AppError.conflict(
        "Bu cihazda aktif çalışma oturumu yok — önce makine/istasyon onayı verin",
        { code: "WORK_SESSION_REQUIRED" },
      );
    }
    return null;
  }
  return { sessionId: session.id, machineId: session.machineId, stationId: session.stationId };
}

/**
 * Süresi dolmuş TÜM açık oturumları tek updateMany ile IDLE kapatır (tembel süpürme).
 * Canlı panel (listActive) gibi "tüm açık oturumlar" okumalarına piggyback edilir —
 * timer değil, okuma anında temizlik. Kapatılan satır sayısını döner.
 */
export async function sweepIdleSessions(): Promise<number> {
  const idleMin = await readWorkSessionIdleTimeoutMinutes();
  if (idleMin <= 0) return 0;
  const cutoff = new Date(Date.now() - idleMin * 60_000);
  const res = await prisma.workSession.updateMany({
    where: { endedAt: null, lastActivityAt: { lt: cutoff } },
    data: { endedAt: new Date(), endReason: "IDLE" as WorkSessionEndReason },
  });
  return res.count;
}
