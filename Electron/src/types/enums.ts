// WARP (Çözgü) bilinçli olarak YOK — backend Prisma ItemType enum'unda hiç
// olmadı (fabrika çözgü/dokuma yapmaz); burada sunulunca create her zaman patlıyordu.
export const ItemType = {
  FABRIC: "FABRIC",
  YARN: "YARN",
  CONSUMABLE: "CONSUMABLE",
} as const;
export type ItemType = (typeof ItemType)[keyof typeof ItemType];

export const itemTypeLabels: Record<ItemType, string> = {
  FABRIC: "Kumaş",
  YARN: "İplik",
  CONSUMABLE: "Sarf Malzeme",
};

/** Her kumaş tipi için kullanılan birim — kullanıcı düzenleyemez. */
export const unitForItemType: Record<ItemType, string> = {
  FABRIC: "MT",
  YARN: "KG",
  CONSUMABLE: "ADET",
};

/** TÜRETİLMİŞ cari tipi (rol modeli): sunucu rollerden yazar, panel OKUMAZ — etiket/süzgeç kaynağı `lib/partnerRoles`. */
export type CompanyType = "CUSTOMER" | "SUPPLIER" | "BOTH";

export const StationType = {
  INTERNAL: "INTERNAL",
  EXTERNAL: "EXTERNAL",
} as const;
export type StationType = (typeof StationType)[keyof typeof StationType];

export const stationTypeLabels: Record<StationType, string> = {
  INTERNAL: "Dahili",
  EXTERNAL: "Harici (Fason)",
};

// ⚠️ Backend `enum StationKind` (schema.prisma) ile BİREBİR. `SHIPPING`
// 2026-09-03'e kadar EKSİKTİ: sevkiyat istasyonu panelde `stationKindLabels`
// üzerinden `undefined` basıyordu ve form zod'u onu reddediyordu (SEVK_1
// düzenlenirse OTHER'a düşer, tablet tartı ekranı kapanırdı).
export const StationKind = {
  RAW_QC: "RAW_QC",
  PROCESS_QC: "PROCESS_QC",
  TAMBUR: "TAMBUR",
  SUBCONTRACTOR: "SUBCONTRACTOR",
  SHIPPING: "SHIPPING",
  OTHER: "OTHER",
  // Dokuma ⓪ (2026-09-14): tezgah — rotada ADIM DEĞİL, yalnız oturum istasyonu.
  // Formda `dokumaEnabled` kapalıyken GİZLENİR (stationKindVisibility.ts).
  WEAVING: "WEAVING",
} as const;
export type StationKind = (typeof StationKind)[keyof typeof StationKind];

export const stationKindLabels: Record<StationKind, string> = {
  RAW_QC: "Ham Kalite Kontrol (KK1)",
  PROCESS_QC: "Kurşun + Kalite Kontrol 2",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason / Dış İşlem",
  SHIPPING: "Sevkiyat / Tartı",
  OTHER: "Diğer",
  WEAVING: "Dokuma Tezgahı",
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
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  // SUPERSEDED ("Devredildi"): tebdil ile boşalan kaynak WO — malzemesi yeni iş
  // emrine devredildi (splitFromId ile bağlı). İptal DEĞİL, veri kaybı yok.
  SUPERSEDED: "SUPERSEDED",
} as const;
export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

export const workOrderStatusLabels: Record<WorkOrderStatus, string> = {
  PLANNED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  SUPERSEDED: "Devredildi",
};

export const WorkOrderType = {
  ORDER_PRODUCTION: "ORDER_PRODUCTION",
  STOCK_PRODUCTION: "STOCK_PRODUCTION",
} as const;
export type WorkOrderType = (typeof WorkOrderType)[keyof typeof WorkOrderType];

export const workOrderTypeLabels: Record<WorkOrderType, string> = {
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stok",
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
  SCRAP: "SCRAP",
  CANCELLED: "CANCELLED",
  AT_SUBCONTRACTOR: "AT_SUBCONTRACTOR",
  A1_STOCK: "A1_STOCK",
  RETURNED_FROM_SUBCONTRACTOR: "RETURNED_FROM_SUBCONTRACTOR",
  WAREHOUSE: "WAREHOUSE",
  SHIPPED: "SHIPPED",
  TAMBUR_CONSUMED: "TAMBUR_CONSUMED",
  SUBCONTRACTOR_CONSUMED: "SUBCONTRACTOR_CONSUMED",
  AT_KARTELA: "AT_KARTELA",
  KARTELA_CONSUMED: "KARTELA_CONSUMED",
} as const;
export type RollStatus = (typeof RollStatus)[keyof typeof RollStatus];

export const rollStatusLabels: Record<RollStatus, string> = {
  STOCK: "Stokta",
  IN_PRODUCTION: "Üretimde",
  SCRAP: "Fire",
  CANCELLED: "İptal Edildi",
  AT_SUBCONTRACTOR: "Fasonda",
  A1_STOCK: "A1 (2. Kalite)",
  RETURNED_FROM_SUBCONTRACTOR: "Fasondan Döndü",
  WAREHOUSE: "Depoda",
  SHIPPED: "Sevk Edildi",
  TAMBUR_CONSUMED: "Tamburda Bölündü",
  SUBCONTRACTOR_CONSUMED: "Fasonda Tüketildi",
  AT_KARTELA: "Kartelada",
  KARTELA_CONSUMED: "Kartela'da Tüketildi",
};

