// =============================================================================
// MALİYET FİYATI GEÇERLİLİĞİ — iplik maliyet fiyatı + terbiye tarifesi (MAL-1)
// =============================================================================
// `YarnCostPrice` ve `FinishingRate` damgayla sürümlenir (defter.md ③a, ItemPrice/MAL-0b
// emsali): satır silinmez, fiyat yerinde ezilmez; her satır `[createdAt, revokedAt)`
// penceresinde geçerlidir. "Şu an" ve "şu tarih itibarıyla" okuyan HER yol bu dosyadan
// geçer — elle kopyalanan `WHERE` damgalı fiyatı maliyete taşır (`test_maliyet_girdileri` §2).
// Prisma parçası ↔ bellek-içi yüklem BOĞAZ-İKİZİDİR.
// =============================================================================
import type { Prisma } from "@prisma/client";

/** Bugün geçerli (damgasız) iplik maliyet fiyatı. */
export const ACTIVE_YARN_COST_PRICE = { revokedAt: null } as const;

/** Bugün geçerli (damgasız) terbiye/fason tarifesi. */
export const ACTIVE_FINISHING_RATE = { revokedAt: null } as const;

/** `at` anında geçerli iplik fiyatı. ⚠️ Yalnız `{ AND: [...] }` içine konur (kendi `OR`u var). */
export function yarnCostPriceValidAt(at: Date): Prisma.YarnCostPriceWhereInput {
  return { createdAt: { lte: at }, OR: [{ revokedAt: null }, { revokedAt: { gt: at } }] };
}

/** `at` anında geçerli tarife. ⚠️ Yalnız `{ AND: [...] }` içine konur. */
export function finishingRateValidAt(at: Date): Prisma.FinishingRateWhereInput {
  return { createdAt: { lte: at }, OR: [{ revokedAt: null }, { revokedAt: { gt: at } }] };
}

/** İki `*ValidAt` parçasının bellek-içi ikizi (pencere: başı dahil, sonu hariç). */
export function isCostPriceValidAt(row: { createdAt: Date; revokedAt: Date | null }, at: Date): boolean {
  return row.createdAt.getTime() <= at.getTime() && (row.revokedAt === null || row.revokedAt.getTime() > at.getTime());
}

/** Damga gerekçeleri — panel/audit aynı cümleyi görsün. */
export const COST_PRICE_REVOKE_REASON = {
  CHANGED: "Fiyat değişti",
  REMOVED: "Fiyat kaldırıldı",
} as const;
