import type { Tone } from "@/components/operations/StatusBadge";

export type ShipmentStatus = "PLANNED" | "DISPATCHED" | "CANCELLED";

export const shipmentStatusLabels: Record<ShipmentStatus, string> = {
  PLANNED: "Planlı",
  DISPATCHED: "Sevk Edildi",
  CANCELLED: "İptal",
};

// Tone paleti semantiktir (StatusBadge): indigo/kırmızı literal Tone'da yok → en
// yakın anlamsal eşleme — PLANNED=info (indigo/mavi), DISPATCHED=muted,
// CANCELLED=danger (kırmızı).
export const shipmentStatusTones: Record<ShipmentStatus, Tone> = {
  PLANNED: "info",
  DISPATCHED: "muted",
  CANCELLED: "danger",
};

export type ShipmentDestination = "DOMESTIC" | "EXPORT";

export const shipmentDestinationLabels: Record<ShipmentDestination, string> = {
  DOMESTIC: "Yurt İçi",
  EXPORT: "Yurt Dışı (İhracat)",
};

/**
 * Global şube lookup öğesi (`/api/customer-branches`) — FilterBar şube filtresi.
 * `code` opsiyonel `string` (LookupItemBase ile uyum için `null` değil; backend null
 * gönderse de getLabel tolere eder). Şube adları müşteri arası tekrar edebilir →
 * `customer.name` etikette ayrım sağlar.
 */
export interface BranchLookupItem {
  id: string;
  name: string;
  code?: string;
  city?: string;
  customer: { id: string; name: string; code?: string };
}

/** Liste satırı — lean (sayılar, dizi değil). Backend listShipments select'i ile birebir. */
export interface ShipmentListItem {
  id: string;
  /** SHIPMENT = çuval sevkiyatı; DIRECT = fasondan doğrudan sevk (DirectShipment).
   *  Birleşik liste iki tabloyu tek akışta döner. */
  kind: "SHIPMENT" | "DIRECT";
  shipmentNo: string;
  status: ShipmentStatus;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  /** Yalnız DIRECT satırlarında dolu — doğrudan sevk sebebi. */
  reason?: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  /**
   * ⚠️ BRÜT (sevk anı) — iade DÜŞÜLMEZ. `_count.rolls` ve `totalMeters` iptal edilmemiş
   * iadeler geri eklenerek üretilir; böylece liste, donmuş irsaliye ve muhasebe Excel'i
   * AYNI rakamı söyler (kök CLAUDE.md 2026-08-02, SVK2007260001). İade bilgisi ayrı
   * alanda (`_count.returns`) durur ve listede rozet olarak gösterilir.
   */
  _count: { sacks: number; rolls: number; orders: number; returns: number };
  /** Brüt toplam metraj (m). DIRECT satırlarda `DirectShipment.totalQty`. */
  totalMeters: number;
  /** Çuval brüt tartısı toplamı (kg). Doğrudan sevkte çuval yok → 0. */
  totalKg: number;
  /** Fatura izi — dış muhasebe programındaki belge no/tarihi (ERP fatura kesmez). */
  invoiceNo: string | null;
  invoicedAt: string | null;
  /** Yalnız kumaş/renk (içerik) filtresi aktifken dolu — bu sevkiyattaki eşleşen top
   *  sayısı ("eşleşen: N top" rozeti). Filtre yoksa backend alanı HİÇ göndermez (undefined). */
  matchRollCount?: number;
}

/** Fasondan doğrudan sevk (DirectShipment) detayı — birleşik listeden DIRECT satırı açılınca. */
export interface DirectShipmentDetail {
  id: string;
  kind: "DIRECT";
  shipmentNo: string;
  reason: string;
  totalQty: number;
  rollCount: number;
  shippedAt: string;
  createdAt: string;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  shippedBy: string | null;
  dispatch: {
    id: string;
    dispatchNo: string;
    subcontractor: { id: string; name: string; code: string | null };
    workOrder: { id: string; workOrderNumber: string };
    stationName: string;
    stepSequence: number;
  };
  rolls: {
    id: string;
    barcode: string | null;
    itemName: string;
    colorName: string | null;
    currentQty: number;
    width: number | null;
    qualityGrade: string | null;
  }[];
  allocations: {
    orderNumber: string;
    itemName: string;
    colorName: string | null;
    qty: number;
  }[];
}

export interface ShipmentDetailLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  /** requested − shipped. */
  openQty: number;
  /** Bu sevkiyatın bu satıra düşürdüğü/düşüreceği metraj (DISPATCHED'te kesin). */
  thisShipment: number;
}

export interface ShipmentDetailOrder {
  id: string;
  orderNumber: string;
  status: string;
  deadline: string | null;
  lines: ShipmentDetailLine[];
}

