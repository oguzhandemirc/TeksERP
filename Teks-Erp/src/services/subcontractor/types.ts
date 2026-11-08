// =============================================================================
// GİDEN FASON — dalga-2 TEL SÖZLEŞMESİ (F6 termin + alış taslağı · F10 kokpit)
// =============================================================================
// Şema öncüsü 2026-11-08; gövdeler F6/F10'da. Panel (P4) ve tablet (T2) bu tiplere göre paralel yazılır.
// Tam sözleşme: ~/.tekserp/plan/SOZLESME-fason-dalga2.md §F6 §F10. Sayılar string, tarihler ISO string;
// gecikme/gün hesabı fabrika gününden (`constants/time.ts`).
// =============================================================================

/**
 * F6: fason sevk gövdelerine (`POST /api/subcontractor/dispatch`, `/dispatch/bulk`, dokuma fason sevki) EK
 * opsiyonel alan. Yok/undefined ⇒ sunucu varsayılanı çözer (firma > kategori > `fason.expectedReturnDays`;
 * üçü de yoksa NULL = bugünkü). `null` açıkça gönderilirse termin YOK. Geçmiş tarih 400.
 */
export interface DispatchExpectedReturnInput {
  expectedReturnAt?: string | null;
}

/** F6: `expectedReturnAt` varsayılanının kaynağı (sevk önizlemesi/yanıtı bilgi olarak taşır). */
export type ExpectedReturnSource = "BODY" | "SUBCONTRACTOR" | "CATEGORY" | "SETTING" | "NONE";

/** F6: kabulden alış faturası taslağı satırı (kalem = hizmet kartı, miktar = RECEIVED metre ya da kg). */
export interface SubcontractorPurchaseDraftLine {
  serviceItemId: string | null;
  description: string;
  qty: string;
  unit: "M" | "KG";
  unitPrice: string;
  currency: string;
  /** Fiyatın geldiği tarife (sevk tarihindeki `pickFinishingRateAtDispatch`); yoksa null + uyarı. */
  finishingRateId: string | null;
  vatRate: number;
  withholdingRate: number;
}

/**
 * F6: `GET /api/finance/invoices/from-subcontractor-receipt/:receiptId/preview` yanıtı (yazmaz);
 * `POST /api/finance/invoices/from-subcontractor-receipt/:receiptId` aynı hesapla taslak yaratır (201).
 */
export interface SubcontractorPurchaseDraftPreview {
  receiptId: string;
  receiptNo: string;
  subcontractor: { id: string; name: string };
  /** Alış faturasının tarafı = fason profilin bağlı kartı (`resolvePartyToCardTx`); bağsızsa null + 409. */
  supplierCustomerId: string | null;
  currency: string;
  lines: SubcontractorPurchaseDraftLine[];
  subtotal: string;
  /** Kabul başına tek aktif fatura: doluysa taslak yaratılamaz (409). */
  existingInvoice: { id: string; docNo: string; status: string } | null;
  warnings: string[];
}

export type SubcontractorPurchaseDraftErrorCode =
  | "SUBCONTRACTOR_RECEIPT_CANCELLED"
  | "SUBCONTRACTOR_RECEIPT_ALREADY_INVOICED"
  | "SUBCONTRACTOR_NOT_LINKED_TO_CARD"
  | "SUBCONTRACTOR_RECEIPT_NOT_WORK_ORDER_BOUND";

/** F10: `GET /api/subcontractor/cockpit` sorgusu. */
export interface SubcontractorCockpitQuery {
  "filter[subcontractorId]"?: string;
  "filter[categoryId]"?: string;
  /** OVERDUE = termini geçmiş açık sevk · DUE_SOON = 2 fabrika günü içinde · ALL (varsayılan). */
  "filter[state]"?: "ALL" | "OVERDUE" | "DUE_SOON" | "NO_DUE_DATE";
  cursor?: string;
  limit?: number;
}

/** F10: tek açık sevk satırı (`OPEN_OUTSTANDING` tek kaynağından). */
export interface SubcontractorCockpitRow {
  dispatchId: string;
  dispatchNo: string;
  subcontractor: { id: string; name: string };
  category: { id: string; name: string } | null;
  workOrder: { id: string; orderNo: string } | null;
  weavingOrder: { id: string; orderNo: string } | null;
  dispatchedAt: string;
  expectedReturnAt: string | null;
  /** Fabrika günü farkı; termin yoksa null, gecikmede pozitif. */
  overdueDays: number | null;
  dispatchedQty: string;
  /** Kısmi kabul sonrası fasonda kalan metre. */
  outstandingQty: string;
  outstandingRollCount: number;
  yarnOutstandingKg: string;
  beamOutstandingCount: number;
}

/** F10: firma başına özet şeridi (liste ile AYNI where). */
export interface SubcontractorCockpitFirmSummary {
  subcontractor: { id: string; name: string };
  openDispatchCount: number;
  overdueCount: number;
  outstandingQty: string;
  yarnOutstandingKg: string;
  beamOutstandingCount: number;
}

export interface SubcontractorCockpitResult {
  data: SubcontractorCockpitRow[];
  nextCursor: string | null;
  summary: {
    openDispatchCount: number;
    overdueCount: number;
    dueSoonCount: number;
    outstandingQty: string;
    firms: SubcontractorCockpitFirmSummary[];
  };
}
