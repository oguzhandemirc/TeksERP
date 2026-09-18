// =============================================================================
// MAL KABUL YAN ETKİLERİ — fiş yazınca BAYATLAYAN sorgular (kullanıcı bulgusu 2026-09-18, d9 sürücüsü)
// =============================================================================
// Bulgu: fiş kaydedilip sipariş CLOSED olduktan sonra 30 sn içinde "Yeni Mal Kabul" açılınca kapanmış sipariş
// seçicide hâlâ vardı, Bekleyen tablosu GELEN 0 gösteriyor ve kalemler yeniden DOLUYORDU — seçici `staleTime` 30 sn,
// fiş kaydı `purchase-orders`ı geçersizlemiyordu. Bir fiş üç sipariş sorgusunu birden bayatlatır: LİSTE/seçici
// (`purchase-orders`), DETAY/bekleyen kalemler (`purchase-order`), açık kalemler (`purchase-order-open-lines`).
// Tek liste, üç çağıran (create · iptal · satır ekleme) — birinin unutması aynı bulguyu geri getirir.
// =============================================================================
import type { QueryClient } from "@tanstack/react-query";
import { WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";

/** Fiş yazınca geçersizlenen sorgu anahtarları — sipariş üçlüsü DAHİL. */
export const RECEIPT_SIDE_EFFECT_KEYS: ReadonlyArray<readonly unknown[]> = [
  ["goods-receipts"],
  ["rolls"],
  // İplik satırı `YarnMovement` doğurur — İplik Stoku ["yarn", …] anahtarlarını kullanır; bakiye bayat kalmasın.
  ["yarn"],
  WAREHOUSES_QUERY_KEY,
  ["purchase-orders"],
  ["purchase-order"],
  ["purchase-order-open-lines"],
];

export function invalidateReceiptSideEffects(qc: Pick<QueryClient, "invalidateQueries">): void {
  for (const queryKey of RECEIPT_SIDE_EFFECT_KEYS) void qc.invalidateQueries({ queryKey: [...queryKey] });
}
