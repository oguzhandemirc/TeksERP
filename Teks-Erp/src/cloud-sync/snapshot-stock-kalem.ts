// ANLIK `stok-kalem` (patron stok ekranı, 2026-11-20): rafın kalem listesi + topları, HAM ve BİTMİŞ ayrı. Kalem satırları
// panelin "Kalem bazında" sekmesinden (`getStockKalem`), toplar AYNI raf okumasından (`getStockKalemRolls`, aynı kalem
// anahtarı); ikinci tanım yok. Emanet açıkken satırlar BİZİM stok, müşteri malı yalnız `emanet` toplamında.
// Yaş FABRİKA TAKVİM GÜNÜ (rafa giriş günü → bugün): gün içinde sabit ⇒ stok değişmedikçe içerik özeti değişmez.
// Top dizisi bölüm başına tavanlı (en yaşlı önce); toplamlar ve kalem satırları tavandan ÖNCE, tüm kümeden.
import { z } from "zod";
import { factoryYmd } from "../constants/time";
import { loadShelfCellsByOwnership } from "../services/reports/stock-scorecard.report.service";
import { getStockKalem, getStockKalemRolls, type StockKalemRoll } from "../services/reports/stock-kalem.report.service";

export const STOCK_KALEM_SNAPSHOT = "stok-kalem";
/** Bölüm başına gönderilen en çok top (en yaşlı önce) — paket hacmi sınırı; `toplarKirpildi` söyler. */
export const STOCK_KALEM_ROLL_CAP = 2000;

const DAY_MS = 86_400_000;
const Num = z.number();
const Str = z.string();

const Kalem = z.strictObject({
  anahtar: Str, urunId: Str, urun: Str, en: Num.nullable(), renk: Str.nullable(), kat: Str.nullable(),
  top: Num, metre: Num, enEskiGun: Num.nullable(),
});
const Top = z.strictObject({
  id: Str, topNo: Str.nullable(), kalem: Str, metre: Num, kg: Num.nullable(), parti: Str.nullable(), depo: Str.nullable(), gun: Num.nullable(),
});
const Section = z.strictObject({ toplamTop: Num, toplamMetre: Num, kalemler: z.array(Kalem), toplar: z.array(Top), toplarKirpildi: z.boolean() });

export const STOCK_KALEM_SNAPSHOT_SCHEMA = z.strictObject({
  ham: Section,
  bitmis: Section,
  emanet: z.strictObject({ hamTop: Num, hamMetre: Num, bitmisTop: Num, bitmisMetre: Num }).optional(),
});
export type StockKalemSnapshotData = z.input<typeof STOCK_KALEM_SNAPSHOT_SCHEMA>;
type TopWire = z.input<typeof Top>;

function calendarAge(shelfDay: string | null, today: string): number | null {
  if (shelfDay === null) return null;
  return Math.round((Date.parse(today) - Date.parse(shelfDay)) / DAY_MS);
}

function oldestByKalem(tops: readonly TopWire[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tops) if (t.gun !== null) out.set(t.kalem, Math.max(out.get(t.kalem) ?? 0, t.gun));
  return out;
}

export async function buildStockKalemSnapshotData(now: Date): Promise<StockKalemSnapshotData> {
  // Tek raf okuması: kalem satırı ile topları aynı kümeden (arada yazma olsa da birbirini tutar).
  const split = await loadShelfCellsByOwnership();
  const kalem = await getStockKalem(split);
  const rolls = await getStockKalemRolls(split);
  const today = factoryYmd(now);
  const toTop = (r: StockKalemRoll): TopWire => ({
    id: r.rollId, topNo: r.barcode, kalem: r.kalemKey, metre: r.qty, kg: r.weightKg, parti: r.batchNumber, depo: r.warehouseName,
    gun: calendarAge(r.shelfDay, today),
  });
  const hamTops = rolls.ham.map(toTop);
  const bitmisTops = rolls.bitmis.map(toTop);
  const hamOldest = oldestByKalem(hamTops);
  const bitmisOldest = oldestByKalem(bitmisTops);
  const c = kalem.consignedTotals;
  return {
    ham: {
      toplamTop: kalem.totals.hamCount, toplamMetre: kalem.totals.hamQty,
      kalemler: kalem.ham.map((r) => ({
        anahtar: r.key, urunId: r.itemId, urun: r.itemName, en: null, renk: null, kat: null, top: r.count, metre: r.qty, enEskiGun: hamOldest.get(r.key) ?? null,
      })),
      toplar: hamTops.slice(0, STOCK_KALEM_ROLL_CAP),
      toplarKirpildi: hamTops.length > STOCK_KALEM_ROLL_CAP,
    },
    bitmis: {
      toplamTop: kalem.totals.bitmisCount, toplamMetre: kalem.totals.bitmisQty,
      kalemler: kalem.bitmis.map((r) => ({
        anahtar: r.key, urunId: r.itemId, urun: r.itemName, en: r.width, renk: r.colorName, kat: r.foldName, top: r.count, metre: r.qty,
        enEskiGun: bitmisOldest.get(r.key) ?? null,
      })),
      toplar: bitmisTops.slice(0, STOCK_KALEM_ROLL_CAP),
      toplarKirpildi: bitmisTops.length > STOCK_KALEM_ROLL_CAP,
    },
    ...(c ? { emanet: { hamTop: c.hamCount, hamMetre: c.hamQty, bitmisTop: c.bitmisCount, bitmisMetre: c.bitmisQty } } : {}),
  };
}
