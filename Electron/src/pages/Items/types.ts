import type { ItemType } from "@/types/enums";
import type { ItemLifecycleStatus } from "@/lib/item-lifecycle";

/** SY-a: iplik satın alma birimi — backend `YarnPurchaseUnit` aynası. */
export type YarnPurchaseUnit = "KG" | "ADET" | "METRE";

/** K8 yanmazlık — kapalı küme (sunucu pg enum); null = belirtilmemiş. */
export type FlameRetardancy = "NONE" | "FR_YARN" | "TREVIRA_CS" | "OTHER_FR";

/** D4b iplik büküm yönü / parlaklık — backend `YarnTwistDirection` / `YarnLuster` aynası; null = belirtilmemiş. */
export type YarnTwistDirection = "S" | "Z";
export type YarnLuster = "BRIGHT" | "SEMI_DULL" | "FULL_DULL";

/** D4b kart alanları (eski sunucuda yok): kumaş top boyu/asgari sipariş/bakım · iplik teknik · iplik+sarf asgari stok. */
export interface ItemCardExtra {
  standardRollLengthM?: string | number | null;
  minOrderQty?: string | number | null;
  careInstructions?: string | null;
  yarnFilamentCount?: number | null;
  yarnPly?: number | null;
  yarnTwistTpm?: number | null;
  yarnTwistDirection?: YarnTwistDirection | null;
  yarnLuster?: YarnLuster | null;
  minStockQty?: string | number | null;
}

/** Gövdede: sayılar noktalı metin, boş = `null` (temizle); anahtar yalnız dolu ya da kayıtlı değer temizleniyorsa gider. */
export type ItemCardExtraPayload = { [K in keyof ItemCardExtra]?: string | null };

export interface ItemFiberLink {
  fiberTypeId: string;
  pct: string | number;
  fiberType?: { id: string; name: string; abbreviation: string | null };
}

/** `GET /api/items/:id/computed-composition` — bilinmiyorsa `parts`/`text` null, sebep `status`. */
export interface ItemComputedComposition {
  status: "OK" | "NOT_FABRIC" | "MISSING_STRUCTURE" | "MISSING_FIBER";
  parts: Array<{ fiberTypeId: string; name: string; abbreviation: string | null; pct: number }> | null;
  text: string | null;
  manual: string | null;
  missingYarns: Array<{ id: string; name: string; code?: string }>;
}

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

export interface Item extends ItemCardExtra {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  unit: string;
  isActive: boolean;
  /** Yaşam döngüsü (eski sunucuda yok → `itemLifecycleOf` isActive'ten türetir). */
  lifecycleStatus?: ItemLifecycleStatus;
  /** İplik inceliği (denye). Yalnız YARN'da dolu; çözgü kartı bunu ister. */
  linearDensityDen: string | number | null;
  /** SY-3 I2: iplik başına fire % (yalnız YARN; boş = çözgü/atkı kartının fire zinciri). Eski sunucuda yok. */
  yarnWastePct?: string | number | null;
  /** SY-a: satın alma birimi (yalnız YARN; null = kg). Eski sunucuda yok. */
  yarnPurchaseUnit?: YarnPurchaseUnit | null;
  /** SY-a: iplik metresindeki adet (pul/payet; yalnız ADET). */
  yarnPiecesPerM?: string | number | null;
  /** KUMAŞ → varsayılan çözgü kartı (E4, 2026-09-18): dokuma işi formu ve sunucu ön-dolum kaynağı; yalnız FABRIC. */
  warpSpecId?: string | null;
  /** SY-A4: atkı kartı + desen kartı (yalnız KUMAŞ; eski sunucuda yok). */
  weftSpecId?: string | null;
  weaveDesignId?: string | null;
  /** T1: tahar planı (yalnız KUMAŞ; eski sunucuda yok). */
  drawingInPlanId?: string | null;
  /** D3: liste "Desen" sütunu (kod + mekanizma · örgü); eski sunucuda yok → "—". */
  weaveDesign?: { id: string; code: string; name: string; kind?: string | null; shedMechanism?: string | null; weaveStructure?: string | null } | null;
  /** K4P ürün kartı eni (cm); Decimal metin gelir. Eski sunucuda yok. */
  widthCm?: string | number | null;
  /** Dokuma ayrıntıları (yalnız KUMAŞ; Decimal sayı/metin gelir; eski sunucuda yok). */
  rawWidthCm?: string | number | null;
  rawGsm?: string | number | null;
  finishedGsm?: string | number | null;
  /** K7/K8 (yalnız KUMAŞ; eski sunucuda yok): kompozisyonun ELLE düzeltmesi (boş = hesaplanan), kumaş türü, yanmazlık. */
  composition?: string | null;
  fabricTypeId?: string | null;
  fabricType?: { id: string; name: string } | null;
  flameRetardancy?: FlameRetardancy | null;
  /** K7: iplik lif bileşimi (yalnız İPLİK; pay Decimal metin). */
  fibers?: ItemFiberLink[];
  /** Saha (mobil KK1) "yeni desen" olarak açtı → admin gözden geçirmesi bekleniyor. */
  pendingReview?: boolean;
  /** Item'a uygulanabilir özellikler (kataloğu). Boşsa = serbest. */
  allowedProperties?: ItemPropertyLink[];
  /** Item'a uygulanabilir renkler (kataloğu). Boşsa = serbest. */
  allowedColors?: ItemColorLink[];
  createdAt: string;
  updatedAt: string;
}

