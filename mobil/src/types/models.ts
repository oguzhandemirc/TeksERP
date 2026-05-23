// Legacy string literal type — KK1 form'unda hardcoded picker için kullanılır.
// Yeni admin-yönetimli katalog için aşağıdaki `QualityGrade` interface'ine bak.
export type QualityGradeCode = '1.KALITE' | 'A1' | '2.KALITE' | 'FIRE';

export type CompanyType = 'CUSTOMER' | 'SUBCONTRACTOR' | 'BOTH';
export type StationType = 'PROCESS' | 'PROCESS_QC' | 'EXTERNAL' | 'WAREHOUSE';
export type StationKind =
  | 'RAW_QC'
  | 'EXTERNAL'
  | 'PROCESS_QC'
  | 'TAMBUR'
  | 'SUBCONTRACTOR'
  | 'OTHER';
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

export type RollStatus =
  | 'STOCK'
  | 'IN_PRODUCTION'
  | 'PRODUCED'
  | 'WAREHOUSE'
  | 'READY_FOR_SHIP'
  | 'SHIPPED'
  | 'SCRAP'
  | 'AT_SUBCONTRACTOR'
  | 'A1_STOCK'
  | 'TAMBUR_CONSUMED'
  | 'SUBCONTRACTOR_CONSUMED';

export type RollEntrySource =
  | 'KK1_INITIAL'
  | 'TAMBUR_SPLIT'
  | 'SUBCONTRACTOR_RETURN'
  | 'MANUAL'
  | 'SERVICE_PRODUCTION';

// =============================================================================
// Master data — Color, FabricProperty
// =============================================================================

export interface Color {
  id: string;
  code: string;
  name: string;
  hex?: string | null;
  isActive?: boolean;
}

export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
}

// =============================================================================
// Customer / Subcontractor / Station
// =============================================================================

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
  /**
   * true ise bu kategorideki fason kabulde Roll'a iş emrinin hedef rengi
   * otomatik uygulanır. Boyahane gibi.
   */
  appliesColor?: boolean;
  /**
   * [YENİ — 2026-05-18] true ise bu kategorideki fason kabulde Roll'a iş
   * emrinin hedef özellikleri otomatik uygulanır. Boyahane'de appliesColor ile
   * birlikte gelir; ileride Zımpara/Kurşun gibi yalnız özellik veren adımlar
   * ("zımparalanmış", "kurşunlanmış") için bağımsız açılabilir.
   *
   * TODO (FasonKabulScreen): UI şu an renk + özellik bloklarını tek
   * appliesColor flag'ine bağlı tutuyor. Yeni mantıkta:
   *   - renk seçici → appliesColor=true ise göster
   *   - özellik seçici → appliesProperty=true ise göster
   * Backend `subcontractor.service.ts` artık property'i `appliesProperty`
   * üzerinden çözüyor (`appliesColor`'dan bağımsız). Mobil bu ayrımı henüz
   * yansıtmıyor — kullanıcı bilinçli olarak sonraya bıraktı.
   */
  appliesProperty?: boolean;
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
  kind?: StationKind;
}

// =============================================================================
// Item — Variant kaldırıldı; allowedColors / allowedProperties pattern
// =============================================================================

export interface Item {
  id: string;
  code: string;
  name: string;
  itemType?: string;
  isActive?: boolean;
  allowedColors?: Color[];
  allowedProperties?: FabricProperty[];
}

// =============================================================================
// WorkOrder + steps + order links
// =============================================================================

export interface WorkOrderStep {
  id: string;
  workOrderId: string;
  stationId: string;
  stepSequence: number;
  status: StepStatus;
  notes?: string | null;
  station?: Station;
  requiredCategoryId?: string | null;
  requiredCategory?: SubcontractorCategory | null;
  plannedSubcontractorId?: string | null;
  plannedSubcontractor?: Subcontractor | null;
}

