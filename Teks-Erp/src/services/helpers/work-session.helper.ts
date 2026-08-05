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
    // Birden çok açık oturum kalırsa (offline/kesinti kalıntısı) EN YENİSİ geçerli —
    // orderBy olmadan findFirst rastgele/eski birini döndürüp yanlış 409'a yol açardı.
    orderBy: { startedAt: 'desc' },
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
 *   çalışır.
 *   ⚠️ Bu satır bir süre "Electron DA x-device-id gönderir; kind ayrımı bu
 *   yüzden şart" diyordu ve YANLIŞTI. Electron `x-device-id` GÖNDERMEZ
 *   (`Electron/src/services/apiClient.ts`, gerekçesi orada: cihaz-eşleştirme
 *   kilidi). Dev DB'de DESKTOP cihaz kayıtları var ama onlar
 *   `/api/devices/announce` ile doğdu; normal isteklerde başlık yoktur.
 *   Pratik sonucu: panelden yapılan girişlerde `req.device` YOK → oturum yok →
 *   `Roll.entryStationId` NULL kalır ve bu MEŞRUDUR (istasyon bağlamı gerçekten
 *   yoktur). Bu yorumu okuyup "Electron'da da oturum vardır" varsayma.
 * - Tx DIŞINDA çağrılmalı (tx süresi kısa kuralı) — indexed tek sorgu + tembel idle.
 */
export async function getStampContext(
  req: { device?: { id: string; kind?: string }; user?: { userId?: string } },
  opts?: { enforceForMobile?: boolean },
): Promise<StampContext | null> {
  if (!req.device) return null;
  let session = await resolveActiveSession(req.device.id);
  // Öz-onarım: oturum BAŞKA kullanıcıya aitse (önceki kullanıcının logout'u
  // kaçmış kalıntı) ASLA benimseme — üretim atfı yanlış kişiye yazılırdı
  // ("ayak izinde eski kullanıcı hâlâ aktif" saha bug'ı). Kalıntıyı vardiya
  // değişimi (NEW_LOGIN) ile kapat; akış "oturum yok" dalına düşer → mobilde
  // yer onayı yeni kullanıcı adına taze oturum açar.
  let selfRepaired = false;
  if (session && req.user?.userId && session.userId !== req.user.userId) {
    await prisma.workSession.updateMany({
      where: { id: session.id, endedAt: null },
      data: { endedAt: new Date(), endReason: "NEW_LOGIN" as WorkSessionEndReason },
    });
    session = null;
    selfRepaired = true;
  }
  if (!session) {
    if (opts?.enforceForMobile && req.device.kind !== "DESKTOP") {
      // F223: Öz-onarımla yabancı kalıntıyı BİZ az önce NEW_LOGIN ile kapattık →
      // SON kapanan satır tam da o. Onu "sebep" olarak göstermek bu operatöre
      // yanıltıcı olur ("başka yerde giriş yapıldı"): gerçek sebep "bu cihazda
      // sana ait oturum yok". Generic dön (reason=null → client varsayılan mesaj).
      if (selfRepaired) {
        throw AppError.conflict(
          "Bu cihazda aktif çalışma oturumu yok — önce makine/istasyon onayı verin",
          { code: "WORK_SESSION_REQUIRED", reason: null, takenBy: null },
        );
      }
      // Sebebi ekle: bu cihazın SON kapanan oturumunun endReason'ı → client doğru
      // bildirim gösterir (devralındı=TAKEOVER / hareketsizlik=IDLE / başka yerde
      // giriş=NEW_LOGIN / yönetici=ADMIN). Aktif oturum yeni kapandıysa bu odur.
      const last = await prisma.workSession.findFirst({
        where: { deviceId: req.device.id, endedAt: { not: null } },
        orderBy: { endedAt: "desc" },
        select: { endReason: true, machineId: true },
      });
      // Devralma ise: o makineyi ŞU AN kim tutuyor → operatöre "X devraldı" yaz.
      let takenBy: string | null = null;
      if (last?.endReason === "TAKEOVER" && last.machineId) {
        const holder = await prisma.workSession.findFirst({
          where: { machineId: last.machineId, endedAt: null },
          orderBy: { startedAt: "desc" },
          select: { user: { select: { fullName: true, username: true } } },
        });
        takenBy = holder?.user?.fullName ?? holder?.user?.username ?? null;
      }
      throw AppError.conflict(
        "Bu cihazda aktif çalışma oturumu yok — önce makine/istasyon onayı verin",
        { code: "WORK_SESSION_REQUIRED", reason: last?.endReason ?? null, takenBy },
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
