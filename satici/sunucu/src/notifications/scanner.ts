// ZAMANA BAĞLI BİLDİRİMLER — dakikalık bakım işinin içinde `BILDIRIM_TARAMA_DK`da bir koşar: kurulum ses vermiyor ·
// kira bitişi yaklaşıyor (yalnız eski çapalı kurulum; P modelinde kira bitişi tazeliktir) · lisans geçerlilik bitişi
// yaklaşıyor · taksit vadesi yaklaşıyor (bu ikisi ödenmiş tarih P'nin iki kaynağıdır — `paid-through.ts`) · bakım bitişi
// yaklaşıyor (30 gün; yenileme satışı) · güncelleme dalgası eşik uyarısı (F1a; grup kilidiyle, durdurmaz). Aday kilitsiz okunur, her
// aday kendi tx'inde kurulum kilidi ALTINDA TAZE okunup yeniden doğrulanır (TOCTOU: arada yoklayan kurulum "sessiz"
// bildirimi almaz). Tekillik anahtarı dönemi taşır (son yoklama anı · kira kimliği · bitiş/vade anı): aynı dönem
// ikinci satır doğurmaz, iki zamanlayıcı yarışsa da UNIQUE tek satır bırakır — spam yok.
import type { LisansSinifi } from "@prisma/client";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { installationCapabilities } from "../services/entitlement-policy";
import { findEntitlementForDelivery } from "../services/lease.service";
import { paidThroughModelActive } from "../services/paid-through";
import { scanWaveAlerts } from "../services/update-wave-view.service";
import { enqueueNotificationTx } from "./outbox";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Tur başına aday tavanı (fazlası sonraki turda — tekillik anahtarı tekrarı zararsız kılar). */
const SCAN_LIMIT = 500;

export interface ScanConfig {
  readonly silentHours: number;
  readonly dueDays: number;
  readonly silentClasses: readonly LisansSinifi[];
}

export interface ScanTotals {
  silent: number;
  leaseEnd: number;
  validityEnd: number;
  installmentDue: number;
  maintenanceEnd: number;
  waveAlert: number;
}

/** Tek adayın tx'i: ilk ifade kurulum kilidi; aday düşerse (hata) diğerleri sürer. */
async function underLock(installationDbId: string, run: (tx: Tx) => Promise<number>): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockInstallation(tx, installationDbId);
      return run(tx);
    });
  } catch (err) {
    console.error(`[satici] bildirim taraması: aday atlandı (${installationDbId}): ${(err as Error).message}`);
    return 0;
  }
}

