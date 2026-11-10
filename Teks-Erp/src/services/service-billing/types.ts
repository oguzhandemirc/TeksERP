// =============================================================================
// HİZMET FATURASI — dalga-2 TEL SÖZLEŞMESİ (F4 özne/kaynak kırılımı · F9 yeniden işlem sınıfı · F6 vergi bağlamı)
// =============================================================================
// Şema öncüsü 2026-11-08; gövdeler F4/F6/F9 dilimlerinde. Panel (P2/P4) bu tiplere göre paralel yazılır.
// Tam sözleşme: ~/.tekserp/plan/SOZLESME-fason-dalga2.md §F4 §F6 §F9. Tüm yeni alanlar OPSİYONEL/EK —
// eski panel tanımadığı alanı yok sayar; mevcut alanların anlamı değişmez.
// =============================================================================

/** Hizmet işinin kaynağı: kurşun (LEAD; "KURSUN" literali `quality-station.helper` tekelinde) · bayrak (tambur/etek/brode) · adım (F3) · levent sarımı (F4) · dokuma (F4). */
export type ServiceWorkSource = "LEAD" | "FLAG" | "STEP" | "WINDING" | "WEAVING";

/** Hizmet bağının öznesi (DB `ServiceBillingSubject`). */
export type ServiceSubjectKindWire = "ROLL" | "WARP_BEAM";

/** Faturalanan metre tabanı (DB `ServiceMeterBasis`; WOUND/WOVEN F4'te yazılır). */
export type ServiceMeterBasisWire = "OUT" | "IN" | "DECLARED" | "CUT" | "RECEIVED" | "WOUND" | "WOVEN";

/**
 * F4: taslaktaki tek hizmet işinin kırılımı — taslak satırları hizmet kartı başına TOPLANIR, bu dizi
 * "satır neden bu miktar" sorusunun cevabıdır. `GET /api/finance/shipments/:id/invoice-draft-lines` ve
 * `GET /api/finance/invoices/service-period-draft/preview` yanıtlarına EK alan `serviceWorks?`.
 */
export interface ServiceDraftWorkRow {
  source: ServiceWorkSource;
  subjectKind: ServiceSubjectKindWire;
  /** ROLL ⇒ top id'si, WARP_BEAM ⇒ levent id'si. */
  subjectId: string;
  /** Ekranda görünen kimlik: top barkodu ya da levent no. */
  subjectCode: string;
  serviceItemId: string;
  /** Süreç türü adı (STEP), bayrak adı (FLAG), "Kurşun", "Sarım", "Dokuma". */
  processLabel: string;
  workOrderStepId: string | null;
  qty: string;
  /** DB `ServiceQtyUnit` ile aynı değerler. */
  unit: "METER" | "PIECE" | "STITCH";
  meterBasis: ServiceMeterBasisWire;
  unitPrice: string;
  /**
   * F9: işin bağlı olduğu İE'nin DONMUŞ `WorkOrder.reworkBillable`ı false ise (adım · bayrak · kurşun, hepsi)
   * iş taslağa GİRMEZ; listede yalnız bilgi satırı. Canlı katalog okunmaz.
   */
  excludedReason: "REWORK_OUR_FAULT" | null;
  /**
   * GK metre (2026-11-10): yalnız `finance.serviceBilling.meterBasis = MAX_DECLARED` iken — işin parti payı olarak beyan,
   * partinin en büyük ölçümü ve faturalanan metre (kural 1–2); diğer tabanlarda anahtar YOK (bayt-aynı).
   */
  meterCompare?: { declaredM: number | null; measuredM: number | null; billedM: number; basis: "DECLARED" | "MEASURED" };
}

/** F4/F9 ek alanları — mevcut taslak yanıtlarına eklenir (yoksa eski davranış). */
export interface ServiceDraftExtras {
  serviceWorks?: ServiceDraftWorkRow[];
}

/**
 * F4 levent sarım işi (source=WINDING, subjectKind=WARP_BEAM): faturalanabilir an = leventin AKTİF
 * `SHIP_TO_OWNER` olayı (F5 emanet çıkışı, READY→SHIPPED_TO_OWNER); `serviceAt` = çıkış anı, qty = sarım
 * metresi (meterBasis WOUND). YALNIZ dönem taslağında (`service-period-draft`) görünür; top sevk taslağında
 * (`invoice-draft-lines`) levent satırı ÇIKMAZ. Çıkış iptalinde bağ damgalanır (revokedAt), silinmez.
 */
export type WindingBillingMoment = "SHIP_TO_OWNER";

/**
 * F9: yeniden işlem sebebinin sınıfı — `ReasonPreset.billable` (yalnız `WORK_ORDER_REWORK`).
 * null = sınıfsız ⇒ ücretli (bugünkü) · true = müşteri talebi · false = bizim hatamız (faturasız).
 * `GET /api/reason-presets` satırına EK alan; `PATCH /api/reason-presets/:id` gövdesine opsiyonel alan.
 */
export type ReasonBillableWire = boolean | null;

/**
 * F9 donma: yeniden işlem İE'si YARATILIRKEN (`parameters.rework.reasonCode`) sebebin `billable`ı
 * `WorkOrder.reworkBillable`a kopyalanır; sonradan katalog değişse geçmiş İE değişmez. İE DTO'larına EK alan.
 */
export interface WorkOrderReworkBillableExtras {
  reworkBillable?: ReasonBillableWire;
}

/**
 * F6: `GET /api/finance/invoices/tax-defaults` sorgusuna opsiyonel `workOrderId` (İE bağlamı, F7b
 * `materialProvidedBy` girdisi). Yanıt şekli DEĞİŞMEZ (`InvoiceTaxDefaults`).
 */
export interface TaxDefaultsQuery {
  type: "SALES" | "PURCHASE";
  customerId?: string;
  workOrderId?: string;
}