export interface ShipmentDetailRoll {
  id: string;
  barcode: string | null;
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  currentQty: number;
  /** Kalite kararı (snapshot) — kalite istasyonu belirlemediyse null → UI "—". */
  qualityGrade: string | null;
  /** İçinde bulunduğu çuval (top-level rolls'da döner; içerik/iz sürme için). */
  sackId?: string | null;
  /**
   * DOLUYSA bu satır sevk edildi ama SONRADAN İADE ALINDI (2026-08-03).
   *
   * Satır çuval içeriğinde DURMAYA DEVAM EDER — "hangi çuvalda ne gitti" sorusu
   * sevk anının sorusudur ve iade onu geriye dönük değiştiremez (kök CLAUDE.md
   * 2026-08-02 brüt kuralı). Backend bu satırları `RollReturn`'den kurar; canlı
   * `Roll.sackId` iadede NULL'lanmış olduğu için veritabanında artık o çuvalda
   * DEĞİLDİR. Bu yüzden satır SALT OKUNURDUR: "çuvaldan çıkar" gibi aksiyonlar
   * açılmaz (top zaten çuvalda değil).
   */
  returned?: {
    returnId: string;
    returnedAt: string;
    reasonName: string | null;
    reasonColor: string | null;
  } | null;
}

/** Çuval içeriğinde kumaş (spec) bazlı özet — irsaliyedeki çuval dökümü. */
export interface SackProductSummary {
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  width: number | null;
  totalQty: number;
  rollCount: number;
}

export interface SackContentSwatch {
  id: string;
  barcode: string | null;
  length: number | null;
  width: number | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
}

export interface ShipmentDetailSack {
  id: string;
  sackNo: number | string;
  seq: number;
  /** Sıra etiketi ("SP3", "P-3/100") — sevkiyatta donan ön ekle; ön ek yoksa null (ekran "Çuval #n" basar). */
  seqLabel?: string | null;
  weightKg: number | null;
  /** BRÜT: hâlâ çuvalda olanlar + bu çuvaldan iade alınanlar (sonda, `returned` dolu). */
  rolls: ShipmentDetailRoll[];
  swatches: SackContentSwatch[];
  productSummary: SackProductSummary[];
  /** BRÜT top adedi (iadeler dahil) — sevk anında bu çuvalda ne gittiyse o. */
  rollCount: number;
  /** Bunların kaçı sonradan iade alındı (satır basmayan yüzeyler rozeti bundan kurar). */
  returnedCount: number;
  /** İade alınan metraj — `rollCount`/`productSummary` toplamının İÇİNDEDİR. */
  returnedQty: number;
  swatchCount: number;
}

/** Bu sevkiyattan iade edilmiş top (canlı rolls'ta görünmez; RollReturn'den gelir). */
export interface ShipmentReturnedRoll {
  id: string;
  /** İrsaliyenin kaynağı (`returnGroupId ?? id`) — çok kalemli iadede belge grup
   *  liderine bağlıdır; satırın kendi id'siyle sorulursa belge bulunamaz. */
  documentSourceId: string;
  barcode: string | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
  width: number | null;
  qty: number;
  returnedAt: string;
  reasonName: string | null;
  reasonColor: string | null;
  /** İade anında bulunduğu çuval (RollReturn.prevSackId); sackNo/seq sevkiyatın
   *  sacks[]'ından çözülür (çuval sevkiyatta kalır, top ayrılır). Legacy'de null. */
  prevSackId: string | null;
}

export interface ShipmentDetail {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  /**
   * Çıkan mal ↔ sipariş defterine yazılan farkı (m). `null` = sevkiyatın siparişi
   * yok, soru anlamsız. Sıfırdan büyükse o metraj sipariş defterine İŞLENMEDİ ve
   * sipariş "Açık" kalmıştır.
   */
  defterBoslugu: number | null;
  destination: ShipmentDestination;
  procedureCode: string | null;
  /** İrsaliye açıklaması — sevkiyata kayıtlı serbest not (annotation). */
  dispatchNote: string | null;
  /** Operatörün beyan ettiği fiziksel çuval adedi; null = beyan yok. */
  manualSackCount: number | null;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  dispatchedAt: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  orders: ShipmentDetailOrder[];
  rolls: ShipmentDetailRoll[];
  swatches: { id: string; barcode: string | null; length: number | null; width: number | null }[];
  sacks: ShipmentDetailSack[];
  returnedRolls: ShipmentReturnedRoll[];
  summary: {
    rollCount: number;
    swatchCount: number;
    totalMeters: number;
    sackCount: number;
    totalKg: number;
    returnedCount: number;
    returnedMeters: number;
  };
}
