// =============================================================================
// STOK & ÖLÜ STOK — KALEM BAZINDA sekmesi
// =============================================================================
// "Hangi kumaştan rafta kaç top, kaç metre var?" — iki bölüm:
//   • Ham    : kumaş başına satır.
//   • Bitmiş : kumaş + en + renk + kat başına satır.
//
// ⚠️ İKİNCİ TANIM YOK. Raf kümesi (`loadShelfCellsByOwnership`) ve ham/bitmiş ayrımı
// (`isRawCell` / `isFinishedCell`) Stok & Ölü Stok'un kutularıyla AYNI
// fonksiyonlardan gelir; bu dosya yalnız gruplar. Toplamlar kutulardaki
// "Ham stok" / "Bitmiş depo" rakamlarıyla birebir tutar
// (`test_stok_kalem_raporu` §1 ölçer, §5 bu dosyada statü literali arar).
//
// KAT = `Roll.foldType` (topun KENDİ kolonu, katalog kodu). İş emrinin/reçetenin
// katı PLANDIR; tamburda seçilen değer topa yazılır ve etikete basılan odur.
// Görünen ad kat kataloğundan (`loadFoldTypeCatalog`); katalogda yoksa kod.
// EMANET (F1): bölme karneyle AYNI (`loadShelfCellsByOwnership`); açıkken satırlar BİZİM stok, emanet `consignedTotals`.
// =============================================================================

import { isFinishedCell, isRawCell, loadShelfCellsByOwnership, type StockCell } from "./stock-scorecard.report.service";
import { loadFoldTypeCatalog } from "../helpers/fold-type";
import { round1 } from "./_breakdown";
import { loadShelfRollExtras } from "../helpers/shelf-roll-extras.helper";
import { factoryYmd } from "../../constants/time";

export interface StockKalemHamRow {
  key: string;
  itemId: string;
  itemName: string;
  count: number;
  qty: number;
}

export interface StockKalemBitmisRow {
  key: string;
  itemId: string;
  itemName: string;
  width: number | null;
  colorId: string | null;
  colorName: string | null;
  /** Katalog kodu ("2-KAT"); katsız top `null`. */
  foldType: string | null;
  /** Görünen ad ("2 Kat"); katalogda yoksa kod. */
  foldName: string | null;
  count: number;
  qty: number;
}

export interface KalemTotals { hamCount: number; hamQty: number; bitmisCount: number; bitmisQty: number }

function totalsOf(cells: readonly StockCell[]): KalemTotals {
  const raw = cells.filter(isRawCell);
  const finished = cells.filter(isFinishedCell);
  return {
    hamCount: raw.length,
    hamQty: round1(raw.reduce((a, c) => a + c.qty, 0)),
    bitmisCount: finished.length,
    bitmisQty: round1(finished.reduce((a, c) => a + c.qty, 0)),
  };
}

export interface StockKalem {
  /** Toplamlar TÜM kümeden (satır tavanından önce) — kutularla aynı rakam. */
  totals: KalemTotals;
  /** Emanet (müşteri malı) toplamları — yalnız `emanet.enabled` açıkken; o zaman `totals` + satırlar bizim stok. */
  consignedTotals?: KalemTotals;
  ham: StockKalemHamRow[];
  bitmis: StockKalemBitmisRow[];
}

function group<R extends { count: number; qty: number }>(
  cells: StockCell[],
  keyOf: (c: StockCell) => string,
  make: (c: StockCell, key: string) => R,
): R[] {
  const map = new Map<string, R>();
  for (const c of cells) {
    const k = keyOf(c);
    let row = map.get(k);
    if (!row) {
      row = make(c, k);
      map.set(k, row);
    }
    row.count += 1;
    row.qty += c.qty;
  }
  return [...map.values()].map((r) => ({ ...r, qty: round1(r.qty) }));
}

/** Kalem anahtarı TEK tanım: kalem satırı ve topun `kalemKey`i aynı fonksiyondan (patron `stok-kalem` ikisini eşler). */
export const hamKalemKey = (c: StockCell): string => c.itemId;
export const bitmisKalemKey = (c: StockCell): string => `${c.itemId}|${c.width ?? ""}|${c.colorId ?? ""}|${c.foldType ?? ""}`;

/** Raf okumasının bölünmüş hâli — kalem satırları ile topları AYNI okumadan kurmak için dışarıdan verilebilir. */
export type ShelfSplit = Awaited<ReturnType<typeof loadShelfCellsByOwnership>>;

