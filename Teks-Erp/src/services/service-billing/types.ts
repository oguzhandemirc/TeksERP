// =============================================================================
// HİZMET FATURASI — dalga-2 TEL SÖZLEŞMESİ (F4 özne/kaynak kırılımı · F9 yeniden işlem sınıfı · F6 vergi bağlamı)
// =============================================================================
// Şema öncüsü 2026-11-08; gövdeler F4/F6/F9 dilimlerinde. Panel (P2/P4) bu tiplere göre paralel yazılır.
// Tam sözleşme: ~/.tekserp/plan/SOZLESME-fason-dalga2.md §F4 §F6 §F9. Tüm yeni alanlar OPSİYONEL/EK —
// eski panel tanımadığı alanı yok sayar; mevcut alanların anlamı değişmez.
// =============================================================================

/** Hizmet işinin kaynağı: kurşun · bayrak (tambur/etek/brode) · adım (F3) · levent sarımı (F4) · dokuma (F4). */
export type ServiceWorkSource = "KURSUN" | "FLAG" | "STEP" | "WINDING" | "WEAVING";

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
  unit: "M" | "PIECE" | "STITCH";
  meterBasis: ServiceMeterBasisWire;
  unitPrice: string;
  /** F9: yeniden işlem sınıfı "bizim hatamız" olan adım işi taslağa GİRMEZ; listede yalnız bilgi satırı. */
  excludedReason: "REWORK_OUR_FAULT" | null;
}

/** F4/F9 ek alanları — mevcut taslak yanıtlarına eklenir (yoksa eski davranış). */
export interface ServiceDraftExtras {
  serviceWorks?: ServiceDraftWorkRow[];
}

/**
 * F9: yeniden işlem sebebinin sınıfı — `ReasonPreset.billable` (yalnız `WORK_ORDER_REWORK`).
 * null = sınıfsız ⇒ ücretli (bugünkü) · true = müşteri talebi · false = bizim hatamız (faturasız).
 * `GET /api/reason-presets` satırına EK alan; `PATCH /api/reason-presets/:id` gövdesine opsiyonel alan.
 */
export type ReasonBillableWire = boolean | null;

/**
 * F6: `GET /api/finance/invoices/tax-defaults` sorgusuna opsiyonel `workOrderId` (İE bağlamı, F7b
 * `materialProvidedBy` girdisi). Yanıt şekli DEĞİŞMEZ (`InvoiceTaxDefaults`).
 */
export interface TaxDefaultsQuery {
  type: "SALES" | "PURCHASE";
  customerId?: string;
  workOrderId?: string;
}
