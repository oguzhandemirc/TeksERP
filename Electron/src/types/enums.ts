export const ItemType = {
  FABRIC: "FABRIC",
  YARN: "YARN",
  WARP: "WARP",
  CONSUMABLE: "CONSUMABLE",
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export const itemTypeLabels: Record<ItemType, string> = {
  FABRIC: "Kumaş",
  YARN: "İplik",
  WARP: "Çözgü",
  CONSUMABLE: "Sarf Malzeme",
};

/** Her ürün tipi için kullanılan birim — kullanıcı düzenleyemez. */
export const unitForItemType: Record<ItemType, string> = {
  FABRIC: "MT",
  YARN: "KG",
  WARP: "MT",
  CONSUMABLE: "ADET",
};

export const CompanyType = {
  CUSTOMER: "CUSTOMER",
  SUPPLIER: "SUPPLIER",
} as const;
export type CompanyType = (typeof CompanyType)[keyof typeof CompanyType];

export const companyTypeLabels: Record<CompanyType, string> = {
  CUSTOMER: "Müşteri",
  SUPPLIER: "Tedarikçi",
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

export const StationKind = {
  RAW_QC: "RAW_QC",
  PROCESS_QC: "PROCESS_QC",
  TAMBUR: "TAMBUR",
  SUBCONTRACTOR: "SUBCONTRACTOR",
  OTHER: "OTHER",
} as const;
export type StationKind = (typeof StationKind)[keyof typeof StationKind];

export const stationKindLabels: Record<StationKind, string> = {
  RAW_QC: "Ham Kalite Kontrol (KK1)",
  PROCESS_QC: "Kurşun + Kalite Kontrol 2",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason / Dış İşlem",
  OTHER: "Diğer",
};

export const DefectSeverity = {
  MINOR: "MINOR",
  MAJOR: "MAJOR",
  CRITICAL: "CRITICAL",
} as const;
export type DefectSeverity = (typeof DefectSeverity)[keyof typeof DefectSeverity];

export const defectSeverityLabels: Record<DefectSeverity, string> = {
  MINOR: "Düşük",
  MAJOR: "Orta",
  CRITICAL: "Kritik",
};

// =============================================================================
// OPERASYON ENUM'LARI
// =============================================================================

export const OrderStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  PARTIAL_SHIPPED: "PARTIAL_SHIPPED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING: "Beklemede",
  APPROVED: "Onaylandı",
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
export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

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
} as const;
export type WorkOrderType = (typeof WorkOrderType)[keyof typeof WorkOrderType];

export const workOrderTypeLabels: Record<WorkOrderType, string> = {
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stoka",
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

export const RollStatus = {
  STOCK: "STOCK",
  IN_PRODUCTION: "IN_PRODUCTION",
  PRODUCED: "PRODUCED",
  SCRAP: "SCRAP",
  CANCELLED: "CANCELLED",
  AT_SUBCONTRACTOR: "AT_SUBCONTRACTOR",
  A1_STOCK: "A1_STOCK",
  RETURNED_FROM_SUBCONTRACTOR: "RETURNED_FROM_SUBCONTRACTOR",
  WAREHOUSE: "WAREHOUSE",
  TAMBUR_CONSUMED: "TAMBUR_CONSUMED",
  SUBCONTRACTOR_CONSUMED: "SUBCONTRACTOR_CONSUMED",
} as const;
export type RollStatus = (typeof RollStatus)[keyof typeof RollStatus];

export const rollStatusLabels: Record<RollStatus, string> = {
  STOCK: "Stokta",
  IN_PRODUCTION: "Üretimde",
  PRODUCED: "Üretildi",
  SCRAP: "Fire",
  CANCELLED: "İptal Edildi",
  AT_SUBCONTRACTOR: "Fasonda",
  A1_STOCK: "A1 (2. Kalite)",
  RETURNED_FROM_SUBCONTRACTOR: "Fasondan Döndü",
  WAREHOUSE: "Depoda",
  TAMBUR_CONSUMED: "Tamburda Bölündü",
  SUBCONTRACTOR_CONSUMED: "Fasonda Tüketildi",
};

export const RollOperationType = {
  KURSUN_APPLIED: "KURSUN_APPLIED",
  QC2_COMPLETED: "QC2_COMPLETED",
  TAMBUR_PROCESSED: "TAMBUR_PROCESSED",
  PACKAGED: "PACKAGED",
  SUBCONTRACTOR_SENT: "SUBCONTRACTOR_SENT",
  SUBCONTRACTOR_RETURNED: "SUBCONTRACTOR_RETURNED",
} as const;
export type RollOperationType = (typeof RollOperationType)[keyof typeof RollOperationType];

export const rollOperationTypeLabels: Record<RollOperationType, string> = {
  KURSUN_APPLIED: "Kurşun Uygulandı",
  QC2_COMPLETED: "KK2 Tamamlandı",
  TAMBUR_PROCESSED: "Tambur Kararı",
  PACKAGED: "Paketlendi",
  SUBCONTRACTOR_SENT: "Fasona Gönderildi",
  SUBCONTRACTOR_RETURNED: "Fasondan Döndü",
};

export const RollEntrySource = {
  SUPPLIER_RECEIPT: "SUPPLIER_RECEIPT",
  TAMBUR_SPLIT: "TAMBUR_SPLIT",
  SUBCONTRACTOR_RETURN: "SUBCONTRACTOR_RETURN",
} as const;
export type RollEntrySource = (typeof RollEntrySource)[keyof typeof RollEntrySource];

// SUPPLIER_RECEIPT enum değeri "tedarikçiden gelen" anlamı taşımaz; KK1 mobil
// veya Electron'dan manuel girilen ham toplar bu kaynaktadır.
export const rollEntrySourceLabels: Record<RollEntrySource, string> = {
  SUPPLIER_RECEIPT: "Ham Giriş",
  TAMBUR_SPLIT: "Tambur Kesim",
  SUBCONTRACTOR_RETURN: "Fason Dönüşü",
};

