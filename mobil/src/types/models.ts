// Legacy string literal type — KK1 form'unda hardcoded picker için kullanılır.
// Yeni admin-yönetimli katalog için aşağıdaki `QualityGrade` interface'ine bak.
export type QualityGradeCode = '1.KALITE' | 'A1' | '2.KALITE' | 'FIRE';

export type CompanyType = 'CUSTOMER' | 'SUBCONTRACTOR' | 'BOTH';
export type StationType = 'PROCESS' | 'PROCESS_QC' | 'EXTERNAL' | 'WAREHOUSE';
export type StepStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
export type WorkOrderStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'PARTIAL_SHIPPED';

export type WorkOrderType =
  | 'ORDER_PRODUCTION'
  | 'STOCK_PRODUCTION'
  | 'SAMPLE_PRODUCTION'
  | 'REPAIR_REWORK'
  | 'SERVICE_PRODUCTION';

export interface Customer {
  id: string;
  code: string;
  name: string;
  type: CompanyType;
  isActive: boolean;
}

export interface SubcontractorCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
}

export interface SubcontractorToCategory {
  subcontractorId: string;
  categoryId: string;
  category?: SubcontractorCategory;
}

export interface Subcontractor {
  id: string;
  code: string;
  name: string;
  taxNumber?: string | null;
  phone?: string | null;
  address?: string | null;
  isActive: boolean;
  categories?: SubcontractorToCategory[];
}

export interface Station {
  id: string;
  code: string;
  name: string;
  type: StationType;
}

export interface WorkOrderStep {
  id: string;
  workOrderId: string;
  stationId: string;
  stepSequence: number;
  status: StepStatus;
  notes?: string | null;
  station?: Station;
  // Fason adımları için planlama
  requiredCategoryId?: string | null;
  requiredCategory?: SubcontractorCategory | null;
  plannedSubcontractorId?: string | null;
  plannedSubcontractor?: Subcontractor | null;
}

// Sipariş satırı + müşteri snapshot — sadece picker için lazımdır,
// `withOrderDetail=true` query param'ıyla backend'den gelir.
export interface WorkOrderToOrderLine {
  workOrderId: string;
  orderLineId: string;
  allocatedQty: number;
  orderLine?: {
    id: string;
    quantity: number;
    width: number | null;
    item?: { id: string; code: string; name: string };
    variant?: { id: string; code: string; name: string } | null;
    order?: {
      id: string;
      orderNumber: string;
      deadline?: string | null;
      customer?: { id: string; code: string; name: string };
    };
  };
}

export interface WorkOrder {
  id: string;
  batchNumber: string;
  status: WorkOrderStatus;
  type?: WorkOrderType;
  width?: number | null;
  targetQuantity?: number | null;
  recipeNo?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  steps?: WorkOrderStep[];
  createdAt?: string;
  // withOrderDetail=true ile gelen alanlar
  orderLinks?: WorkOrderToOrderLine[];
  targetColor?: { id: string; code: string; name: string; hex?: string | null } | null;
  dispatchedTotalQty?: number;
  // findByBarcode include eder — KK1 ham mal kabul context'i için.
  targetItemId?: string | null;
  targetItem?: {
    id: string;
    code: string;
    name: string;
    isDerived?: boolean;
    baseItemId?: string | null;
    color?: { id: string; code: string; name: string; hex: string | null } | null;
  } | null;
}

export interface SubcontractorDispatchItem {
  id: string;
  rollId: string;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  roll?: Pick<Roll, 'id' | 'barcode' | 'item' | 'variant' | 'qualityGrade' | 'width'> & {
    ownerCustomerId?: string | null;
    ownerCustomer?: { id: string; code: string; name: string } | null;
  };
}

/**
 * Sevk listesi response'unda gelen HAFİF kayıt.
 * Detay (orderLinks, items, dispatchedBy …) `getDispatch` ile lazy çekilir.
 */
export interface SubcontractorDispatchListItem {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  totalQty: number;
  plateNumber: string | null;
  driverName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  workOrder?: Pick<WorkOrder, 'id' | 'batchNumber'>;
  subcontractor?: Pick<Subcontractor, 'id' | 'name'>;
  _count?: { items: number };
}

