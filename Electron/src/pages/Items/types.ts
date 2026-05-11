import type { ItemType } from "@/types/enums";

export interface ItemColorLite {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

export interface ItemPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface Item {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  unit: string;
  isActive: boolean;
  baseItemId: string | null;
  colorId: string | null;
  isDerived: boolean;
  baseItem?: { id: string; code: string; name: string } | null;
  color?: ItemColorLite | null;
  /** Item'a uygulanabilir özellikler (kataloğu). Boşsa = serbest. */
  allowedProperties?: ItemPropertyLink[];
  createdAt: string;
  updatedAt: string;
}

/** Final ürün create payload — backend'e gönderilen */
export interface ItemCreatePayload {
  code?: string;
  name?: string;
  itemType: ItemType;
  unit?: string;
  isActive?: boolean;
  isDerived: boolean;
  baseItemId?: string | null;
  colorId?: string | null;
  /** Sadece final için anlamlı; opsiyonel "olası özellikler" listesi. */
  allowedPropertyIds?: string[];
}