// NOT: Eski PACKAGED girdisi kaldırıldı (2026-07-27) — backend RollOperationType
// enum'unda yok (çuval-depo modeline geçişte düştü); bayat kopya tip drift'iydi.
export const RollOperationType = {
  KURSUN_APPLIED: "KURSUN_APPLIED",
  QC2_COMPLETED: "QC2_COMPLETED",
  TAMBUR_PROCESSED: "TAMBUR_PROCESSED",
  SUBCONTRACTOR_SENT: "SUBCONTRACTOR_SENT",
  SUBCONTRACTOR_RETURNED: "SUBCONTRACTOR_RETURNED",
} as const;
export type RollOperationType = (typeof RollOperationType)[keyof typeof RollOperationType];

export const rollOperationTypeLabels: Record<RollOperationType, string> = {
  KURSUN_APPLIED: "Kurşun Uygulandı",
  QC2_COMPLETED: "KK2 Tamamlandı",
  TAMBUR_PROCESSED: "Tambur Kararı",
  SUBCONTRACTOR_SENT: "Fasona Gönderildi",
  SUBCONTRACTOR_RETURNED: "Fasondan Döndü",
};

export const RollEntrySource = {
  SUPPLIER_RECEIPT: "SUPPLIER_RECEIPT",
  MANUAL_ENTRY: "MANUAL_ENTRY",
  TAMBUR_SPLIT: "TAMBUR_SPLIT",
  SUBCONTRACTOR_RETURN: "SUBCONTRACTOR_RETURN",
  TAMBUR_MANUAL: "TAMBUR_MANUAL",
  SEMI_FINISHED: "SEMI_FINISHED",
  WEAVING: "WEAVING",
} as const;
export type RollEntrySource = (typeof RollEntrySource)[keyof typeof RollEntrySource];

// SUPPLIER_RECEIPT = mobil KK1 istasyonundan taranan/girilen top; MANUAL_ENTRY =
// Electron admin panelinden "Manuel Top Ekle" ile elle girilen top (istasyon
// taraması DEĞİL) — 2026-07-15 ayrıştırıldı, eskiden ikisi de SUPPLIER_RECEIPT'ti.
// TAMBUR_MANUAL = Tambur tabletinde "Manuel Ekle" modunda, refakat kartı OLMADAN
// üretilip doğrudan bitmiş depoya yazılan top (2026-08-03). MANUAL_ENTRY'den ayrı
// tutulur: ikisi de elle girilir ama GİRİŞ YERİ farklıdır ve envanterde ayırt
// edilebilmesi gerekir.
export const rollEntrySourceLabels: Record<RollEntrySource, string> = {
  SUPPLIER_RECEIPT: "Ham Giriş",
  MANUAL_ENTRY: "Manuel Giriş",
  TAMBUR_SPLIT: "Tambur Kesim",
  SUBCONTRACTOR_RETURN: "Fason Dönüşü",
  TAMBUR_MANUAL: "Tambur (Manuel)",
  // 2026-08-17: dışarıdan alınan yarı mamul — ham girişten AYRI tutulur ki
  // "içeride ürettiğimiz ham" ile "dışarıdan aldığımız yarı mamul" karışmasın.
  SEMI_FINISHED: "Yarı Mamul (Dış Alım)",
  // 2026-09-13 (dokuma P3): fabrikanın kendi tezgahında dokunup KK1'de doğan top —
  // üçüncü doğum sınıfı; yazan uç henüz yok, değer şemada.
  WEAVING: "Dokuma (Tezgahtan)",
};


// ── TEZGAH KÜNYESİ (dokuma P4, 2026-09-13) ───────────────────────────────────
// ⚠️ Backend `enum LoomShedType` (schema.prisma) ile BİREBİR.
// Ad `Loom*` KALIR ve bilinçlidir: ağızlık açmak gerçekten dokuma tezgahının
// fiziğidir. Çözgülü örme (raşel) ağızlık açmaz ⇒ alan NULL kalır ve
// `shedType IS NULL` tam olarak "bu makine o sınıftan değil" der.
export const LoomShedType = {
  ARMUR: "ARMUR",
  JAKAR: "JAKAR",
  KAM: "KAM",
} as const;
export type LoomShedType = (typeof LoomShedType)[keyof typeof LoomShedType];

export const loomShedTypeLabels: Record<LoomShedType, string> = {
  ARMUR: "Armür",
  JAKAR: "Jakar",
  KAM: "Kam (Eksantrik)",
};

// ⚠️ Backend `enum MachineMonitoringState` ile BİREBİR.
// "Bu makinenin verisi rapora giriyor mu" sorusunun TEK kaynağı. `isMonitored`
// gibi tek bir boolean YOKTUR: gölge mod bir reçete cümlesi değil bir durumdur,
// ve iki kolon "çift yüklem" sınıfı olurdu.
// GÖLGE: veri yazılır, karne hesaplanır, ama DEFTER raporları onu süzer ve dışa
// aktarımda gölge damgası taşır — kanal kabulü kanıtlanmadan rakam yayınlanmaz.
export const MachineMonitoringState = {
  OFF: "OFF",
  SHADOW: "SHADOW",
  LIVE: "LIVE",
} as const;
export type MachineMonitoringState =
  (typeof MachineMonitoringState)[keyof typeof MachineMonitoringState];

export const machineMonitoringStateLabels: Record<MachineMonitoringState, string> = {
  OFF: "İzleme Kapalı",
  SHADOW: "Gölge Mod",
  LIVE: "Yayında",
};
