// =============================================================================
// KALEM FİYATI GEÇERLİLİĞİ — "şu an" ve "şu tarih itibarıyla" TEK KAYNAK (MAL-0b)
// =============================================================================
// `ItemPrice` damgayla sürümlenir (defter.md ③a): satır silinmez, fiyat yerinde
// ezilmez; her satır `[COALESCE(validFrom, createdAt), revokedAt)` penceresinde geçerlidir.
// İleri tarihli fiyat (K4, 2026-11-06) ZAMANLANMIŞ DAMGA'dır: yürürlükteki satırın `revokedAt`ı
// yeni satırın `validFrom`una kurulur → pencereler örtüşmez, anahtar başına AÇIK satır tektir. Fiyatı
// okuyan her yol bu dosyadaki yüklemden geçer — elle kopyalanan `WHERE` bir gün
// damgalı satırı "güncel fiyat" diye faturaya taşır (AST kapısı
// `test_item_price_surum` §7).
//
// Prisma parçası ↔ bellek-içi yüklem BOĞAZ-İKİZİDİR: biri değişirse öteki de
// değişir (`test_item_price_surum` §4 ikisini aynı satırlarda karşılaştırır).
// Bulut kapsamının SQL ikizi `cloud-sync/catalog-facts.ts` `fiyat` projeksiyonunda.
// =============================================================================
import type { Prisma } from "@prisma/client";

/**
 * AÇIK (damgasız) fiyat satırı — anahtar başına TEK (partial unique). Bekleyen ileri tarihli
 * satır da açıktır; "şu an yürürlükte" DEĞİLDİR → fiyat okuyan yol `itemPriceNow()` kullanır.
 * Bu sabit yazım claim'i, tekillik ve canlı referans içindir.
 */
export const ACTIVE_ITEM_PRICE = { revokedAt: null } as const;

/**
 * `at` anında geçerli fiyat satırı:
 * `COALESCE(validFrom, createdAt) <= at AND (revokedAt IS NULL OR revokedAt > at)`.
 * Kendi `AND`ini taşır; çağıranın `OR`unu ezmez.
 */
export function itemPriceValidAt(at: Date): Prisma.ItemPriceWhereInput {
  return {
    AND: [
      { OR: [{ validFrom: null, createdAt: { lte: at } }, { validFrom: { lte: at } }] },
      { OR: [{ revokedAt: null }, { revokedAt: { gt: at } }] },
    ],
  };
}

/** Şu an yürürlükteki fiyat satırı — "şu an" okuyan her yol buradan geçer (AST kapısı bu adı da kabul eder). */
export function itemPriceNow(): Prisma.ItemPriceWhereInput {
  return itemPriceValidAt(new Date());
}

/** `itemPriceValidAt`in bellek-içi ikizi (pencere sınırı: başı dahil, sonu hariç). */
export function isItemPriceValidAt(row: { createdAt: Date; validFrom?: Date | null; revokedAt: Date | null }, at: Date): boolean {
  const start = (row.validFrom ?? row.createdAt).getTime();
  return start <= at.getTime() && (row.revokedAt === null || row.revokedAt.getTime() > at.getTime());
}

/** Bekleyen (ileri tarihli, henüz yürürlüğe girmemiş) açık satır mı. */
export function isItemPricePending(row: { validFrom?: Date | null; revokedAt: Date | null }, at = new Date()): boolean {
  return row.revokedAt === null && !!row.validFrom && row.validFrom.getTime() > at.getTime();
}

/** `ACTIVE_ITEM_PRICE`in bellek-içi ikizi. */
export function isActiveItemPrice(row: { revokedAt: Date | null }): boolean {
  return row.revokedAt === null;
}

/** Damga gerekçeleri — panel/audit aynı cümleyi görsün. */
export const ITEM_PRICE_REVOKE_REASON = {
  CHANGED: "Fiyat değişti",
  REMOVED: "Fiyat kaldırıldı",
  /** Zamanlanmış damga: yürürlükteki satır, ileri tarihli yeni fiyatın başlangıcında kapanır. */
  SCHEDULED: "İleri tarihli fiyatla değişecek",
} as const;