export interface WorkOrderToOrderLine {
  workOrderId: string;
  orderLineId: string;
  allocatedQty: number;
  orderLine?: {
    id: string;
    quantity: number;
    width: number | null;
    colorId?: string | null;
    customerItemName?: string | null;
    customerColorName?: string | null;
    item?: { id: string; code: string; name: string };
    color?: Color | null;
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
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  steps?: WorkOrderStep[];
  createdAt?: string;
  // withOrderDetail=true ile gelen alanlar
  orderLinks?: WorkOrderToOrderLine[];
  targetItemId?: string | null;
  targetItem?: Item | null;
  targetColorId?: string | null;
  targetColor?: Color | null;
  targetProperties?: FabricProperty[];
  /** "2-KAT" / "4-KAT" gibi — Tambur planlaması, opsiyonel. */
  foldType?: string | null;
  /** Tambur katman sayısı (1-20), opsiyonel. */
  layerCount?: number | null;
  dispatchedTotalQty?: number;
}

// =============================================================================
// Subcontractor Dispatch
// =============================================================================

export interface SubcontractorDispatchItem {
  id: string;
  rollId: string;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  roll?: Pick<Roll, 'id' | 'barcode' | 'item' | 'qualityGrade' | 'width' | 'color'> & {
    ownerCustomerId?: string | null;
    ownerCustomer?: { id: string; code: string; name: string } | null;
  };
}

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

// =============================================================================
// Roll — barcode nullable (açık kumaş), colorId + properties bağımsız
// =============================================================================

export interface RollProperty {
  propertyId: string;
  property?: FabricProperty;
}

export interface RollErrorRecord {
  id: string;
  startMeter: number;
  endMeter: number | null;
  defectTypeId: string | null;
  errorType: string | null;
  isProcessed?: boolean;
}

export interface Roll {
  id: string;
  /** Açık kumaş (boyahane dönüşü Kurşun/KK2 aşaması) için NULL. */
  barcode: string | null;
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: RollStatus;
  entrySource?: RollEntrySource;
  ownerCustomerId?: string | null;
  parentReceiptId?: string | null;
  item?: { id: string; code: string; name: string };
  color?: Color | null;
  properties?: RollProperty[];
  ownerCustomer?: { id: string; code: string; name: string } | null;
  producedInStep?: {
    workOrder?: { id: string; batchNumber: string } | null;
  } | null;
  createdBy?: { id: string; username: string; fullName: string } | null;
  createdAt?: string;
}

// =============================================================================
// Fason Mal Kabul (Subcontractor Receipt)
// =============================================================================

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
    status: WorkOrderStatus;
    targetColor?: Color | null;
    targetProperties?: FabricProperty[];
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
  /** Receipt seviyesinde uygulanan renk (override; appliesColor=true kategoride boş bırakılabilir → WO.targetColor). */
  appliedColorId?: string | null;
  /** Receipt seviyesinde uygulanan özellikler (override; appliesColor=true kategoride boş bırakılabilir → WO.targetProperties). */
  appliedPropertyIds?: string[];
  returns: ReceiveReturnInput[];
}

export interface SubcontractorReceiptItem {
  id: string;
  receiptId: string;
  newRollId: string;
  notes: string | null;
  newRoll?: Pick<Roll, 'id' | 'barcode' | 'item' | 'qualityGrade' | 'color'>;
}

export interface SubcontractorReceiptListItem {
  id: string;
  receiptNo: string;
  manifestNo: string | null;
  receivedAt: string;
  notes: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  appliedColorId?: string | null;
  appliedColor?: Color | null;
  workOrder?: Pick<WorkOrder, 'id' | 'batchNumber'>;
  subcontractor?: Pick<Subcontractor, 'id' | 'name' | 'code'>;
  step?: { id: string; stepSequence: number; station: Pick<Station, 'name' | 'code'> };
  receivedBy?: { id: string; username: string; fullName: string } | null;
  cancelledBy?: { id: string; username: string; fullName: string } | null;
  items?: { id: string }[];
  _count?: { items: number };
  totalQty?: number;
}

export interface SubcontractorReceipt extends SubcontractorReceiptListItem {
  items?: SubcontractorReceiptItem[];
  appliedProperties?: FabricProperty[];
}

export interface CancelReceiptRequest {
  reason: string;
}

// =============================================================================
// Refakat Kartı (Traveler Card)
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
// Kurşun + QC2 (PROCESS_QC istasyonu)
// =============================================================================

export interface KursunRollDefectSummary {
  id: string;
  startMeter: number;
  endMeter: number | null;
  defectTypeId: string | null;
  errorType: string | null;
}

export interface KursunRollSummary {
  rollId: string;
  barcode: string | null;
  currentQty: number;
  kursunApplied: boolean;
  qc2Completed: boolean;
  errorCount: number;
  defects: KursunRollDefectSummary[];
  itemName?: string;
  colorName?: string | null;
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

/** Açık kumaş aç (Kurşun/KK2) — `POST /api/rolls/open-fabric` */
export interface OpenFabricCreateRequest {
  receiptId: string;
  stepId: string;
  notes?: string | null;
}

/** Açık kumaş kapanışı (Kurşun/KK2) — `POST /api/rolls/:id/kursun-finish` */
export interface KursunFinishRequest {
  totalMeters: number;
  errors?: Array<{
    startMeter: number;
    endMeter?: number | null;
    defectTypeId?: string | null;
  }>;
  notes?: string | null;
}

// =============================================================================
// Tambur ekranı
// =============================================================================

export interface TamburRollDefect {
  id: string;
  startMeter: number;
  endMeter: number | null;
  errorType: string | null;
}

export interface TamburRollSummary {
  rollId: string;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
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
  qualityGrade?: string;
}

export type TamburFoldType = string; // serbest string ("2-KAT" / "4-KAT" / özel)

export interface TamburVoluntaryCut {
  start: number;
  end: number;
  qualityGrade: string;
}

/** Eski model — barkodlu Roll (boyahaneye gitmemiş) için. */
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
}