export interface ItemCreatePayload extends ItemCardExtraPayload {
  /** Boş/verilmezse backend STK-NNNNNN otomatik üretir. */
  code?: string;
  name: string;
  itemType: ItemType;
  unit?: string;
  isActive?: boolean;
  /** Denye — boş bırakılırsa `null` gider (kolon nullable, FABRIC'te anlamsız). */
  linearDensityDen?: string | null;
  /** SY-3 I2: iplik firesi % — yalnız YARN + maliyet açıkken; anahtar dolu ya da kayıtlı değer temizleniyorsa gider. */
  yarnWastePct?: string | null;
  /** SY-a: satın alma birimi + metredeki adet — yalnız YARN'da gider ("KG" sunucuda null'a normalize olur). */
  yarnPurchaseUnit?: YarnPurchaseUnit;
  yarnPiecesPerM?: string | null;
  /** Varsayılan çözgü kartı — yalnız KUMAŞ; boş = `null` (temizler). */
  warpSpecId?: string | null;
  /** SY-A4: atkı/desen kartı — anahtar yalnız seçici görünür ve alan dolu/temizlenmişse gider. */
  weftSpecId?: string | null;
  weaveDesignId?: string | null;
  drawingInPlanId?: string | null;
  /** K4P en (cm) — yalnız Kalite Güvence açıkken ve KUMAŞta gider; boş = `null` (temizler). */
  widthCm?: string | null;
  /** Dokuma ayrıntıları — yalnız KUMAŞ; anahtar dolu ya da kayıtlı değer temizleniyorsa gider. */
  rawWidthCm?: string | null;
  rawGsm?: string | null;
  finishedGsm?: string | null;
  /** K7/K8 — yalnız KUMAŞ; anahtar dolu ya da kayıtlı değer temizleniyorsa gider. */
  composition?: string | null;
  fabricTypeId?: string | null;
  flameRetardancy?: FlameRetardancy | null;
  /** K7 — yalnız YENİ iplik kartında (doğuşta aynı tx); düzenlemede PUT /api/items/:id/fibers. */
  fibers?: Array<{ fiberTypeId: string; pct: string }>;
  /** Düzenlemede admin onayı: kaydedince saha işareti temizlenir (false). */
  pendingReview?: boolean;
  allowedPropertyIds?: string[];
  allowedColorIds?: string[];
}

/** `GET /api/items/:id/computed-gsm` — null = bilinmiyor (hesap kapanır). */
export interface ItemComputedGsm {
  rawWidthCm: number | null;
  warpGPerM: number | null;
  weftGPerM: number | null;
  totalGPerM: number | null;
  gsm: number | null;
  enteredRawGsm: number | null;
  diffPct: number | null;
  /** Teknik özet (desen kartı şeridi) — eski sunucu göndermez (undefined = bilinmiyor). */
  endsCount?: number | null;
  endsPerCm?: number | null;
  picksPerCm?: number | null;
  picksInRepeat?: number | null;
  repeatCm?: number | null;
  repeatsPerM?: number | null;
  /** Enler (2026-11-25) — eski sunucu göndermez. Hesap SUNUCUDA (`fabric-width.helper`); panel yalnız basar. */
  finishedWidthCm?: number | null;
  reedWidthCm?: number | null;
  widthShrinkPct?: number | null;
  rawGPerMt?: number | null;
  finishedGPerMt?: number | null;
  widthWarnings?: Array<{ code: string; message: string }>;
}
