// =============================================================================
// ÜRÜN SEÇİCİ MODALI — saf katman (v3 kalıbı, tedarikçi modalı emsali): süzgeç durumu → sunucu parametresi, satır
// =============================================================================
// Kullanıcı isteği (2026-09-17): alış siparişi / mal kabul kalemindeki "Ürün ara" kutusu MODAL açsın; tam liste
// kaydırılabilir, arama + TEK seçimli filtreler (Tür · Renk · Özellik), süzme SUNUCUDA. Renk/özellik ürüne kimlik
// olarak bağlı değil: izinli liste (`ItemAllowedColor`), BOŞ = her renk serbest — sunucu `filter[allowedColorId]`
// bunu "bu rengi alabileceğim ürünler" diye çözer (`none OR some`), o yüzden listesi boş ürün her renkte görünür.
// =============================================================================
import { itemTypeLabels, type ItemType } from "@/types/enums";
import type { Item } from "@/pages/Items/types";

export const ITEM_PICKER_PAGE = 50;
export type ItemTypeFilter = "ALL" | ItemType;

export interface ItemPickerFilterState {
  type: ItemTypeFilter;
  colorId: string | null;
  propertyId: string | null;
}
export const ITEM_PICKER_INITIAL: ItemPickerFilterState = { type: "ALL", colorId: null, propertyId: null };

export const ITEM_TYPE_LABEL: Record<ItemType, string> = itemTypeLabels;
export const ITEM_TYPE_FILTER_OPTIONS: readonly { value: ItemTypeFilter; label: string }[] = [
  { value: "ALL", label: "Tümü" },
  { value: "YARN", label: ITEM_TYPE_LABEL.YARN },
  { value: "FABRIC", label: ITEM_TYPE_LABEL.FABRIC },
  { value: "CONSUMABLE", label: ITEM_TYPE_LABEL.CONSUMABLE },
];
/** Radix Select boş string değeri kabul etmez — "Tümü" seçeneği bu sabitle taşınır. */
export const ITEM_PICKER_ANY = "__ANY__";

/** Sunucu süzgeci: `isActive:"true"` taban; diğerleri YALNIZ seçiliyse (seçilmeyen anahtar gönderilmez — istek bayt bayt eski). */
export function itemPickerFilters(f: ItemPickerFilterState): Record<string, string> {
  return {
    isActive: "true",
    ...(f.type !== "ALL" ? { itemType: f.type } : {}),
    ...(f.colorId ? { allowedColorId: f.colorId } : {}),
    ...(f.propertyId ? { allowedPropertyId: f.propertyId } : {}),
  };
}

export const hasItemPickerFilter = (f: ItemPickerFilterState): boolean => f.type !== "ALL" || f.colorId !== null || f.propertyId !== null;

export interface ItemPickerRow {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  unit: string;
  /** İzinli renkler — ilk 3; `colorMore` fazlasının sayısı. Boş liste = her renk serbest. */
  colors: { code: string; name: string; hex: string | null }[];
  colorMore: number;
  /** İzinli özellik adları — ilk 3; `propertyMore` fazlası. */
  properties: string[];
  propertyMore: number;
  isActive: boolean;
}

const SHOWN = 3;

export function itemPickerRow(it: Item): ItemPickerRow {
  const colors = (it.allowedColors ?? []).map((l) => ({ code: l.color.code, name: l.color.name, hex: l.color.hex }));
  const properties = (it.allowedProperties ?? []).map((l) => l.property.name);
  return {
    id: it.id,
    code: it.code,
    name: it.name,
    itemType: it.itemType,
    unit: it.unit,
    colors: colors.slice(0, SHOWN),
    colorMore: Math.max(0, colors.length - SHOWN),
    properties: properties.slice(0, SHOWN),
    propertyMore: Math.max(0, properties.length - SHOWN),
    isActive: it.isActive !== false,
  };
}

/** Tetik metni: AD önce, KOD sonra (tedarikçi etiket kararıyla aynı). */
export const itemTriggerLabel = (r: { code: string; name: string }): string => `${r.name} — ${r.code}`;

export const ITEM_PICKER_EMPTY = "Ürün kartı yok — Tanımlar → Ürünler'den açın.";
export const ITEM_PICKER_FILTERED_EMPTY = "Süzgece uyan ürün yok.";
