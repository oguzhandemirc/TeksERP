// =============================================================================
// FASON ÇEKMESİ — giden ↔ dönen metraj farkının DAĞITIMI (2026-08-21)
// =============================================================================
// Kabulde iki bağımsız sayı vardır:
//   • TÜKETİLEN  — fasonun hesabından düşülen metraj (makbuz kalemleri toplamı)
//   • DÖNEN      — fiziksel olarak gelen metraj (doğan açık-kumaş parçaları)
// Boyahanede kumaş çeker: 250 m giden mal 220 m döner. Bu 30 m gerçek bir üretim
// kaybıdır ve fason karnesinin ("bu firmanın firesi %kaç") tek dayanağıdır.
//
// ⚠️ NEDEN DAĞITIM: `RollVariance` TOP bazlıdır (`rollId` zorunlu), fark ise
// MAKBUZ bazlı bir gerçektir — boyahane 5 topu dikip tek parça boyadığı için
// "hangi toptan kaç metre çekti" sorusunun fiziksel bir cevabı YOKTUR. Bu yüzden
// fark, tüketilen metrajla ORANTILI dağıtılır: tek topluk kabulde (çoğunluk)
// dağıtım kimliktir, çok toplukta ise defter toplamı doğru kalır ve top bazlı
// gösterim "yaklaşık" olduğunu bilerek yapar. Alternatifleri elendi: tek bir topa
// yazmak (5 toptan biri 30 m fire görünür — yanlış), her topa eşit bölmek
// (30 m'lik topa 60 m'likle aynı payı verir).
//
// ⚠️ TOPLAM KORUNUR: yuvarlama artığı SON satıra biner. Satır satır yuvarlanan
// bir dağıtım defter toplamını sapmanın kendisinden farklı bırakır ve fark, karne
// ile defter arasında hiçbir yerde açıklanmayan bir tutarsızlığa dönüşür.
// =============================================================================

import { Prisma } from "@prisma/client";

/** Dağıtımın tabanı: bu makbuzun her toptan tükettiği metraj. */
export interface ShrinkBasisRow {
  rollId: string;
  receivedQty: Prisma.Decimal;
}

export interface ShrinkShare {
  rollId: string;
  qty: Prisma.Decimal;
}

/** `RollVariance.qty` kolonu Decimal(12,3) — dağıtım da orada yuvarlanır. */
const SCALE = 3;

/**
 * `total` metrajı satırlara `receivedQty` oranında dağıtır.
 *
 * Sözleşme:
 *   • dönen payların TOPLAMI her zaman `total`e EŞİTTİR (artık son satırda),
 *   • sıfır/negatif paylar ELENİR (`recordVarianceTx` zaten atlardı — burada
 *     elemek defterde "0 m sapma" satırı beklentisi kurulmasını engeller),
 *   • taban toplamı 0 ise (teorik) tüm fark İLK satıra yazılır — bilgi
 *     kaybetmektense yaklaşık yazmak yeğdir.
 */
export function allocateShrink(
  basis: readonly ShrinkBasisRow[],
  total: Prisma.Decimal,
): ShrinkShare[] {
  if (basis.length === 0 || !total.greaterThan(0)) return [];
  if (basis.length === 1) return [{ rollId: basis[0]!.rollId, qty: total }];

  const sum = basis.reduce((s, b) => s.plus(b.receivedQty), new Prisma.Decimal(0));
  if (!sum.greaterThan(0)) return [{ rollId: basis[0]!.rollId, qty: total }];

  const out: ShrinkShare[] = [];
  let assigned = new Prisma.Decimal(0);
  for (let i = 0; i < basis.length - 1; i++) {
    const row = basis[i]!;
    const share = total.times(row.receivedQty).dividedBy(sum).toDecimalPlaces(SCALE);
    if (share.greaterThan(0)) {
      out.push({ rollId: row.rollId, qty: share });
      assigned = assigned.plus(share);
    }
  }
  // SON satır artığı yüklenir → Σ pay === total (yukarıdaki nota bak).
  const last = total.minus(assigned);
  if (last.greaterThan(0)) out.push({ rollId: basis[basis.length - 1]!.rollId, qty: last });
  return out;
}