/** Kurulum ses vermiyor: ETKİN + aktif + sınıf listede; son BAŞARILI yoklama (yoksa etkinleşme) eşikten eski. */
async function scanSilent(cfg: ScanConfig, nowMs: number): Promise<number> {
  const before = new Date(nowMs - cfg.silentHours * HOUR_MS);
  const rows = await prisma.kurulum.findMany({
    where: {
      durum: "ETKIN",
      aktif: true,
      sinif: { in: [...cfg.silentClasses] },
      OR: [{ sonYoklamaZamani: { lt: before } }, { sonYoklamaZamani: null, etkinlesmeZamani: { lt: before } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: SCAN_LIMIT,
  });
  let n = 0;
  for (const r of rows) {
    n += await underLock(r.id, async (tx) => {
      const k = await tx.kurulum.findUnique({ where: { id: r.id }, select: { durum: true, aktif: true, sinif: true, sonYoklamaZamani: true, etkinlesmeZamani: true } });
      const last = k?.sonYoklamaZamani ?? k?.etkinlesmeZamani ?? null;
      if (!k || k.durum !== "ETKIN" || !k.aktif || !cfg.silentClasses.includes(k.sinif) || !last || last >= before) return 0;
      return enqueueNotificationTx(tx, { event: "KURULUM_SESSIZ", keyParts: [r.id, last.getTime()], installationDbId: r.id, relatedId: r.id, portalPath: `/kurulumlar/${r.id}`, tarih: last });
    });
  }
  return n;
}

/**
 * Uçtaki kira fabrikada P modelini mi işletiyor (lisans v2)? O zaman kira bitişi yalnız TAZELİK bilgisidir, ek süreye
 * düşürmez: süre P'ye bağlıdır ve P'nin yaklaşması geçerlilik/taksit taramasında zaten bildirilir.
 */
async function tipUsesPaidThrough(tx: Tx, installationDbId: string, leaseToken: string): Promise<boolean> {
  const inst = await tx.kurulum.findUnique({ where: { id: installationDbId }, select: { id: true, yetenekler: true } });
  const hak = await tx.hak.findFirst({ where: { kurulumId: installationDbId, aktif: true } });
  if (!inst || !hak || hak.guncelSurum < 1) return false;
  return paidThroughModelActive({ capabilities: installationCapabilities(inst), entitlementToken: (await findEntitlementForDelivery(tx, inst, hak))?.belge ?? null, leaseToken });
}

/** Kira bitişi yaklaşıyor: uçtaki kiranın bitişi ufukta (kurulum yoklamıyor → ek süreye düşecek). Kira başına bir kez; P modelinde yok. */
async function scanLeaseEnd(cfg: ScanConfig, nowMs: number): Promise<number> {
  const now = new Date(nowMs);
  const horizon = new Date(nowMs + cfg.dueDays * DAY_MS);
  const rows = await prisma.kurulum.findMany({
    where: { durum: "ETKIN", aktif: true, sinif: { in: [...cfg.silentClasses] }, sonKira: { bitis: { gt: now, lte: horizon } } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: SCAN_LIMIT,
  });
  let n = 0;
  for (const r of rows) {
    n += await underLock(r.id, async (tx) => {
      const k = await tx.kurulum.findUnique({ where: { id: r.id }, select: { durum: true, aktif: true, sonKira: { select: { id: true, bitis: true, belge: true } } } });
      const lease = k?.sonKira;
      if (!k || k.durum !== "ETKIN" || !k.aktif || !lease || lease.bitis <= now || lease.bitis > horizon) return 0;
      if (await tipUsesPaidThrough(tx, r.id, lease.belge)) return 0;
      return enqueueNotificationTx(tx, { event: "KIRA_BITISI_YAKLASIYOR", keyParts: [lease.id], installationDbId: r.id, relatedId: r.id, portalPath: `/kurulumlar/${r.id}`, tarih: lease.bitis });
    });
  }
  return n;
}

/** Lisans (HAK) geçerlilik bitişi yaklaşıyor — vadeli/demo/taksit; bitiş değişirse (uzatma) yeni dönem. */
async function scanValidityEnd(cfg: ScanConfig, nowMs: number): Promise<number> {
  const now = new Date(nowMs);
  const horizon = new Date(nowMs + cfg.dueDays * DAY_MS);
  const rows = await prisma.hak.findMany({
    where: { aktif: true, gecerlilikBitis: { gt: now, lte: horizon }, kurulum: { aktif: true, durum: { not: "IPTAL" } } },
    select: { id: true, kurulumId: true },
    orderBy: { id: "asc" },
    take: SCAN_LIMIT,
  });
  let n = 0;
  for (const r of rows) {
    n += await underLock(r.kurulumId, async (tx) => {
      const h = await tx.hak.findUnique({ where: { id: r.id }, select: { aktif: true, gecerlilikBitis: true } });
      const end = h?.gecerlilikBitis ?? null;
      if (!h || !h.aktif || !end || end <= now || end > horizon) return 0;
      return enqueueNotificationTx(tx, { event: "GECERLILIK_BITISI_YAKLASIYOR", keyParts: [r.id, end.getTime()], installationDbId: r.kurulumId, relatedId: r.id, portalPath: `/kurulumlar/${r.kurulumId}`, tarih: end });
    });
  }
  return n;
}

/** Bakım bitişi hatırlatma penceresi (gün) — fabrikanın bakım bandıyla (`MAINTENANCE_WARNING_DAYS`) aynı 30. */
export const MAINTENANCE_REMINDER_DAYS = 30;
/** Bakım yenileme satışı DEMO/TEST'te anlamsızdır. */
const MAINTENANCE_SKIPPED_CLASSES = ["DEMO", "TEST"] as const;

/** Bakım bitişi yaklaşıyor (K9): aktif HAK, bitişe ≤ 30 gün; bitiş değişirse (yenileme) yeni dönem. */
async function scanMaintenanceEnd(nowMs: number): Promise<number> {
  const now = new Date(nowMs);
  const horizon = new Date(nowMs + MAINTENANCE_REMINDER_DAYS * DAY_MS);
  const rows = await prisma.hak.findMany({
    where: {
      aktif: true,
      bakimBitis: { gt: now, lte: horizon },
      kurulum: { aktif: true, durum: { in: ["ETKIN", "DEVREDILDI"] }, sinif: { notIn: [...MAINTENANCE_SKIPPED_CLASSES] } },
    },
    select: { id: true, kurulumId: true },
    orderBy: { id: "asc" },
    take: SCAN_LIMIT,
  });
  let n = 0;
  for (const r of rows) {
    n += await underLock(r.kurulumId, async (tx) => {
      const h = await tx.hak.findUnique({ where: { id: r.id }, select: { aktif: true, bakimBitis: true } });
      const end = h?.bakimBitis ?? null;
      if (!h || !h.aktif || !end || end <= now || end > horizon) return 0;
      return enqueueNotificationTx(tx, { event: "BAKIM_BITISI_YAKLASIYOR", keyParts: [r.id, end.getTime()], installationDbId: r.kurulumId, relatedId: r.id, portalPath: `/kurulumlar/${r.kurulumId}`, tarih: end });
    });
  }
  return n;
}

/** Taksit vadesi yaklaşıyor: aktif plandaki BEKLEYEN kalem (kalem + vade başına bir kez). */
async function scanInstallmentDue(cfg: ScanConfig, nowMs: number): Promise<number> {
  const now = new Date(nowMs);
  const horizon = new Date(nowMs + cfg.dueDays * DAY_MS);
  const rows = await prisma.taksitKalemi.findMany({
    where: { durum: "BEKLIYOR", vade: { gt: now, lte: horizon }, plan: { aktif: true } },
    select: { id: true, plan: { select: { kurulumId: true } } },
    orderBy: { id: "asc" },
    take: SCAN_LIMIT,
  });
  let n = 0;
  for (const r of rows) {
    const installationDbId = r.plan.kurulumId;
    n += await underLock(installationDbId, async (tx) => {
      const item = await tx.taksitKalemi.findUnique({ where: { id: r.id }, select: { durum: true, vade: true, sira: true, plan: { select: { aktif: true } } } });
      if (!item || item.durum !== "BEKLIYOR" || !item.plan.aktif || item.vade <= now || item.vade > horizon) return 0;
      return enqueueNotificationTx(tx, { event: "TAKSIT_VADESI_YAKLASIYOR", keyParts: [r.id, item.vade.getTime()], installationDbId, relatedId: r.id, portalPath: `/kurulumlar/${installationDbId}`, referans: `Taksit ${item.sira}`, tarih: item.vade });
    });
  }
  return n;
}

/** Altı tarama sırayla; dönüş yeni yazılan satır sayısı (kanal başına). */
export async function scanTimedNotifications(cfg: ScanConfig, nowMs: number): Promise<ScanTotals> {
  return {
    silent: await scanSilent(cfg, nowMs),
    leaseEnd: await scanLeaseEnd(cfg, nowMs),
    validityEnd: await scanValidityEnd(cfg, nowMs),
    installmentDue: await scanInstallmentDue(cfg, nowMs),
    maintenanceEnd: await scanMaintenanceEnd(nowMs),
    waveAlert: await scanWaveAlerts(),
  };
}
