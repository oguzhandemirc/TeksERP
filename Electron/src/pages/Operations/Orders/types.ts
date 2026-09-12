import type { OrderStatus, WorkOrderStatus } from "@/types/enums";
import type { ItemUnitCode } from "@/lib/item-unit";

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
  /** WO picker (gap) yanıtında gelir: Açık = quantity − sevk − canlı rezerve. */
  openQty?: number;
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
  createdAt: string;
  updatedAt: string;
}
