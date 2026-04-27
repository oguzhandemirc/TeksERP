import type {
  ItemType,
  CompanyType,
  StationType,
  StationKind,
  RollStatus,
  OrderStatus,
  WorkOrderStatus,
  WorkOrderType,
  StepStatus,
  ShipmentStatus,
  TravelerCardStatus,
  ScanType,
} from "./enums";

export interface ItemVariant {
  id: string;
  itemId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  unit: string;
  isActive: boolean;
  // Türetilmiş Item alanları (fason dönüşünde otomatik üretilir)
  baseItemId?: string | null;
  colorId?: string | null;
  isDerived?: boolean;
  baseItem?: Item | null;
  color?: Color | null;
  properties?: ItemProperty[];
  createdAt: string;
  updatedAt: string;
}

export interface Color {
  id: string;
  code: string;
  name: string;
  hex: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemProperty {
  id: string;
  itemId: string;
  propertyId: string;
  property?: FabricProperty;
  createdAt: string;
}

// Bir istasyonun renk + özellik yetkinlikleri (StationCapabilityService DTO)
export interface StationCapability {
  stationId: string;
  stationCode: string;
  stationName: string;
  colors: { id: string; code: string; name: string; hex: string | null }[];
  properties: {
    id: string;
    code: string;
    name: string;
    category: string | null;
  }[];
}

export interface StationCapabilitySummary {
  stationId: string;
  stationCode: string;
  stationName: string;
  colorCount: number;
  propertyCount: number;
}

// WO için hedef özellik kaydı (m:n)
export interface WorkOrderTargetProperty {
  id: string;
  workOrderId: string;
  propertyId: string;
  plannedStepId: string | null;
  notes: string | null;
  property?: FabricProperty;
  plannedStep?: WorkOrderStep | null;
  createdAt: string;
  updatedAt: string;
}

// Sipariş satırı için hedef özellik kaydı (m:n, opsiyonel)
export interface OrderLineTargetProperty {
  id: string;
  orderLineId: string;
  propertyId: string;
  property?: FabricProperty;
  createdAt: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  type: CompanyType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  type: StationType;
  kind: StationKind;
  department: string | null;
  isActive: boolean;
  machines?: Machine[];
  createdAt: string;
  updatedAt: string;
}

export interface Machine {
  id: string;
  stationId: string;
  code: string;
  name: string;
  deviceIp: string | null;
  isActive: boolean;
  station?: Station;
  createdAt: string;
  updatedAt: string;
}

export interface Route {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  isFavorite?: boolean;
  customerId?: string | null;
  customer?: Customer;
  isActive: boolean;
  steps?: RouteStep[];
  createdAt: string;
  updatedAt: string;
}

export interface RouteStep {
  id: string;
  routeId: string;
  stationId: string;
  sequence: number;
  defaultNotes?: string | null;
  station?: Station;
  createdAt: string;
  updatedAt: string;
}

export type RollOperationType =
  | "KURSUN_APPLIED"
  | "QC2_COMPLETED"
  | "TAMBUR_PROCESSED"
  | "PACKAGED"
  | "SUBCONTRACTOR_SENT"
  | "SUBCONTRACTOR_RETURNED";

export interface Roll {
  id: string;
  barcode: string;
  itemId: string;
  variantId?: string | null;
  ownerCustomerId?: string | null;
  customerDescription?: string | null;
  initialQty: number;
  currentQty: number;
  weightKg?: number | null;
  status: RollStatus;
  qualityGrade: string;
  width?: number | null;
  design?: string | null;
  producedInStepId?: string | null;
  currentStepId?: string | null;
  parentRollId?: string | null;
  packageId?: string | null;
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
  packagingDate?: string | null;
  item?: Item;
  variant?: ItemVariant | null;
  ownerCustomer?: Customer | null;
  errors?: RollError[];
  allocations?: OrderAllocation[];
  operations?: { operationType: RollOperationType }[];
  producedInStep?: {
    workOrder?: { id: string; batchNumber: string; type?: WorkOrderType };
  } | null;
  createdAt: string;
  updatedAt: string;
}

export type RollHistoryEventKind =
  | "CREATED"
  | "MOVEMENT_IN"
  | "MOVEMENT_OUT"
  | "OPERATION"
  | "SUBCONTRACTOR_DISPATCH"
  | "SUBCONTRACTOR_RECEIPT"
  | "SHIPPED";

export interface RollHistoryEvent {
  kind: RollHistoryEventKind;
  subKind?: string;
  at: string;
  title: string;
  stationName: string | null;
  details: Record<string, unknown>;
  operatorName: string | null;
}

export interface RollHistoryPayload {
  roll: {
    id: string;
    barcode: string;
    status: RollStatus;
    initialQty: number;
    currentQty: number;
    weightKg: number | null;
    item: { id: string; code: string; name: string; itemType: string } | null;
    variant: { id: string; code: string; name: string } | null;
  };
  events: RollHistoryEvent[];
}

export interface DefectType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: "MINOR" | "MAJOR" | "CRITICAL" | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QualityGrade {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RollError {
  id: string;
  rollId: string;
  startMeter: number;
  endMeter: number;
  defectTypeId: string | null;
  defectType?: DefectType | null;
  errorType: string | null; // DefectType.name snapshot (kayıt anında donar)
  isProcessed: boolean;
  actionTaken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderAllocation {
  id: string;
  orderLineId: string;
  rollId: string;
  allocatedQty: number;
  orderLine?: {
    id: string;
    order?: {
      id: string;
      orderNumber: string;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  currency: string;
  totalAmount: number | null;
  status: OrderStatus;
  orderDate: string;
  deadline: string | null;
  customer?: Customer;
  lines?: OrderLine[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderLine {
  id: string;
  orderId: string;
  itemId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice?: number | null;
  width?: number | null;
  item?: Item;
  variant?: ItemVariant | null;
  allocations?: OrderAllocation[];
  // Müşterinin istediği renk + özellikler (opsiyonel — WO oluşturulurken öneri olur)
  targetColorId?: string | null;
  targetColor?: Color | null;
  targetProperties?: OrderLineTargetProperty[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrder {
  id: string;
  batchNumber: string;
  type: WorkOrderType;
  width?: number | null;
  targetQuantity?: number | null;
  recipeNo?: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  parameters: Record<string, unknown> | null;
  status: WorkOrderStatus;
  routeTemplateId?: string | null;
  dyehouseCompanyId?: string | null;
  dyehouseCompany?: Customer;
  servicePricePerMeter?: number | string | null;
  serviceOwnerCustomer?: { id: string; code: string; name: string } | null;
  steps?: WorkOrderStep[];
  orderLinks?: WorkOrderToOrderLine[];
  travelerCards?: TravelerCard[];
  manifests?: Manifest[];
  // Hedef renk + özellikler (fason adımlarında uygulanır)
  targetColorId?: string | null;
  targetColorStepId?: string | null;
  targetColor?: Color | null;
  targetColorStep?: WorkOrderStep | null;
  targetProperties?: WorkOrderTargetProperty[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderStep {
  id: string;
  workOrderId: string;
  stationId: string;
  stepSequence: number;
  status: StepStatus;
  stepData: Record<string, unknown> | null;
  notes: string | null;
  skipReason?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  station?: Station;
  workOrder?: WorkOrder;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderToOrderLine {
  workOrderId: string;
  orderLineId: string;
  allocatedQty?: number;
  orderLine?: OrderLine & {
    order?: { id: string; orderNumber: string; customer?: Customer };
    item?: Item;
  };
  createdAt: string;
}

export interface TravelerCard {
  id: string;
  cardNumber: string;
  barcode: string;
  workOrderId: string;
  version: number;
  status: TravelerCardStatus;
  printedAt: string;
  printedById?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  workOrder?: WorkOrder;
  printedBy?: { id: string; username: string; fullName: string };
  scans?: TravelerCardScan[];
  createdAt: string;
  updatedAt: string;
}

export interface TravelerCardScan {
  id: string;
  cardId: string;
  stationId: string;
  workOrderStepId?: string | null;
  scanType: ScanType;
  scannedAt: string;
  scannedById?: string | null;
  deviceId?: string | null;
  notes?: string | null;
  station?: Station;
  step?: WorkOrderStep;
  scannedBy?: { id: string; username: string; fullName: string };
  card?: TravelerCard;
}

export interface Manifest {
  id: string;
  manifestNo: string;
  workOrderId: string;
  printedAt: string;
  printedById?: string | null;
  snapshot: Record<string, unknown>;
  notes?: string | null;
  printedBy?: { id: string; username: string; fullName: string };
  createdAt: string;
}

export interface Shipment {
  id: string;
  shipmentNumber: string;
  customerId: string;
  driverName: string | null;
  plateNumber: string | null;
  carrier: string | null;
  status: ShipmentStatus;
  shippedAt: string | null;
  customerCodeSnapshot: string | null;
  customerNameSnapshot: string | null;
  customer?: Customer;
  items?: ShipmentItem[];
  _count?: { items: number };
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentItem {
  id: string;
  shipmentId: string;
  rollId: string;
  shippedQty: number;
  shippedWeight: number | null;
  rollBarcodeSnapshot: string | null;
  itemCodeSnapshot: string | null;
  itemNameSnapshot: string | null;
  orderNumberSnapshot: string | null;
  roll?: Roll;
  /** Müşteri kendi kataloğunda bu ürünü nasıl isimlendiriyor (desen alias) */
  customerAlias?: {
    customerLabel: string;
    customerCode: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReadyOrderView {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerId: string;
  status: string;
  deadline: string | null;
  lines: ReadyOrderLineView[];
}

export interface ReadyOrderLineView {
  lineId: string;
  itemName: string;
  requestedQty: number;
  allocatedRolls: {
    allocationId: string;
    rollId: string;
    barcode: string;
    allocatedQty: number;
    rollStatus: string;
    packageId: string | null;
  }[];
}

export interface SystemLog {
  id: string;
  userId: string | null;
  action: string;
  tableName: string;
  recordId: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  user?: { id: string; username: string; fullName: string };
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  roles?: { role: { id: string; name: string } }[];
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Subcontractor (Fason) — Dispatch & Receipt
// =============================================================================

export interface SubcontractorDispatchItem {
  id: string;
  dispatchId: string;
  rollId: string;
  dispatchedQty: number;
  dispatchedWeight?: number | null;
  roll?: Roll;
  createdAt: string;
}

export interface SubcontractorDispatch {
  id: string;
  dispatchNo: string;
  workOrderId: string;
  stepId: string;
  companyId: string;
  plateNumber?: string | null;
  driverName?: string | null;
  dispatchedAt: string;
  dispatchedById?: string | null;
  notes?: string | null;
  totalQty: number;
  workOrder?: WorkOrder;
  step?: WorkOrderStep;
  company?: Customer;
  dispatchedBy?: { id: string; username: string; fullName: string };
  items?: SubcontractorDispatchItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SubcontractorReceiptItem {
  id: string;
  receiptId: string;
  newRollId: string;
  sourceDispatchItemId?: string | null;
  notes?: string | null;
  newRoll?: Roll;
  sourceDispatchItem?: SubcontractorDispatchItem;
  createdAt: string;
}

export interface SubcontractorReceipt {
  id: string;
  receiptNo: string;
  manifestNo: string;
  workOrderId: string;
  stepId: string;
  companyId: string;
  receivedAt: string;
  receivedById?: string | null;
  notes?: string | null;
  workOrder?: WorkOrder;
  step?: WorkOrderStep;
  company?: Customer;
  receivedBy?: { id: string; username: string; fullName: string };
  items?: SubcontractorReceiptItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PendingReturnGroup {
  step: {
    id: string;
    stepSequence: number;
    station: Station;
    notes: string | null;
  };
  workOrder: {
    id: string;
    batchNumber: string;
    recipeNo: string | null;
    dyehouseCompany?: Customer | null;
    status: WorkOrderStatus;
  };
  lastDispatch: SubcontractorDispatch | null;
  rolls: Roll[];
  rollCount: number;
  totalQty: number;
}

// =============================================================================
// Swatch (Kartela)
// =============================================================================

export interface Swatch {
  id: string;
  cardNumber: string;
  barcode: string;
  itemId: string;
  variantId?: string | null;
  width?: number | null;
  length: number;
  workOrderId?: string | null;
  parentRollId?: string | null;
  purpose?: string | null;
  createdById?: string | null;
  item?: Item;
  variant?: ItemVariant | null;
  workOrder?: WorkOrder;
  parentRoll?: Roll;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Step-info response (production/step-info)
// =============================================================================

export interface StepInfoResponse {
  roll: Roll;
  currentStep: {
    id: string;
    stepSequence: number;
    status: StepStatus;
    notes: string | null;
    stepData: Record<string, unknown> | null;
    station: Station;
    startedAt: string | null;
    rollActive?: boolean;
    rollCompleted?: boolean;
    canStart?: boolean;
    canFinish?: boolean;
    canSkip?: boolean;
    isExternal?: boolean;
    rollMovementStartedAt?: string | null;
  } | null;
  nextStep: {
    id: string;
    stepSequence: number;
    station: Station;
    notes: string | null;
  } | null;
  stationMatches: boolean;
  stationMismatchMessage?: string | null;
  workOrder?: {
    id: string;
    batchNumber: string;
    recipeNo: string | null;
    status: WorkOrderStatus;
    width?: number | null;
    targetQuantity?: number | null;
    dyehouseCompany?: Customer | null;
    orderLinks?: WorkOrderToOrderLine[];
  };
  allSteps?: Array<{
    id: string;
    stepSequence: number;
    status: StepStatus;
    station: Station;
  }>;
  message?: string;
}
