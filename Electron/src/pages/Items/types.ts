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

export interface ItemColorLink {
  colorId: string;
  color: ItemColorLite;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  unit: string;
  isActive: boolean;
  /** Item'a uygulanabilir özellikler (kataloğu). Boşsa = serbest. */
  allowedProperties?: ItemPropertyLink[];
  /** Item'a uygulanabilir renkler (kataloğu). Boşsa = serbest. */
  allowedColors?: ItemColorLink[];
  createdAt: string;
  updatedAt: string;
}

export interface ItemCreatePayload {
  code: string;
  name: string;
  itemType: ItemType;
  unit?: string;
  isActive?: boolean;
  allowedPropertyIds?: string[];
  allowedColorIds?: string[];
}
