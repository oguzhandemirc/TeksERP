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
  /** "Nerede?" — sunucu türetir (backend 2.11.4+); eski sunucuda YOK → panel "—". */
  nerede?: OrderNerede;
  /** "Sevk" cümlesi — sunucu türetir (backend 2.11.4+); eski sunucuda YOK → panel "—". */
  sevk?: OrderSevk;
  createdAt: string;
  updatedAt: string;
}

// ── "Nerede?" sözleşmesi (backend 2.11.4) ──────────────────────────────────
// Bütün Türkçe cümleleri SUNUCU kurar; panel `text`i ekrana, Excel'e ve PDF'e
// aynen basar. Yapısal alanlar yalnız renk/ikon içindir.
export type OrderNeredeKind =
  | "CANCELLED"
  | "ALL_SHIPPED"
  | "CLOSED"
  | "NO_WORK_ORDER"
  | "NOT_STARTED"
  | "PRODUCED_SHIPPED"
  | "STEP"
  | "FASON"
  | "READY";
export type OrderNeredeTone = "gray" | "blue" | "orange" | "green";

export interface OrderNerede {
  kind: OrderNeredeKind;
  tone: OrderNeredeTone;
  /** Tam cümle, "· +K yerde daha" dahil. */
  text: string;
  extraPlaces: number;
  overdue: boolean;
  /** overdue ise "Termini geçti" (kırmızı ek rozet), değilse null. */
  overdueText: string | null;
}

export type OrderQtyUnit = "MT" | "KG" | "ADET";

export interface OrderSevk {
  kind: "NONE" | "PARTIAL" | "ALL" | "CLOSED";
  text: string;
  shipped: number;
  requested: number | null;
  unit: OrderQtyUnit | null;
}

export interface OrderNeredeFason {
  firmId: string;
  firmName: string;
  rollCount: number;
  qty: number;
  days: number;
  text: string;
}

export interface OrderNeredeStep {
  id: string;
  sequence: number;
  name: string;
  isExternal: boolean;
  state: "DONE" | "CURRENT" | "TODO";
  rollCount: number;
  qty: number;
  fason: OrderNeredeFason[];
  text: string;
}

export interface OrderNeredeWorkOrder {
  id: string;
  workOrderNumber: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  itemName: string | null;
  colorName: string | null;
  targetQuantity: number | null;
  unit: OrderQtyUnit | null;
  steps: OrderNeredeStep[];
  ready: { rollCount: number; qty: number; text: string };
  lastMovementAt: string | null;
  /** Fabrika saat diliminde biçimli ("04.11.2026 14:32") — sunucu kurar. */
  lastMovementText: string | null;
}

/** `GET /api/orders/:id/nerede` cevabı. */
export interface OrderNeredeDetail {
  orderId: string;
  nerede: OrderNerede;
  sevk: OrderSevk;
  workOrders: OrderNeredeWorkOrder[];
}
