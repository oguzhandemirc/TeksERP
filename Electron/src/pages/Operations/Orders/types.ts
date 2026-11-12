import type { OrderStatus, WorkOrderStatus } from "@/types/enums";
import type { ItemUnitCode } from "@/lib/item-unit";
import type { ColorNameScope } from "@/services/labelService";

export interface OrderLineColor {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

export interface OrderLineItem {
  id: string;
  code: string;
  name: string;
  /** Kalem kartının birimi — satır birimi buradan kopyalanır. */
  unit?: ItemUnitCode;
  /** Item'ın olası özellikleri (allowed). Boşsa = serbest. */
  allowedProperties?: {
    propertyId: string;
    property: { id: string; code: string; name: string };
  }[];
  /** Item'ın olası renkleri (allowed). Boşsa = serbest. */
  allowedColors?: {
    colorId: string;
    color: OrderLineColor;
  }[];
}

export interface OrderLineRequiredPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

/** Satırın hedef değeri (SY-F1/F2, tasarım §7): çeşit özelliği × seçilen değer ("Kuşak markası: ZEBRA"). */
export interface OrderLineTargetValueLink {
  propertyId: string;
  valueId: string;
  property?: { id: string; code: string; name: string };
  value?: { id: string; code: string; name: string };
}

export interface OrderLine {
  id: string;
  itemId: string;
  colorId: string | null;
  quantity: number;
  /**
   * Satır birimi (MT/KG/ADET). Eski backend göndermez → metre sayılır.
   * MT dışı satırda karşılama ÖLÇÜLMEZ (`isMeasuredUnit`): shippedQty 0, Σ'ya girmez.
   */
  unit?: ItemUnitCode;
  width: number | null;
  unitPrice: string | null;
  /** Müşteri-bazlı kumaş adı override (1-shot). Boşsa master alias veya default'a düşer. */
  customerItemName: string | null;
  /** Müşteri-bazlı renk adı override (1-shot). */
  customerColorName: string | null;
  /** Sunucunun çözdüğü müşteri renk adı (satır adı → kumaşa özel → genel); yalnız detay ucunda, eski backend göndermez. */
  resolvedCustomerColorName?: string | null;
  colorNameScope?: ColorNameScope | null;
  /** Kesim/sevk için serbest not — örn. kaç parçaya bölüneceği. Tamburda görünür. */
  cutNote: string | null;
  /** Satır sevk toleransı % (0..50; NULL = fabrika ayarı); Decimal sayı ya da metin; eski backend göndermez. */
  tolerancePct?: number | string | null;
  /** Top boyu (m) — eski backend göndermez. */
  pieceLengthM?: number | string | null;
  /** Satır varyantı (SY-K1k); NULL = desen geneli. Eski backend göndermez. */
  recipeId?: string | null;
  recipe?: { id: string; code: string; name: string; variantCode: string | null } | null;
  /** Satır hedef değerleri (kuşak gibi çeşit özelliği); eski backend göndermez. */
  targetValues?: OrderLineTargetValueLink[];
  /**
   * İPTAL İZİ (2026-08-27). NULL = aktif kalem.
   * Kalem SİLİNMEZ: listede "iptal" işaretli ve salt-okunur kalır, sevk edilmiş
   * metrajı defterde durur. Sipariş iptalinden AYRI bir olaydır.
   */
  cancelledAt?: string | null;
  cancelReason?: string | null;
  item?: OrderLineItem;
  color?: OrderLineColor | null;
  /** Müşterinin istediği özellikler — WO açılırken targetProperties önerisi olur. */
  requiredProperties?: OrderLineRequiredPropertyLink[];
  /**
   * WO picker (gap) yanıtında gelir: Açık = quantity − sevk. KG/ADET satırda `null`
   * (karşılama metre defterinden ölçülmez); eski backend alanı göndermez (undefined).
   */
  openQty?: number | null;
  /** `openQty` ölçülüyor mu (`unit === MT`). Eski backend göndermez → ölçülür sayılır. */
  measured?: boolean;
  shippedQty?: number;
  reservedQty?: number;
  /**
   * Kalemin bağlandığı WO'lar. Boş veya hepsi CANCELLED ise kalem düzenlenebilir.
   * "İş Emri" rollup rozeti + bağlı-İE listesi de bu bağdan türer → id +
   * workOrderNumber taşınır. Status inline union yerine WorkOrderStatus:
   * SUPERSEDED dahil (backend tebdil sonrası gönderebilir).
   */
  workOrderLinks?: Array<{
    workOrderId: string;
    workOrder: { id: string; workOrderNumber: string; status: WorkOrderStatus };
  }>;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  branchId: string | null;
  currency: string;
  totalAmount: string | null;
  status: OrderStatus;
  shippedQty: number;
  orderDate: string;
  deadline: string | null;
  completedAt: string | null;
  manualClosedById: string | null;
  manualCloseReason: string | null;
  customer?: { id: string; code: string; name: string };
  branch?: {
    id: string;
    name: string;
    /** Müşterinin iç şube kodu — opsiyonel (null olabilir). */
    code: string | null;
    city: string | null;
    district: string | null;
  } | null;
  lines: OrderLine[];
  /**
   * "Nerede?" yapısal verisi (`order-where.helper.ts` aynası). Üretim modülü kapalıyken
   * `null`; eski backend alanı göndermez (undefined). Cümleyi panel kurar (`order-where-text.ts`).
   */
  nerede?: OrderWhere | null;
  createdAt: string;
  updatedAt: string;
}

// ── "Nerede?" (backend `services/helpers/order-where.helper.ts` aynası) ─────────
export type OrderWhereState = "IPTAL" | "TAMAM" | "IE_YOK" | "BASLANMADI" | "YERLER" | "GONDERILDI";
export type OrderWherePlaceKind = "ASAMA" | "FASON" | "HAZIR";

export interface OrderWherePlace {
  tur: OrderWherePlaceKind;
  /** ASAMA: istasyon id · FASON: firma id (çözülemeyen → null) · HAZIR: null. */
  id: string | null;
  /** ASAMA: istasyon adı · FASON: firma adı (null olabilir) · HAZIR: null. */
  ad: string | null;
  topSayisi: number;
  metre: number;
  /** Yalnız FASON: en eski gönderimden bu yana geçen fabrika günü. */
  gun: number | null;
}

export interface OrderWhere {
  durum: OrderWhereState;
  /** Sunucu sıralı: top sayısı çoktan aza. */
  yerler: OrderWherePlace[];
  // Sunucu `terminGecti` de gönderir; panel okumaz (termin vurgusu kalktı, 2026-11-12).
  sonHareket: string | null;
}

export type OrderWhereStepPhase = "GECTI" | "BURADA" | "SIRADA";

export interface OrderWhereStep {
  id: string;
  ad: string;
  asama: OrderWhereStepPhase;
  topSayisi: number;
  metre: number;
  /** Bu adımdaki toplardan fasonda olanlar. */
  fasonTop: number;
}

export interface OrderWhereQty {
  topSayisi: number;
  metre: number;
}

export interface OrderWhereWorkOrder {
  id: string;
  no: string;
  durum: WorkOrderStatus;
  kumas: string | null;
  renk: string | null;
  hedefMetre: number | null;
  adimlar: OrderWhereStep[];
  fason: Array<{ firmaId: string; firmaAd: string; topSayisi: number; metre: number; gun: number }>;
  hazir: OrderWhereQty;
  gitti: OrderWhereQty;
  sonHareket: string | null;
}

/** `GET /api/orders/:id/where` gövdesi. */
export interface OrderWhereDetail {
  orderId: string;
  nerede: OrderWhere;
  isEmirleri: OrderWhereWorkOrder[];
}
