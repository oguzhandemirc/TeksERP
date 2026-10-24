// Rapor v2 desen boyutu beyanı (R1-BOYUT). Semantik boyut kaydı R1-SEMKUP'ta bu beyandan okunur.
/**
 * Desen boyutu beyanı: `Item.weaveDesignId` (DOKUMA S2) şemada YOK (2026-10-24 ölçüldü) →
 * boyut KAPALI (fail-closed); o güne dek "Ürün (kumaş)" boyutu desen dilinde okunur.
 */
export const PATTERN_DIMENSION = {
  label: "Desen",
  enabled: false,
  closedReason: "Kapalı — DOKUMA S2 (ürünün desen bağı) bekleniyor",
  fallbackLabel: "Ürün (kumaş / desen)",
} as const;
