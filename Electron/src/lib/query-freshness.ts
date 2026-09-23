import type { QueryClient } from "@tanstack/react-query";

// =============================================================================
// SORGU TAZELİĞİ — panel geneli önbellek politikası (K21, 2026-09-23)
// =============================================================================
// Çok kullanıcılı ERP'de BAŞKA istemcinin (ikinci panel · tablet) açtığı kayıt 5 dk görünmüyordu
// (e2e TZ sondası: Kasa & Banka · Depo Transferi · Serbest Belgeler). Genel tazelik 30 sn; para,
// bakiye ve kasa her mount'ta tazelenir; nadiren değişen KATALOG sorguları eski 5 dk'yı korur.
// ⚠️ Yalnız `staleTime`ı AÇIKÇA vermeyen sorgulara uygulanır — sorgu düzeyindeki değer kazanır.
// =============================================================================
export const DEFAULT_STALE_MS = 30_000;
export const CATALOG_STALE_MS = 5 * 60_000;

/** Para · bakiye · kasa: her mount'ta tazelenir (yanlış bakiye bir doğruluk hatasıdır). */
export const MONEY_KEYS: readonly string[] = ["finance"];

/** Nadiren değişen, kimsenin günlük işte değiştirmediği katalog verisi — eski 5 dk korunur. */
export const CATALOG_KEYS: readonly string[] = [
  "label-templates", "label-template", "label-template-variants", "label-template-catalog", "label-context-defaults",
  "documents-logo", "station-capabilities", "reason-presets",
];

export function applyQueryFreshness(qc: QueryClient): void {
  for (const k of MONEY_KEYS) qc.setQueryDefaults([k], { staleTime: 0 });
  for (const k of CATALOG_KEYS) qc.setQueryDefaults([k], { staleTime: CATALOG_STALE_MS });
}
