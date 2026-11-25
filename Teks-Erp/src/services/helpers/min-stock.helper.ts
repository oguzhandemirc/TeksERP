// =============================================================================
// ASGARİ STOK — "asgari altı mı?" sorusunun TEK cevabı (iplik + sarf stok listeleri, ürün penceresi)
// =============================================================================
// Eldeki miktarı burada HESAPLAMAZ: iplik `YarnStock.balanceKg` Σ'sı (`yarn-min-stock.helper`), sarf
// `consumableBalances` (defter) — her biri kendi okuyucusundan gelir. Kural: eşik boşsa uyarı yok; arşivlenmiş
// kart uyarı üretmez (yeniden sipariş edilmeyecek mal); eşitlik asgari altı DEĞİLDİR ("altına düşünce").
// Saf dosya: iplik modeline dokunmaz (sarf rotası iplik rejim kapısı taşımaz, `test_iplik_regime_gate`).
// =============================================================================
import type { Prisma } from "@prisma/client";

/** Eldeki miktar kartın asgari stoğunun altında mı? (bellek-içi yüklem; tek kaynak) */
export function isBelowMinStock(onHand: Prisma.Decimal, minStockQty: Prisma.Decimal | null | undefined, archived: boolean): boolean {
  if (archived || minStockQty == null) return false;
  return onHand.lt(minStockQty);
}
