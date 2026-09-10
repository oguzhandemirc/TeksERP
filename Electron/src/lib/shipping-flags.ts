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

/** Sevk belgesinde ürün adı hangi dilden basılır. `bizdeki` = bugünkü çıktı. */
export type ShippingDocItemNameMode = "bizdeki" | "musterideki" | "ikisi";
/** Çeki listesi bölümünün ad rejimi. `devral` = genel rejimi izle (bugünkü davranış). */
export type ShippingDocCekiNameMode = "devral" | "bizdeki" | "musterideki" | "ikisi";

/**
 * KAPSAMA rejimi — `ShipmentOrderRequirement` ile DİK eksen.
 * `orderRequirement` "sipariş seçildi mi" (niyet), bu "mal deftere yazıldı mı" (sonuç).
 * `off` = bugünkü davranış.
 */
export type ShippingOrderCoverage = "off" | "warn" | "block";

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

export const SHIPPING_DOC_ITEM_NAME_MODE_OPTIONS: ReadonlyArray<{
  value: ShippingDocItemNameMode;
  label: string;
  hint: string;
}> = [
  {
    value: "bizdeki",
    label: "Bizdeki ad (varsayılan)",
    hint: "Belgede yalnız kendi ürün adımız basılır. Bugünkü çıktı.",
  },
  {
    value: "musterideki",
    label: "Müşterideki ad",
    hint: "Müşterinin bu ürüne verdiği ad basılır; o müşteride karşılığı yoksa bizim adımız basılır.",
  },
  {
    value: "ikisi",
    label: "İkisi de (iki kolon)",
    hint: "Ürün ve çeki listesine ayrı bir “müşteri adı” sütunu eklenir.",
  },
] as const;

export const DEFAULT_SHIPPING_DOC_ITEM_NAME_MODE: ShippingDocItemNameMode = "bizdeki";

export const SHIPPING_DOC_CEKI_NAME_MODE_OPTIONS: ReadonlyArray<{
  value: ShippingDocCekiNameMode;
  label: string;
  hint: string;
}> = [
  {
    value: "devral",
    label: "Genel ayarı izle (varsayılan)",
    hint: "Çeki listesi, üstteki “Sevk belgesinde ürün adı” ayarının dediğini yapar. Bugünkü davranış.",
  },
  {
    value: "bizdeki",
    label: "Bizdeki ad",
    hint: "Çeki listesinde yalnız kendi desen/renk adımız yazar — genel ayar ne olursa olsun.",
  },
  {
    value: "musterideki",
    label: "Müşterideki ad",
    hint: "Çeki listesinde müşterinin verdiği ad yazar; karşılığı yoksa bizim adımız basılır.",
  },
  {
    value: "ikisi",
    label: "İkisi de (iki kolon)",
    hint: "Çeki listesinde hem bizim hem müşterinin adı yan yana yazar — ambar kontrolü için.",
  },
] as const;

export const DEFAULT_SHIPPING_DOC_CEKI_NAME_MODE: ShippingDocCekiNameMode = "devral";

export const SHIPPING_ORDER_COVERAGE_OPTIONS: ReadonlyArray<{
  value: ShippingOrderCoverage;
  label: string;
  hint: string;
}> = [
  {
    value: "off",
    label: "Sorma (varsayılan)",
    hint: "Siparişe yazılamayan mal olsa da sevkiyat sessizce kurulur. Bugünkü davranış.",
  },
  {
    value: "warn",
    label: "Uyar",
    hint: "Sevkiyat kurulur ama “siparişe yazılamayan ~N m mal var” uyarısı çıkar — tablette de.",
  },
  {
    value: "block",
    label: "Zorunlu tut",
    hint: 'Siparişe yazılamayan mal varsa sevkiyat kurulamaz; "Siparişsiz/fazla mal" işaretlenirse geçer.',
  },
] as const;

export const DEFAULT_SHIPPING_ORDER_COVERAGE: ShippingOrderCoverage = "off";

/** Değer geçerli mi (sunucudan gelen bilinmeyen metni sağlamlaştırır). */
export function isShipmentOrderRequirement(v: unknown): v is ShipmentOrderRequirement {
  return v === "off" || v === "warn" || v === "block";
}

export function isShippingInvoiceMode(v: unknown): v is ShippingInvoiceMode {
  return v === "dis" || v === "ic" || v === "ikisi";
}

export function isShippingDocItemNameMode(v: unknown): v is ShippingDocItemNameMode {
  return v === "bizdeki" || v === "musterideki" || v === "ikisi";
}

export function isShippingDocCekiNameMode(v: unknown): v is ShippingDocCekiNameMode {
  return v === "devral" || v === "bizdeki" || v === "musterideki" || v === "ikisi";
}

export function isShippingOrderCoverage(v: unknown): v is ShippingOrderCoverage {
  return v === "off" || v === "warn" || v === "block";
}

/**
 * PAKETLEME GRUBU numara sayacının rejimi. `artan` = sahanın istediği davranış.
 * Backend aynası: `system-setting.service.ts` → `PACKING_GROUP_NUMBERINGS`.
 */
export type PackingGroupNumbering = "artan" | "bosluk-doldur";

export const PACKING_GROUP_NUMBERING_OPTIONS: ReadonlyArray<{
  value: PackingGroupNumbering;
  label: string;
  hint: string;
}> = [
  {
    value: "artan",
    label: "Artan (varsayılan)",
    hint: "Yeni grup, açık grupların en büyük numarasının bir fazlasını alır. “3. Grup sevk edildi, 5. Grup duruyor” ise yeni grup 6 olur — boşalan numaraya geri dönülmez, aynı gün iki farklı “3. Grup” dolaşmaz.",
  },
  {
    value: "bosluk-doldur",
    label: "Boşluğu doldur",
    hint: "Yeni grup en küçük boş numarayı alır (1 ve 3 doluysa yeni grup 2 olur). Numaralar sıkı kalır ama sevk edilen bir numara aynı gün yeniden doğabilir.",
  },
];
