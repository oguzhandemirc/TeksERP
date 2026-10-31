import type { ItemType } from "@/types/enums";
import type { ItemLifecycleStatus } from "@/lib/item-lifecycle";

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
  /** Yaşam döngüsü (eski sunucuda yok → `itemLifecycleOf` isActive'ten türetir). */
  lifecycleStatus?: ItemLifecycleStatus;
  /** İplik inceliği (denye). Yalnız YARN'da dolu; çözgü kartı bunu ister. */
  linearDensityDen: string | null;
  /** KUMAŞ → varsayılan çözgü kartı (E4, 2026-09-18): dokuma işi formu ve sunucu ön-dolum kaynağı; yalnız FABRIC. */
  warpSpecId?: string | null;
  /** SY-A4: atkı kartı + desen kartı (yalnız KUMAŞ; eski sunucuda yok). */
  weftSpecId?: string | null;
  weaveDesignId?: string | null;
  /** K4P ürün kartı eni (cm); Decimal metin gelir. Eski sunucuda yok. */
  widthCm?: string | number | null;
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
  /** Varsayılan çözgü kartı — yalnız KUMAŞ; boş = `null` (temizler). */
  warpSpecId?: string | null;
  /** SY-A4: atkı/desen kartı — anahtar yalnız seçici görünür ve alan dolu/temizlenmişse gider. */
  weftSpecId?: string | null;
  weaveDesignId?: string | null;
  /** K4P en (cm) — yalnız Kalite Güvence açıkken ve KUMAŞta gider; boş = `null` (temizler). */
  widthCm?: string | null;
  /** Düzenlemede admin onayı: kaydedince saha işareti temizlenir (false). */
  pendingReview?: boolean;
  allowedPropertyIds?: string[];
  allowedColorIds?: string[];
}
