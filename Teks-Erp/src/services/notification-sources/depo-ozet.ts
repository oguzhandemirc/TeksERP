// =============================================================================
// DEPO · SEVKİYAT · FASON ÖZETLERİ — gün sonu (S3) + haftalık fason (S5a) + birleşik gün sonu (2026-11-19)
// =============================================================================
// Sayılar deftere/belgeye dayanır (SystemLog'dan türetilmez): sevk metresi brüt TEK tanımdan (`reports/_shipped.ts`
// `collectShipped`, iade geri-eklemeli), geri alma `shipment_events` defterinden, depo hareketleri `warehouse_movements`
// defterinden, fason sevk/kabul iptalsiz belgelerden. Hepsi sıfırsa pencere bildirimsiz geçer. Yük tutar taşımaz.
// =============================================================================
import { ShipmentEventType, ShipmentStatus, WarehouseEventType, type Prisma } from "@prisma/client";
import { lastClosedWindow, registerDigestSource, type DigestWindow } from "../../jobs/notification-digest.job";
import { collectShipped } from "../reports/_shipped";
import { factoryDayStart, factoryMinuteOfDay, factoryTimeHms, factoryYmd } from "../../constants/time";
import { readNotificationDailySummaryTime } from "../system-setting.service";
import { orderWindowCounts } from "./satis-ozet";
import { productionWindowCounts } from "./uretim-ozet";

const m2 = (v: unknown): number => Math.round(Number(String(v ?? 0)) * 100) / 100;

type Tx = Prisma.TransactionClient;
type Range = Pick<DigestWindow, "from" | "to">;

/** Pencerede brüt sevk (top/metre), sevkiyat ve geri alma sayımı — günlük sevkiyat özeti ve birleşik gün sonu özetinin TEK kaynağı. */
export async function shipmentWindowCounts(tx: Tx, w: Range) {
  // `collectShipped` aralığı kapalı uçlu (`<= to`) → pencere sonu bir ms geri.
  const cells = await collectShipped({ from: w.from, to: new Date(w.to.getTime() - 1) });
  const top = cells.reduce((a, c) => a + c.rollCount, 0);
  const metre = m2(cells.reduce((a, c) => a + c.qty, 0));
  const sevkiyat = await tx.shipment.count({ where: { status: ShipmentStatus.DISPATCHED, dispatchedAt: { gte: w.from, lt: w.to } } });
  const geriAlinan = await tx.shipmentEvent.count({ where: { type: ShipmentEventType.UNDISPATCHED, createdAt: { gte: w.from, lt: w.to } } });
  return { sevkiyat, top, metre, geriAlinan };
}

/** Pencerede depo defteri hareketleri — günlük depo özeti ve birleşik gün sonu özetinin TEK kaynağı. */
export async function stockWindowCounts(tx: Tx, w: Range) {
  const createdAt = { gte: w.from, lt: w.to };
  const entry = await tx.warehouseMovement.aggregate({ where: { eventType: WarehouseEventType.ENTRY, createdAt }, _count: { _all: true }, _sum: { qty: true } });
  const iade = await tx.warehouseMovement.count({ where: { eventType: WarehouseEventType.RETURN, createdAt } });
  const transfer = await tx.warehouseTransfer.count({ where: { createdAt } });
  const duzeltme = await tx.warehouseMovement.count({ where: { eventType: WarehouseEventType.ADJUST, createdAt } });
  return { giris: entry._count._all, girisMetre: m2(entry._sum.qty), iade, transfer, duzeltme };
}

/** Pencerede iptalsiz fason çıkış/dönüş belgeleri — günlük/haftalık fason özeti ve birleşik gün sonu özetinin TEK kaynağı. */
export async function subcontractWindowCounts(tx: Tx, w: Range) {
  const cikislar = await tx.subcontractorDispatch.aggregate({ where: { cancelledAt: null, dispatchedAt: { gte: w.from, lt: w.to } }, _count: { _all: true }, _sum: { totalQty: true } });
  const donus = await tx.subcontractorReceipt.count({ where: { cancelledAt: null, receivedAt: { gte: w.from, lt: w.to } } });
  return { cikis: cikislar._count._all, cikisMetre: m2(cikislar._sum.totalQty), donus };
}