export async function getStockKalem(split?: ShelfSplit): Promise<StockKalem> {
  const [{ own: cells, consigned, emanetOn }, foldCatalog] = await Promise.all([split ?? loadShelfCellsByOwnership(), loadFoldTypeCatalog()]);
  const raw = cells.filter(isRawCell);
  const finished = cells.filter(isFinishedCell);

  const foldName = new Map(foldCatalog.values.map((v) => [v.code, v.name]));
  const foldOrder = new Map(foldCatalog.values.map((v, i) => [v.code, i]));

  const ham = group(raw, hamKalemKey, (c, key) => ({
    key, itemId: c.itemId, itemName: c.itemName, count: 0, qty: 0,
  }));
  ham.sort((a, b) => a.itemName.localeCompare(b.itemName, "tr"));

  const bitmis = group(
    finished,
    bitmisKalemKey,
    (c, key) => ({
      key, itemId: c.itemId, itemName: c.itemName, width: c.width,
      colorId: c.colorId, colorName: c.colorName,
      foldType: c.foldType, foldName: c.foldType === null ? null : (foldName.get(c.foldType) ?? c.foldType),
      count: 0, qty: 0,
    }),
  );
  // Kumaş → en (küçükten büyüğe, ensiz sonda) → renk → kat (katalog sırası, katsız sonda).
  const last = Number.POSITIVE_INFINITY;
  const widthOrd = (r: StockKalemBitmisRow) => r.width ?? last;
  const foldOrd = (r: StockKalemBitmisRow) => (r.foldType === null ? last : (foldOrder.get(r.foldType) ?? 1e6));
  bitmis.sort(
    (a, b) =>
      a.itemName.localeCompare(b.itemName, "tr") ||
      widthOrd(a) - widthOrd(b) ||
      (a.colorName ?? "\uffff").localeCompare(b.colorName ?? "\uffff", "tr") ||
      foldOrd(a) - foldOrd(b) ||
      (a.foldType ?? "").localeCompare(b.foldType ?? "", "tr"),
  );

  return {
    totals: totalsOf(cells),
    ...(emanetOn ? { consignedTotals: totalsOf(consigned) } : {}),
    ham,
    bitmis,
  };
}

// ── Kalemin topları (patron `stok-kalem`, 2026-11-20) ────────────────────────

export interface StockKalemRoll {
  rollId: string;
  barcode: string | null;
  /** Kalem satırının `key`i (`hamKalemKey` / `bitmisKalemKey`). */
  kalemKey: string;
  qty: number;
  weightKg: number | null;
  batchNumber: string | null;
  warehouseName: string | null;
  /** Rafta bekleme yaşı (gün, mutlak fark); damgasız top `null`. */
  days: number | null;
  /** Rafa giriş FABRİKA günü (`YYYY-MM-DD`); damgasız top `null`. */
  shelfDay: string | null;
}

export interface StockKalemRolls { ham: StockKalemRoll[]; bitmis: StockKalemRoll[] }

const rollOrder = (a: StockKalemRoll, b: StockKalemRoll): number =>
  (b.days ?? -1) - (a.days ?? -1) || (a.barcode ?? "").localeCompare(b.barcode ?? "", "tr") || a.rollId.localeCompare(b.rollId);

/** Raftaki BİZİM toplar tek tek (kalem satırlarıyla aynı küme ve anahtar); sıra en yaşlı önce. */
export async function getStockKalemRolls(split?: ShelfSplit): Promise<StockKalemRolls> {
  const { own: cells } = split ?? (await loadShelfCellsByOwnership());
  const raw = cells.filter(isRawCell);
  const finished = cells.filter(isFinishedCell);
  const extras = await loadShelfRollExtras([...raw, ...finished].map((c) => c.rollId));
  const row = (keyOf: (c: StockCell) => string) => (c: StockCell): StockKalemRoll => {
    const e = extras.get(c.rollId);
    return {
      rollId: c.rollId, barcode: c.barcode, kalemKey: keyOf(c), qty: round1(c.qty),
      weightKg: e?.weightKg === null || e?.weightKg === undefined ? null : round1(e.weightKg),
      batchNumber: e?.batchNumber ?? null, warehouseName: e?.warehouseName ?? null,
      days: c.days === null ? null : round1(c.days),
      shelfDay: e?.statusChangedAt ? factoryYmd(e.statusChangedAt) : null,
    };
  };
  return { ham: raw.map(row(hamKalemKey)).sort(rollOrder), bitmis: finished.map(row(bitmisKalemKey)).sort(rollOrder) };
}
