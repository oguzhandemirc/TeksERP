// =============================================================================
// KALEM FİYATI GEÇERLİLİĞİ — "şu an" ve "şu tarih itibarıyla" TEK KAYNAK (MAL-0b)
// =============================================================================
// `ItemPrice` damgayla sürümlenir (defter.md ③a): satır silinmez, fiyat yerinde
// ezilmez; her satır `[createdAt, revokedAt)` penceresinde geçerlidir. Fiyatı
// okuyan her yol bu dosyadaki yüklemden geçer — elle kopyalanan `WHERE` bir gün
// damgalı satırı "güncel fiyat" diye faturaya taşır (AST kapısı
// `test_item_price_surum` §7).
//
// Prisma parçası ↔ bellek-içi yüklem BOĞAZ-İKİZİDİR: biri değişirse öteki de
// değişir (`test_item_price_surum` §4 ikisini aynı satırlarda karşılaştırır).
// Bulut kapsamının SQL ikizi `cloud-sync/catalog-facts.ts` `fiyat` projeksiyonunda.
// =============================================================================
import type { Prisma } from "@prisma/client";

/** Bugün geçerli (damgasız) fiyat satırı — "şu an" okuyan her yol buradan geçer. */
export const ACTIVE_ITEM_PRICE = { revokedAt: null } as const;

/**
 * `at` anında geçerli fiyat satırı: `createdAt <= at AND (revokedAt IS NULL OR revokedAt > at)`.
 * ⚠️ Yalnız `{ AND: [...] }` içine konur: kendi `OR`u çağıranın `OR`unu ezmesin.
 */
export function itemPriceValidAt(at: Date): Prisma.ItemPriceWhereInput {
  return { createdAt: { lte: at }, OR: [{ revokedAt: null }, { revokedAt: { gt: at } }] };
}

/** `itemPriceValidAt`in bellek-içi ikizi (pencere sınırı: başı dahil, sonu hariç). */
export function isItemPriceValidAt(row: { createdAt: Date; revokedAt: Date | null }, at: Date): boolean {
  return row.createdAt.getTime() <= at.getTime() && (row.revokedAt === null || row.revokedAt.getTime() > at.getTime());
}

/** `ACTIVE_ITEM_PRICE`in bellek-içi ikizi. */
export function isActiveItemPrice(row: { revokedAt: Date | null }): boolean {
  return row.revokedAt === null;
}

/** Damga gerekçeleri — panel/audit aynı cümleyi görsün. */
export const ITEM_PRICE_REVOKE_REASON = {
  CHANGED: "Fiyat değişti",
  REMOVED: "Fiyat kaldırıldı",
} as const;