export interface TamburPostSplitRequest {
  rollId: string;
  cutLength: number;
  originalKeepsLarger: boolean;
}

export interface TamburSplitRollLabel {
  id: string;
  barcode: string | null;
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

// =============================================================================
// Yeni Tambur context — açık kumaş modeli (boyahane dönüşü)
// =============================================================================

export interface TamburContextOrderLine {
  lineId: string;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  orderedQty: number;
  shippedQty: number;
}

export interface TamburContextOrder {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  lines: TamburContextOrderLine[];
}

export interface TamburContextOpenFabricError {
  id: string;
  startMeter: number;
  endMeter: number | null;
  errorType: string | null;
}

export interface TamburContextOpenFabric {
  rollId: string;
  currentQty: number;
  initialQty: number;
  receiptNo: string | null;
  colorCode: string | null;
  colorName: string | null;
  kursunFinishedAt: string | null;
  errors: TamburContextOpenFabricError[];
}

export interface TamburContext {
  workOrderId: string;
  batchNumber: string;
  stepId: string;
  stationName: string;
  /** WO planlamasında belirlenen kat tipi — Tambur'a bilgi olarak iletilir. */
  plannedFoldType?: string | null;
  /** WO planlamasında belirlenen katman sayısı (1-20). */
  plannedLayerCount?: number | null;
  orders: TamburContextOrder[];
  openFabricRolls: TamburContextOpenFabric[];
}

/** `POST /api/tambur/:id/cut` — açık kumaşta tek kesim */
export interface TamburCutRequest {
  lengthMeters: number;
  status: 'WAREHOUSE' | 'SCRAP' | 'A1_STOCK';
  qualityGrade?: string | null;
  notes?: string | null;
}

/** `POST /api/tambur/:id/finalize-open-fabric` — açık kumaşı bitir */
export interface TamburFinalizeOpenFabricRequest {
  scrapRemaining?: boolean;
  notes?: string | null;
  foldType?: string | null;
  layerCount?: number | null;
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
// KK1 context — `GET /api/rolls/kk1-context/:cardBarcode`
// =============================================================================

export interface Kk1Context {
  workOrderId: string;
  batchNumber: string;
  stepId: string;
  stationCode: string;
  stationName: string;
  targetItem: { id: string; code: string; name: string } | null;
  targetColor: Color | null;
  rollCount: number;
}

// =============================================================================
// Label payload + template
// =============================================================================

export type NameSource = 'OVERRIDE' | 'MASTER' | 'DEFAULT';

export interface LabelPayload {
  rollId: string;
  barcode: string | null;
  status: string;
  qualityGrade: string;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number | null;
  packagingDate: string | null;

  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;

  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;

  ownerCustomerName: string | null;

  batchNumber: string | null;
  printedAt: string;
}

export interface SwatchLabelPayload {
  swatchId: string;
  cardNumber: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;
  widthCm: number | null;
  lengthCm: number;
  weightKg: number | null;
  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;
  ownerCustomerName: string | null;
  batchNumber: string | null;
  parentRollBarcode: string | null;
  printedAt: string;
}

export interface UpdateOrderLineCustomerNamesRequest {
  customerItemName?: string | null;
  customerColorName?: string | null;
}

// === Label Template ===

export type LabelKind = 'ROLL' | 'SWATCH' | 'SHIPMENT_DOCKET';

export type LabelFontSize = 'sm' | 'md' | 'lg' | 'xl';

export interface LabelFieldDef {
  key: string;
  defaultLabel: string;
  type: 'text' | 'number' | 'date' | 'qr' | 'barcode' | 'table';
  required?: boolean;
}

export interface LabelTemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: LabelFontSize;
}

export interface LabelTemplate {
  id: string;
  name: string;
  kind: LabelKind;
  isDefault: boolean;
  isActive: boolean;
  fields: LabelTemplateField[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LabelTemplateCatalog {
  kind: LabelKind;
  fields: LabelFieldDef[];
}

export interface LabelTemplateCreateRequest {
  name: string;
  kind: LabelKind;
  isDefault?: boolean;
  isActive?: boolean;
  fields?: LabelTemplateField[];
}

export interface LabelTemplateUpdateRequest {
  name?: string;
  isDefault?: boolean;
  isActive?: boolean;
  fields?: LabelTemplateField[];
}
