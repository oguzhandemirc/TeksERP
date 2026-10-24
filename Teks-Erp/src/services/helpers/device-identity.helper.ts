// =============================================================================
// Cihaz kimliği (eşleme v2) — fiziksel cihaz ↔ kurulum anahtarı ↔ bağlama defteri
// =============================================================================
// Fiziksel cihaz = KİMLİK (`devices.id`); `devices.deviceId` = ETKİN kurulum anahtarı
// (localId), yalnız yeniden bağlamayla değişir; eski anahtarlar `device_binding_events`
// defterinde durur. `mergedIntoId` okuyucusu YALNIZ bu dosyadır (AST bekçisi
// `test_cihaz_yeniden_baglama`): "hangi fiziksel cihaz" sorusu tek boğazdan cevaplanır.
// =============================================================================

import { createHmac } from "node:crypto";
import { Prisma, type DeviceBindingEventType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

/** İstemcinin okuyabildiği kararlı donanım kimliği kaynakları (D2/D3 bayt-eşit). */
export const HW_SOURCES = ["ANDROID_ID", "WIN_MACHINE_GUID", "MAC_PLATFORM_UUID", "LINUX_MACHINE_ID"] as const;
export type HwSource = (typeof HW_SOURCES)[number];
export const HW_DIGEST_RE = /^[0-9a-f]{64}$/;
const HW_DIGEST_DOMAIN = "tekserp/cihaz-donanim/v1";

/** İstemcinin gönderdiği donanım özeti (`hw`). Kimlik DOĞRULAMAZ, yalnız tanır. */
export interface HwClaim {
  v: 1;
  kaynak: HwSource;
  ozet: string;
}

/**
 * Sözleşmenin backend ikizi: `ozet = HMAC-SHA256(installationId, domain\nkaynak\nham)`, küçük hex.
 * Sunucu özeti hesaplamaz (ham değer cihazdan çıkmaz); bu fonksiyon test vektörünün tek kaynağıdır.
 */
export function computeHwDigest(installationId: string, kaynak: HwSource, ham: string): string {
  return createHmac("sha256", installationId).update(`${HW_DIGEST_DOMAIN}\n${kaynak}\n${ham}`).digest("hex");
}

/** Canlı (birleşmemiş) cihaz yüklemi — tavanlar ve donanım eşleşmesi buradan okur. */
const LIVE: Prisma.DeviceWhereInput = { mergedIntoId: null };

/** Canlı cihaz WHERE parçası — yazıcıların atomik claim'i bu parçayla kurulur (tek kaynak). */
export function liveDeviceWhere(): Prisma.DeviceWhereInput {
  return { ...LIVE };
}

/** Fiziksel cihaz kimliği: birleşmiş kopya ana kayda bir adımda çözülür (zincir DB'de yasak). */
export function physicalDeviceId(row: { id: string; mergedIntoId: string | null }): string {
  return row.mergedIntoId ?? row.id;
}

/**
 * Koltuk sayımı: aktif ∧ birleşmemiş cihaz. `MAX_DEVICE_ROWS`/`MAX_PENDING_DEVICES` tavanları ve
 * (ileride) lisans koltuğu bu tek sayımdan okur — pasif kopyalar tavanı yemez.
 */
export function countSeatDevices(db: Db, extra: Prisma.DeviceWhereInput = {}): Promise<number> {
  return db.device.count({ where: { ...extra, isActive: true, ...LIVE } });
}

/** Toplam (aktif) cihaz satırı tavanı — gerekçe `device.service.ts` MAX_DEVICE_ROWS şerhi. */
export const MAX_DEVICE_ROWS = 500;

/** Yeni cihaz satırı açmadan önce: aktif sayım tavanı (rejimden bağımsız). */
export async function assertDeviceRowCapacity(db: Db): Promise<void> {
  if ((await countSeatDevices(db)) >= MAX_DEVICE_ROWS) {
    throw AppError.tooManyRequests(
      `Kayıtlı cihaz sayısı üst sınıra ulaştı (${MAX_DEVICE_ROWS}). ` +
        `Yönetici panelinden kullanılmayan cihazları kaldırın.`,
      { code: "DEVICE_LIMIT" },
    );
  }
}

export type HwMatch = {
  id: string;
  deviceId: string;
  name: string;
  isActive: boolean;
  status: string;
};

/** Donanım özetiyle canlı cihaz (kısmi UNIQUE gereği en çok bir). */
export function findLiveDeviceByHw(db: Db, hwDigest: string): Promise<HwMatch | null> {
  return db.device.findFirst({
    where: { hwDigest, ...LIVE },
    select: { id: true, deviceId: true, name: true, isActive: true, status: true },
  });
}

/** Bağlama defterinin TEK yazarı (append-only; satır değişmez, ters yol karşı olaydır). */
export async function writeBindingEventTx(
  db: Db,
  e: {
    deviceRefId: string | null;
    localId: string;
    deviceName: string;
    event: DeviceBindingEventType;
    actorId?: string | null;
    reason?: string | null;
    hwDigest?: string | null;
    meta?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.deviceBindingEvent.create({
    data: {
      deviceRefId: e.deviceRefId,
      localId: e.localId.slice(0, 64),
      deviceName: e.deviceName.slice(0, 120),
      event: e.event,
      actorId: e.actorId ?? null,
      reason: e.reason ? e.reason.slice(0, 300) : null,
      hwDigest: e.hwDigest ?? null,
      ...(e.meta !== undefined ? { meta: e.meta } : {}),
    },
  });
}

/** Aynı (cihaz, özet) çakışması zaten deftere yazıldı mı — her announce'ta tekrar yazılmasın. */
export async function hasHwConflictEvent(db: Db, deviceRefId: string, hwDigest: string): Promise<boolean> {
  const row = await db.deviceBindingEvent.findFirst({
    where: { deviceRefId, event: "HW_CONFLICT", hwDigest },
    select: { id: true },
  });
  return row !== null;
}

/**
 * localId → fiziksel cihaz: önce etkin anahtar, yoksa defterdeki en son bağlama (eski anahtar);
 * birleşmiş kopya ana kayda çözülür. Metin kolonlu ayak izi (Session/SystemLog `deviceId`) bu
 * yoldan okunur — o tablolara dokunulmaz.
 */
export async function resolvePhysicalDevice(
  db: Db,
  localId: string,
): Promise<{ id: string; name: string } | null> {
  let row = await db.device.findUnique({
    where: { deviceId: localId },
    select: { id: true, name: true, mergedIntoId: true },
  });
  if (!row) {
    const ev = await db.deviceBindingEvent.findFirst({
      where: { localId, deviceRefId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { deviceRefId: true },
    });
    if (!ev?.deviceRefId) return null;
    row = await db.device.findUnique({
      where: { id: ev.deviceRefId },
      select: { id: true, name: true, mergedIntoId: true },
    });
    if (!row) return null;
  }
  const physical = physicalDeviceId(row);
  if (physical === row.id) return { id: row.id, name: row.name };
  const main = await db.device.findUnique({ where: { id: physical }, select: { id: true, name: true } });
  return main ?? { id: row.id, name: row.name };
}
