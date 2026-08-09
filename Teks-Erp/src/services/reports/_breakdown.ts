// =============================================================================
// Karne kırılımları — ORTAK ÜRETİCİ
// =============================================================================
// Kumaş / renk / müşteri / fason / neden … tablolarının hepsi aynı şekli taşır:
// etiket + adet + metraj (+ karşılaştırma dönemi). Her karnede yeniden yazmak,
// aralarında sessiz tanım farkı doğurur — biri iptalleri sayar, diğeri saymaz;
// biri metrajı yuvarlar, diğeri yuvarlamaz. Tek üretici bunu engeller.
//
// ⚠️ Kırılımlar her zaman TEK bir hücre kümesinden türetilir (rapor servisi tek
// GROUP BY ile toplar). Boyut başına ayrı sorgu atmak, aralarında bir yazma
// olduğunda toplamların BİRBİRİNİ TUTMAMASINA yol açar ("kumaş kırılımı 1200 m,
// renk kırılımı 1180 m") ve bu, kullanıcının rapora güvenini tek seferde bitirir.
// =============================================================================

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  qty: number;
  /** Karşılaştırma dönemi — yalnız karşılaştırma istendiyse dolar. */
  prevCount?: number;
  prevQty?: number;
}

export interface BreakdownDim<TCell> {
  keyOf: (c: TCell) => string;
  labelOf: (c: TCell) => string;
  countOf: (c: TCell) => number;
  qtyOf: (c: TCell) => number;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const pctOf = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export function buildBreakdown<TCell>(cells: TCell[], dim: BreakdownDim<TCell>): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const c of cells) {
    const key = dim.keyOf(c);
    let row = map.get(key);
    if (!row) {
      row = { key, label: dim.labelOf(c), count: 0, qty: 0 };
      map.set(key, row);
    }
    row.count += dim.countOf(c);
    row.qty += dim.qtyOf(c);
  }
  const out = [...map.values()];
  for (const r of out) r.qty = round1(r.qty);
  // Metrajı büyükten küçüğe — operatörün ilk baktığı satır en ağır olan olsun.
  // Eşitlikte ada göre: aynı istek aynı sırayı üretsin (deterministik çıktı;
  // aksi halde Excel'i iki kez indiren kullanıcı iki farklı dosya alır).
  out.sort((a, b) => b.qty - a.qty || b.count - a.count || a.label.localeCompare(b.label, "tr"));
  return out;
}

/**
 * Karşılaştırma dönemini mevcut satırlara işler.
 *
 * ⚠️ Önceki dönemde HİÇ olmayan satıra `0` yazılır, `undefined` BIRAKILMAZ:
 * ekranda "veri yok" ile "üretim yok" ayrı şeylerdir ve burada doğru olan
 * ikincisidir (dönem sorgulandı, o satır yoktu = sıfır).
 */
export function attachPrev<TCell>(
  current: BreakdownRow[],
  prevCells: TCell[],
  dim: BreakdownDim<TCell>,
): void {
  const prev = new Map(buildBreakdown(prevCells, dim).map((r) => [r.key, r]));
  for (const row of current) {
    const p = prev.get(row.key);
    row.prevQty = p ? p.qty : 0;
    row.prevCount = p ? p.count : 0;
  }
}
