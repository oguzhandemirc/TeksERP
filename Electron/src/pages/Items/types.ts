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
  /** İplik inceliği (denye). Yalnız YARN'da dolu; çözgü kartı bunu ister. */
  linearDensityDen: string | null;
  /** Saha (mobil KK1) "yeni desen" olarak açtı → admin gözden geçirmesi bekleniyor. */
  pendingReview?: boolean;
  /** Item'a uygulanabilir özellikler (kataloğu). Boşsa = serbest. */
  allowedProperties?: ItemPropertyLink[];
  /** Item'a uygulanabilir renkler (kataloğu). Boşsa = serbest. */
  allowedColors?: ItemColorLink[];
  createdAt: string;
  updatedAt: string;
}

export interface ItemCreatePayload {
  /** Boş/verilmezse backend STK-NNNNNN otomatik üretir. */
  code?: string;
  name: string;
  itemType: ItemType;
  unit?: string;
  isActive?: boolean;
  /** Denye — boş bırakılırsa `null` gider (kolon nullable, FABRIC'te anlamsız). */
  linearDensityDen?: string | null;
  /** Düzenlemede admin onayı: kaydedince saha işareti temizlenir (false). */
  pendingReview?: boolean;
  allowedPropertyIds?: string[];
  allowedColorIds?: string[];
}