/**
 * Detay endpoint (`getDispatch`) tam veri.
 * Liste satırından tıklamayla `useQuery` cache'iyle dolar.
 */
export interface SubcontractorDispatch {
  id: string;
  dispatchNo: string;
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  plannedSubcontractorId: string | null;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  totalQty: number;
  dispatchedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  workOrder?: Pick<WorkOrder, 'id' | 'batchNumber'> & Partial<WorkOrder>;
  step?: WorkOrderStep;
  subcontractor?: Subcontractor;
  plannedSubcontractor?: Subcontractor | null;
  dispatchedBy?: { id: string; username: string; fullName: string } | null;
  cancelledBy?: { id: string; username: string; fullName: string } | null;
  items?: SubcontractorDispatchItem[];
}

export interface ItemVariant {
  id: string;
  code: string;
  name: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  itemType?: string;
  isActive?: boolean;
}

export interface Roll {
  id: string;
  barcode: string;
  itemId: string;
  variantId: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: string;
  entrySource?: string;
  ownerCustomerId?: string | null;
  item?: {
    id: string;
    code: string;
    name: string;
    color?: { id: string; code: string; name: string; hex: string | null } | null;
  };
  variant?: { id: string; code: string; name: string } | null;
  producedInStep?: {
    workOrder?: { id: string; batchNumber: string } | null;
  } | null;
  createdBy?: { id: string; username: string; fullName: string } | null;
  createdAt?: string;
}

// =============================================================================
// Fason Mal Kabul (Subcontractor Receipt)
// =============================================================================

/**
 * `GET /api/subcontractor/pending-returns?workOrderId=` cevabındaki bir grup.
 * Bir step üzerine fasonda bekleyen toplar + son sevk + planlanan/güncel firma.
 */
export interface PendingReturnGroup {
  step: {
    id: string;
    stepSequence: number;
    station: Station;
    notes: string | null;
    requiredCategory: SubcontractorCategory | null;
    plannedSubcontractor: Subcontractor | null;
  };
  workOrder: {
    id: string;
    batchNumber: string;
    recipeNo: string | null;
    status: WorkOrderStatus;
  };
  lastDispatch: {
    id: string;
    dispatchNo: string;
    dispatchedAt: string;
    plateNumber: string | null;
    driverName: string | null;
    subcontractorId: string;
    subcontractor: Subcontractor;
  } | null;
  rolls: Roll[];
  rollCount: number;
  totalQty: number;
}

/** Alıcı her satır için tek opaque obje gönderir; ölçüm/etiket yapılmaz. */
export interface ReceiveReturnInput {
  rollId: string;
  notes?: string | null;
}

export interface ReceiveRequest {
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  manifestNo?: string | null;
  notes?: string;
  returns: ReceiveReturnInput[];
}

export interface SubcontractorReceiptItem {
  id: string;
  receiptId: string;
  newRollId: string;
  notes: string | null;
  newRoll?: Pick<Roll, 'id' | 'barcode' | 'item' | 'variant' | 'qualityGrade'>;
}

/** Liste cevabı için hafif kayıt — `GET /api/subcontractor/receipts` */
export interface SubcontractorReceiptListItem {
  id: string;
  receiptNo: string;
  manifestNo: string | null;
  receivedAt: string;
  notes: string | null;
  workOrder?: Pick<WorkOrder, 'id' | 'batchNumber'>;
  subcontractor?: Pick<Subcontractor, 'id' | 'name' | 'code'>;
  step?: { id: string; stepSequence: number; station: Pick<Station, 'name' | 'code'> };
  receivedBy?: { id: string; username: string; fullName: string } | null;
  items?: { id: string }[];
  _count?: { items: number };
  totalQty?: number;
}

/** Detay cevabı — `GET /api/subcontractor/receipts/:id` */
export interface SubcontractorReceipt extends SubcontractorReceiptListItem {
  items?: SubcontractorReceiptItem[];
}

// =============================================================================
// Refakat Kartı (Traveler Card) — `findByBarcode` cevabı
// =============================================================================

