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
import { ITEM_TYPE_FILTER_OPTIONS } from "@/components/forms/itemPicker";
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

export interface ItemUrlFilterDef {
  /** Backend kolon adı = URL `filter[<key>]`. */
  key: "itemType" | "unit";
  label: string;
  options: readonly { value: string; label: string }[];
}

export const ITEM_URL_FILTERS: readonly ItemUrlFilterDef[] = [
  { key: "itemType", label: "Tür", options: ITEM_TYPE_FILTER_OPTIONS },
  { key: "unit", label: "Birim", options: [{ value: ITEM_FILTER_ALL, label: "Tümü" }, ...ITEM_UNIT_CODES.map((u) => ({ value: u, label: ITEM_UNIT_LABEL[u] }))] },
];

export const itemUrlFilterParam = (key: ItemUrlFilterDef["key"]) => `filter[${key}]`;