export function registerDepotDigestSources(): void {
  registerDigestSource({
    kind: "sevkiyat.gunluk-ozet",
    compute: async (tx, w) => {
      const c = await shipmentWindowCounts(tx, w);
      if (c.top + c.sevkiyat + c.geriAlinan === 0) return null;
      return { gun: w.label, ...c };
    },
  });
  registerDigestSource({
    kind: "stok.gunluk-ozet",
    compute: async (tx, w) => {
      const c = await stockWindowCounts(tx, w);
      if (c.giris + c.iade + c.transfer + c.duzeltme === 0) return null;
      return { gun: w.label, ...c };
    },
  });
  // Günlük ve haftalık fason özeti AYNI sayımı yapar; yalnız pencere ve etiket alanı (`gun` / `hafta`) farklıdır.
  registerDigestSource({ kind: "fason.gunluk-ozet", compute: async (tx, w) => fasonCounts(tx, w, "gun") });
  registerDigestSource({ kind: "fason.haftalik-ozet", compute: async (tx, w) => fasonCounts(tx, w, "hafta") });
  registerDailySummaryDigestSource(); // birleşik gün sonu (2026-11-19); kayıt burada: dağıtıcı işi dosyasına dokunmadan
}

async function fasonCounts(tx: Tx, w: DigestWindow, labelKey: "gun" | "hafta"): Promise<Record<string, unknown> | null> {
  const c = await subcontractWindowCounts(tx, w);
  if (c.cikis + c.donus === 0) return null;
  return { [labelKey]: w.label, ...c };
}

// ── Birleşik gün sonu özeti (`genel.gun-sonu-ozeti`, 2026-11-19) ──────────────
// Sayılar alan özetlerinin AYNI fonksiyonlarından (tek kaynak); pencere `bildirim.gunSonuOzeti.saat`:
// `00:00` = kadansın biten fabrika günü (`lastClosedWindow` GUN_SONU), diğer saat = o günün 00:00 → saat (duvar saati).
const DAILY_SUMMARY_KIND = "genel.gun-sonu-ozeti" as const;

/** `now` anında kapanmış son birleşik özet penceresi; anahtar = pencerenin fabrika günü (saat değişse de gün başına tek). */
export async function dailySummaryWindow(tx: Tx, now: Date): Promise<DigestWindow | null> {
  const [h, m] = (await readNotificationDailySummaryTime(tx)).split(":").map(Number);
  const minute = h * 60 + m;
  if (minute === 0) return lastClosedWindow(tx, "GUN_SONU", now);
  let to = factoryMinuteOfDay(now, minute);
  if (to.getTime() > now.getTime()) to = factoryMinuteOfDay(factoryDayStart(new Date(factoryDayStart(now).getTime() - 3_600_000)), minute);
  const from = factoryDayStart(to);
  const gun = factoryYmd(from);
  return { key: gun, from, to, label: gun };
}

function registerDailySummaryDigestSource(): void {
  registerDigestSource({
    kind: DAILY_SUMMARY_KIND,
    window: dailySummaryWindow,
    compute: async (tx, w) => {
      const s = await orderWindowCounts(tx, w);
      const u = await productionWindowCounts(tx, w);
      const v = await shipmentWindowCounts(tx, w);
      const d = await stockWindowCounts(tx, w);
      const f = await subcontractWindowCounts(tx, w);
      if (s.yeni + u.top + v.top + d.giris + f.cikis + f.donus === 0) return null;
      const tumGun = factoryDayStart(w.to).getTime() === w.to.getTime();
      return {
        gun: w.label, aralik: tumGun ? "tüm gün" : `00:00–${factoryTimeHms(w.to).slice(0, 5)}`,
        siparis: s.yeni, uretimTop: u.top, uretimMetre: u.metre, sevkTop: v.top, sevkMetre: v.metre,
        girisTop: d.giris, fasonCikis: f.cikis, fasonDonus: f.donus,
      };
    },
  });
}
