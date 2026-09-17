// =============================================================================
// ÜRÜNLER LİSTESİ — süzgeç şeridi (saf katman)
// =============================================================================
// Süzme SUNUCUDA. Tür/Birim URL `filter[itemType]` / `filter[unit]` (useDataTable okur,
// BaseService `safeFilters` skaler kolonu kabul eder). Durum ise sayfanın KENDİ URL
// parametresi `status` → CrudPage `extraFilters`: tek seçim İKİ backend kolonuna açılır
// (Aktif/Pasif = isActive, Onay bekleyen = pendingReview) — `filter[...]` öneki BİLEREK yok,
// useDataTable o öneki sunucuya aynen geçirirdi. Tür seçenekleri ürün seçici modalıyla ORTAK
// (`itemPicker.ts`, "ALL" = Tümü). Bekçi: `ItemsPage.test.tsx`.
// =============================================================================
import { ITEM_TYPE_FILTER_OPTIONS, colorAxisApplies, type ItemTypeFilter } from "@/components/forms/itemPicker";
import type { CatalogOption } from "@/components/forms/useItemPickerData";
import { ITEM_UNIT_CODES, ITEM_UNIT_LABEL } from "@/lib/item-unit";

export type ItemStatusFilter = "active" | "inactive" | "pending" | "all";

export const ITEM_STATUS_PARAM = "status";
/** Bugünkü davranış: pasifler gizli (eski "Pasifleri göster" anahtarı kapalı). */
export const ITEM_STATUS_DEFAULT: ItemStatusFilter = "active";

export const ITEM_STATUS_OPTIONS: readonly { value: ItemStatusFilter; label: string }[] = [
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Pasif" },
  { value: "pending", label: "Onay bekleyen" },
  { value: "all", label: "Tümü" },
];

export function parseItemStatus(raw: string | null): ItemStatusFilter {
  return ITEM_STATUS_OPTIONS.some((o) => o.value === raw) ? (raw as ItemStatusFilter) : ITEM_STATUS_DEFAULT;
}

/** Durum → backend süzgeci. "Onay bekleyen" `isActive`e dokunmaz: sahadan açılıp pasife alınmış desen de görünür. */
export function itemStatusFilters(s: ItemStatusFilter): Record<string, string> {
  switch (s) {
    case "active":
      return { isActive: "true" };
    case "inactive":
      return { isActive: "false" };
    case "pending":
      return { pendingReview: "true" };
    case "all":
      return {};
  }
}

/** "Tümü" değeri — Radix boş string kabul etmez; ürün seçicinin `ItemTypeFilter` "ALL"ı ile aynı. */
export const ITEM_FILTER_ALL = "ALL";

export type ItemUrlFilterKey = "itemType" | "unit" | "allowedColorId" | "allowedPropertyId";

export interface ItemUrlFilterDef {
  /** Backend süzgeç adı = URL `filter[<key>]` (itemType/unit skaler kolon; allowed* ilişki süzgeci, item.service `extraWhere`). */
  key: ItemUrlFilterKey;
  label: string;
  options: readonly { value: string; label: string }[];
}

export const ITEM_URL_FILTERS: readonly ItemUrlFilterDef[] = [
  { key: "itemType", label: "Tür", options: ITEM_TYPE_FILTER_OPTIONS },
  { key: "unit", label: "Birim", options: [{ value: ITEM_FILTER_ALL, label: "Tümü" }, ...ITEM_UNIT_CODES.map((u) => ({ value: u, label: ITEM_UNIT_LABEL[u] }))] },
];

export const itemUrlFilterParam = (key: ItemUrlFilterKey) => `filter[${key}]`;

/** Renk/Özellik ekseninin URL anahtarları — Tür kumaş dışına çıkınca ikisi de silinir. */
export const ITEM_CATALOG_KEYS: readonly ItemUrlFilterKey[] = ["allowedColorId", "allowedPropertyId"];

/** URL'deki Tür süzgeci (yok = "ALL"). Bilinmeyen değer kumaş sayılmaz → renk ekseni kapanır (fail-closed). */
export const itemTypeFilterFromParams = (sp: URLSearchParams): ItemTypeFilter => (sp.get(itemUrlFilterParam("itemType")) ?? ITEM_FILTER_ALL) as ItemTypeFilter;

/** Renk/Özellik seçicileri çizilir mi — modalın yüklemi (`colorAxisApplies`, kopya yok): yalnız Kumaş ve "Tümü". */
export const itemCatalogAxisApplies = (sp: URLSearchParams): boolean => colorAxisApplies(itemTypeFilterFromParams(sp));

/** Tür değişince URL: anahtar yazılır/silinir; kumaş dışına çıkınca Renk/Özellik anahtarları da SIFIRLANIR
 *  (modaldaki `withItemType` ile aynı karar — seçici çizilmezken sunucuya gizli süzgeç gitmesin). */
export function itemTypeChangeParams(sp: URLSearchParams, type: string): URLSearchParams {
  const next = new URLSearchParams(sp);
  if (type === ITEM_FILTER_ALL) next.delete(itemUrlFilterParam("itemType"));
  else next.set(itemUrlFilterParam("itemType"), type);
  if (!colorAxisApplies(type as ItemTypeFilter)) for (const k of ITEM_CATALOG_KEYS) next.delete(itemUrlFilterParam(k));
  return next;
}

export interface ItemCatalogFilterDef extends Omit<ItemUrlFilterDef, "options"> {
  /** `null` = katalog sığmadı (`loadAllForPicker` fırlattı) → seçici hiç çizilmez, liste çalışır (modalla aynı karar). */
  options: readonly { value: string; label: string }[] | null;
}

/** Renk/Özellik süzgeçleri — kaynak ürün seçici modalıyla ORTAK (`useItemPickerCatalogs`), kopya yükleyici yok.
 *  `filter[allowedColorId]` sunucuda "bu rengi alabilecek ürünler" (none OR some) diye çözülür. */
export function itemCatalogFilterDefs(c: { colors: CatalogOption[] | null; properties: CatalogOption[] | null }): ItemCatalogFilterDef[] {
  const withAll = (list: CatalogOption[] | null) =>
    list === null ? null : [{ value: ITEM_FILTER_ALL, label: "Tümü" }, ...list.map((o) => ({ value: o.id, label: o.label }))];
  return [
    { key: "allowedColorId", label: "Renk", options: withAll(c.colors) },
    { key: "allowedPropertyId", label: "Özellik", options: withAll(c.properties) },
  ];
}
