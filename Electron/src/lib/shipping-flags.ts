// =============================================================================
// SEVKİYAT ENUM BAYRAKLARI — DEĞER KÜMELERİ + ETİKETLER (Electron aynası)
// =============================================================================
// Electron backend'i import EDEMEZ (ayrı proje, ayrı tsconfig) → değer kümesi
// burada AYNALANIR. `mobil/src/types/permissions.ts` ile aynı durum.
//
// ⚠️ AYNA SESSİZ AYRIŞIR: burada bir değer eksik/fazla olursa panel ya geçerli
// bir seçeneği hiç göstermez ya da backend'in reddedeceği bir değeri yazdırır
// (PATCH 400, "kaydedilmedi" diye bir yerde yazmaz). Backend tarafındaki tek
// kaynak `system-setting.service.ts` → `SHIPMENT_ORDER_REQUIREMENTS` /
// `SHIPPING_INVOICE_MODES`; bekçi `Teks-Erp/scripts/test_feature_flag_contract.ts`
// §16 panel satırını (enumKey) ve VARSAYILANI mekanik doğrular.
// =============================================================================

/** Sevkiyat ↔ sipariş bağı zorunluluğu. `warn` = bugünkü davranış. */
export type ShipmentOrderRequirement = "off" | "warn" | "block";

/** Sevkin fatura izi nereden yazılır. `dis` = bugünkü davranış. */
export type ShippingInvoiceMode = "dis" | "ic" | "ikisi";

export const SHIPMENT_ORDER_REQUIREMENT_OPTIONS: ReadonlyArray<{
  value: ShipmentOrderRequirement;
  label: string;
  /** Seçeneğin ALTINDA çizilen tek cümle — seçim ekranda gerekçelenir. */
  hint: string;
}> = [
  {
    value: "off",
    label: "Sorma",
    hint: "Siparişsiz sevkte uyarı çıkmaz. (Fazla mal ve mükerrer sevk uyarıları yerinde kalır.)",
  },
  {
    value: "warn",
    label: "Uyar (varsayılan)",
    hint: "Siparişsiz sevk kurulur, ekranda uyarı çıkar. Bugünkü davranış.",
  },
  {
    value: "block",
    label: "Zorunlu tut",
    hint: 'Sipariş seçilmeden sevkiyat kurulamaz; "Siparişsiz devam et" işaretlenirse geçer.',
  },
] as const;

export const DEFAULT_SHIPMENT_ORDER_REQUIREMENT: ShipmentOrderRequirement = "warn";

export const SHIPPING_INVOICE_MODE_OPTIONS: ReadonlyArray<{
  value: ShippingInvoiceMode;
  label: string;
  hint: string;
}> = [
  {
    value: "dis",
    label: "Dış programdan (varsayılan)",
    hint: "Fatura dış muhasebe programında kesilir; buraya yalnız numarası işaretlenir. Bugünkü davranış.",
  },
  {
    value: "ic",
    label: "Yalnız ERP faturası",
    hint: "Numara elle işaretlenemez; fatura Muhasebe → Faturalar'dan kesilir ve onaylanınca sevke kendisi işlenir.",
  },
  {
    value: "ikisi",
    label: "İkisi de (geçiş dönemi)",
    hint: "Elle işaret serbest; sevkin ERP faturası varsa uyarı çıkar ama engellenmez.",
  },
] as const;

export const DEFAULT_SHIPPING_INVOICE_MODE: ShippingInvoiceMode = "dis";

/** Değer geçerli mi (sunucudan gelen bilinmeyen metni sağlamlaştırır). */
export function isShipmentOrderRequirement(v: unknown): v is ShipmentOrderRequirement {
  return v === "off" || v === "warn" || v === "block";
}

export function isShippingInvoiceMode(v: unknown): v is ShippingInvoiceMode {
  return v === "dis" || v === "ic" || v === "ikisi";
}
