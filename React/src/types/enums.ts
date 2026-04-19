export const ItemType = {
  YARN: "YARN",
  WARP: "WARP",
  RAW_FABRIC: "RAW_FABRIC",
  DYED_FABRIC: "DYED_FABRIC",
  CONSUMABLE: "CONSUMABLE",
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export const itemTypeLabels: Record<ItemType, string> = {
  YARN: "İplik",
  WARP: "Çözgü",
  RAW_FABRIC: "Ham Kumaş",
  DYED_FABRIC: "Boyalı Kumaş",
  CONSUMABLE: "Sarf Malzeme",
};

export const CompanyType = {
  CUSTOMER: "CUSTOMER",
  SUPPLIER: "SUPPLIER",
  SUBCONTRACTOR: "SUBCONTRACTOR",
  DYEHOUSE: "DYEHOUSE",
} as const;
export type CompanyType = (typeof CompanyType)[keyof typeof CompanyType];

export const companyTypeLabels: Record<CompanyType, string> = {
  CUSTOMER: "Müşteri",
  SUPPLIER: "Tedarikçi",
  SUBCONTRACTOR: "Fasoncu",
  DYEHOUSE: "Boyahane",
};

export const StationType = {
  INTERNAL: "INTERNAL",
  EXTERNAL: "EXTERNAL",
} as const;
export type StationType = (typeof StationType)[keyof typeof StationType];

export const stationTypeLabels: Record<StationType, string> = {
  INTERNAL: "Dahili",
  EXTERNAL: "Harici (Fason)",
};

// İstasyonun domain rolü — API davranış dispatch'i için kullanılır.
// (Ör. PROCESS_QC → Kurşun+QC2 per-roll akışı, TAMBUR → kesim/karar akışı)
export const StationKind = {
  RAW_QC: "RAW_QC",
  PROCESS_QC: "PROCESS_QC",
  TAMBUR: "TAMBUR",
  SUBCONTRACTOR: "SUBCONTRACTOR",
  PACKAGING: "PACKAGING",
  SHIPPING: "SHIPPING",
  OTHER: "OTHER",
} as const;
export type StationKind = (typeof StationKind)[keyof typeof StationKind];

export const stationKindLabels: Record<StationKind, string> = {
  RAW_QC: "Ham Kalite Kontrol (KK1)",
  PROCESS_QC: "Kurşun + Kalite Kontrol 2",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason / Boyahane",
  PACKAGING: "Paketleme",
  SHIPPING: "Sevkiyat",
  OTHER: "Diğer",
};

export const RollStatus = {
  STOCK: "STOCK",
  IN_PRODUCTION: "IN_PRODUCTION",
  PRODUCED: "PRODUCED",
  READY_FOR_SHIP: "READY_FOR_SHIP",
  SHIPPED: "SHIPPED",
  SCRAP: "SCRAP",
  AT_SUBCONTRACTOR: "AT_SUBCONTRACTOR",
  A1_STOCK: "A1_STOCK",
  RETURNED_FROM_SUBCONTRACTOR: "RETURNED_FROM_SUBCONTRACTOR",
  WAREHOUSE: "WAREHOUSE",
} as const;
export type RollStatus = (typeof RollStatus)[keyof typeof RollStatus];

export const rollStatusLabels: Record<RollStatus, string> = {
  STOCK: "Stokta",
  IN_PRODUCTION: "Üretimde",
  PRODUCED: "Üretildi",
  READY_FOR_SHIP: "Sevke Hazır",
  SHIPPED: "Sevk Edildi",
  SCRAP: "Fire",
  AT_SUBCONTRACTOR: "Fasonda",
  A1_STOCK: "A1 (2. Kalite) Stok",
  RETURNED_FROM_SUBCONTRACTOR: "Fasondan Döndü (Kapandı)",
  WAREHOUSE: "Depoda (Paketlenmiş)",
};

export const OrderStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  IN_PRODUCTION: "IN_PRODUCTION",
  PARTIAL_SHIPPED: "PARTIAL_SHIPPED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING: "Beklemede",
  APPROVED: "Onaylandı",
  IN_PRODUCTION: "Üretimde",
  PARTIAL_SHIPPED: "Kısmi Sevk",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};

export const WorkOrderStatus = {
  PLANNED: "PLANNED",
  IN_PROGRESS: "IN_PROGRESS",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type WorkOrderStatus =
  (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

export const workOrderStatusLabels: Record<WorkOrderStatus, string> = {
  PLANNED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  PAUSED: "Duraklatıldı",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};

export const WorkOrderType = {
  ORDER_PRODUCTION: "ORDER_PRODUCTION",
  STOCK_PRODUCTION: "STOCK_PRODUCTION",
  SAMPLE_PRODUCTION: "SAMPLE_PRODUCTION",
  REPAIR_REWORK: "REPAIR_REWORK",
} as const;
export type WorkOrderType =
  (typeof WorkOrderType)[keyof typeof WorkOrderType];

export const workOrderTypeLabels: Record<WorkOrderType, string> = {
  ORDER_PRODUCTION: "Siparişe Özel Üretim",
  STOCK_PRODUCTION: "Stoka Üretim",
  SAMPLE_PRODUCTION: "Numune Üretimi",
  REPAIR_REWORK: "Tamir ve Yeniden İşlem",
};

export const StepStatus = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  SKIPPED: "SKIPPED",
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const stepStatusLabels: Record<StepStatus, string> = {
  PENDING: "Bekliyor",
  ACTIVE: "Aktif",
  COMPLETED: "Tamamlandı",
  SKIPPED: "Atlandı",
};

export const TravelerCardStatus = {
  ACTIVE: "ACTIVE",
  REPRINTED: "REPRINTED",
  VOIDED: "VOIDED",
  COMPLETED: "COMPLETED",
} as const;
export type TravelerCardStatus =
  (typeof TravelerCardStatus)[keyof typeof TravelerCardStatus];

export const travelerCardStatusLabels: Record<TravelerCardStatus, string> = {
  ACTIVE: "Aktif",
  REPRINTED: "Yeniden Basıldı",
  VOIDED: "İptal",
  COMPLETED: "Tamamlandı",
};

export const ScanType = {
  ARRIVAL: "ARRIVAL",
  DEPARTURE: "DEPARTURE",
  INFO: "INFO",
} as const;
export type ScanType = (typeof ScanType)[keyof typeof ScanType];

export const scanTypeLabels: Record<ScanType, string> = {
  ARRIVAL: "Geliş",
  DEPARTURE: "Çıkış",
  INFO: "Bilgi",
};

export const ShipmentStatus = {
  PREPARING: "PREPARING",
  SHIPPED: "SHIPPED",
  CANCELLED: "CANCELLED",
} as const;
export type ShipmentStatus =
  (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const shipmentStatusLabels: Record<ShipmentStatus, string> = {
  PREPARING: "Hazırlanıyor",
  SHIPPED: "Sevk Edildi",
  CANCELLED: "İptal",
};
