// =============================================================================
// "TÜKENENE KADAR" KART AYARLARI — backend `helpers/item-lifecycle-settings.helper.ts`
// aynası (URUN-YASAM-DONGUSU.md §4.1). Değer kümesi ve varsayılanlar backend ile
// BİREBİR olmalı; sözleşme bekçisi (`test_feature_flag_contract` §16) varsayılanı ölçer.
// =============================================================================

export type PhaseOutNewOrder = "OKUTULAN_TOPLAR" | "KAPALI" | "SERBEST";
export type PhaseOutLineQty = "SERBEST_UYARILI" | "AZALTMA_SERBEST" | "KILITLI";

export const PHASE_OUT_NEW_ORDER_OPTIONS: ReadonlyArray<{ value: PhaseOutNewOrder; label: string; hint: string }> = [
  {
    value: "OKUTULAN_TOPLAR",
    label: "Yalnız okutulan toplar (varsayılan)",
    hint: "Yeni sipariş yalnız toplardan hızlı siparişle açılır; miktar okutulan topların toplamıdır.",
  },
  {
    value: "KAPALI",
    label: "Kapalı",
    hint: "Tükenene kadar karta hiç yeni sipariş satırı açılmaz. Sevkte sipariş zorunluysa: Bu ayarlarla 'Tükenene kadar' kartların malı yalnız 'Siparişsiz devam et' ile sevk edilebilir.",
  },
  {
    value: "SERBEST",
    label: "Serbest",
    hint: "Normal kart gibi yeni sipariş açılır.",
  },
] as const;

export const PHASE_OUT_LINE_QTY_OPTIONS: ReadonlyArray<{ value: PhaseOutLineQty; label: string; hint: string }> = [
  {
    value: "SERBEST_UYARILI",
    label: "Serbest, uyarılı (varsayılan)",
    hint: "Açık satırda miktar artırılıp azaltılabilir; kısa bir stok uyarısı görünür.",
  },
  {
    value: "AZALTMA_SERBEST",
    label: "Yalnız azaltma",
    hint: "Açık satırda miktar azaltılabilir, artırma reddedilir.",
  },
  {
    value: "KILITLI",
    label: "Kilitli",
    hint: "Açık satırda miktar değiştirilemez.",
  },
] as const;