export type TravelerCardStatus = 'ACTIVE' | 'COMPLETED' | 'VOIDED';

export interface TravelerCardLookup {
  id: string;
  cardNumber: string;
  barcode: string;
  version: number;
  status: TravelerCardStatus;
  workOrderId: string;
  printedAt: string;
  workOrder?: WorkOrder;
}

// =============================================================================
// Kalite — Hata tipi kataloğu (DefectType)
// =============================================================================

export type DefectSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL';

export interface DefectType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: DefectSeverity | null;
  isActive: boolean;
}

// =============================================================================
// Kurşun + QC2 (PROCESS_QC istasyonu) — operatör ekranı tipleri
// =============================================================================

export interface KursunRollDefectSummary {
  id: string;
  startMeter: number;
  endMeter: number;
  defectTypeId: string | null;
  errorType: string | null; // DefectType.name snapshot — kayıt anında dondurulur
}

export interface KursunRollSummary {
  rollId: string;
  barcode: string;
  currentQty: number;
  kursunApplied: boolean;
  qc2Completed: boolean;
  errorCount: number;
  defects: KursunRollDefectSummary[];
  // Backend `getByCardBarcode` cevabı per-roll item bilgisi göndermeyebilir;
  // varsa ek alan olarak gelirse opsiyonel.
  itemName?: string;
  variantName?: string | null;
}

export interface KursunStepSummary {
  workOrderStepId: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';
  rolls: KursunRollSummary[];
}

/** `GET /api/kursun-qc/open-cards` cevabı — kamera modalı için. */
export interface KursunOpenCard {
  cardId: string;
  cardNumber: string;
  cardBarcode: string;
  workOrderId: string;
  batchNumber: string;
  stepId: string;
  stationName: string;
  stationCode: string;
  openRollCount: number;
}

// =============================================================================
// Kalite derecesi kataloğu (admin yönetimli)
// =============================================================================
export interface QualityGrade {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
}

// =============================================================================
// Tambur ekranı tipleri
// =============================================================================

export interface TamburRollDefect {
  id: string;
  startMeter: number;
  endMeter: number;
  errorType: string | null; // DefectType.name snapshot (veya backend'in döndürdüğü)
}

export interface TamburRollSummary {
  rollId: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  errorCount: number;
  errors: TamburRollDefect[];
}

export interface TamburStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: TamburRollSummary[];
}

export type TamburDecision = 'CUT' | 'NO_CUT';

export interface TamburErrorDecision {
  errorId: string;
  decision: TamburDecision;
  qualityGrade?: string; // CUT için zorunlu (FIRE/A1 vb.)
}

export type TamburFoldType = '2-KAT' | '4-KAT';

export interface TamburVoluntaryCut {
  start: number;
  end: number; // > start
  qualityGrade: string;
}

export interface TamburFinalizeRequest {
  rollId: string;
  decisions: TamburErrorDecision[];
  voluntaryCuts: TamburVoluntaryCut[];
  foldType?: TamburFoldType;
  layerCount?: number | null;
  cutMode?: 'BY_DEFECT' | 'FIXED_LENGTH' | null;
  cutLengthM?: number | null;
}

export interface TamburReportErrorRequest {
  rollId: string;
  stepId: string;
  startMeter: number;
  endMeter: number;
  defectTypeId: string;
}

export interface TamburSwatchRequest {
  sourceRollId: string;
  length: number;
  width?: number | null;
  count: number;
  purpose?: string | null;
  workOrderId?: string | null;
  variantId?: string | null;
}

export interface TamburPostSplitRequest {
  rollId: string;
  cutLength: number;
  originalKeepsLarger: boolean;
}

export interface TamburSplitRollLabel {
  id: string;
  barcode: string;
  qualityGrade: string;
  currentQty: number;
  width: number | null;
  itemCode?: string;
  itemName?: string;
}

export interface TamburOpenCard {
  cardId: string;
  cardNumber: string;
  cardBarcode: string;
  workOrderId: string;
  batchNumber: string;
  stepId: string;
  stationName: string;
  stationCode: string;
  openRollCount: number;
}
