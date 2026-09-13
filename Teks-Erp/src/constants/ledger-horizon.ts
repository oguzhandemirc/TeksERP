// =============================================================================
// STOK DEFTERİ UFKU — TEK KAYNAK (2026-09-14)
// =============================================================================
// Depo defteri (`WarehouseMovement`) bu fabrika gününden itibaren TAM sayılır:
// ufuktan SONRA doğan bir topun defterde giriş ucu yoksa bu bir KUSURDUR (K=0
// kapısı delinmiş demektir); ufuktan ÖNCESİ mirastır, onarılmaz ve okuyucular
// beyanlı bir yedeğe düşer. Sabit daha önce yalnız `scripts/test_consistency.ts`te
// yaşıyordu; para okuyucusu (`helpers/receipt-qty.helper.ts`) da aynı çizgiyi
// sorunca ürün tarafına taşındı — iki kopya iki ufuk demek olurdu.
// Gün Europe/Istanbul fabrika günüdür (`constants/time.ts`), çıplak tarih değil.
// =============================================================================
import { resolveRangeStart } from "./time";

/** Fabrika günü (YYYY-MM-DD). Değiştirmek bir HÜKÜMDÜR (arşiv notu ister). */
export const LEDGER_HORIZON_DAY = "2026-09-13";

/** Ufkun fabrika-günü BAŞLANGICI (mutlak an). `createdAt >= ufuk` sorusu buradan. */
export function ledgerHorizonStart(): Date {
  return resolveRangeStart(LEDGER_HORIZON_DAY);
}
