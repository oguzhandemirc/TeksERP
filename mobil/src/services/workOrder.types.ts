// İş emri servisinin tel tipleri — dosya boyu tavanı için servisten ayrıldı; workOrder.service yeniden ihraç eder.
import type { WorkOrder } from '../types/models';

/** WO oluşturma/replace için rota adımı. Replace'te mevcut adımı güncellemek için `id` ver. */
export interface WorkOrderStepInput {
  id?: string;
  stationId: string;
  notes?: string | null;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  /** Önerilen makine (yalnız öneri) — adımın istasyonuna ait olmalı. */
  plannedMachineId?: string | null;
  dispatchWithoutColor?: boolean;
  /** Oluşturmada dizi sırası (verilirse index+1); sunucu yok sayar. */
  sequence?: number;
}

/** WO oluşturma/replace ortak gövde — quick-start ve düzenleme paylaşır. */
export interface WorkOrderPayload {
  batchNumber?: string | null;
  /** İdempotency anahtarı — form-oturumu başına üretilir; timeout-replay'de
   *  mükerrer İE + refakat kartı önlenir (yalnız create/quick-start kullanır). */
  clientToken?: string;
  type?: 'ORDER_PRODUCTION' | 'STOCK_PRODUCTION' | 'CUSTOMER_GOODS_SERVICE'; customerId?: string | null; // Fason: yoksa topların tek sahibi
  width?: number | null;
  targetQuantity?: number | null;
  targetWeight?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  routeTemplateId?: string | null;
  targetItemId?: string | null;
  targetColorId?: string | null;
  foldType?: string | null;
  steps?: WorkOrderStepInput[];
  /**
   * routeTemplateId ile birlikte: şablondan klonlanan adımların not/fason planlamasını
   * `sequence`'e göre override eder (Hızlı İş Emri Gelişmiş modda istasyon notları).
   */
  stepPlanning?: {
    sequence: number;
    notes?: string | null;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
    /** Fasona renksiz git (2026-08-17 "ekru" kuralı) — çekideki renk satırı susar. */
    dispatchWithoutColor?: boolean;
    /** Önerilen makine (yalnız öneri; null = temizle). */
    plannedMachineId?: string | null;
  }[];
  orderLineIds?: string[];
  targetPropertyIds?: string[];
}

/** GET /work-orders/:id/linkable-order-lines satırı — backend aynası. */
export interface LinkableOrderLine {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  width: number | null;
  quantity: number;
  shippedQty: number;
  /** İstenen − sevk. KG/ADET satırda `null` = ölçülmüyor (satır yine bağlanabilir). */
  openQty: number | null;
  /** `openQty` ölçülüyor mu (`unit === MT`). Eski backend göndermez. */
  measured?: boolean;
  deadline: string | null;
  /** En farkı gibi ENGEL OLMAYAN uyumsuzluklar — uyarı çipi olarak gösterilir. */
  warnings: string[];
}

/** POST /work-orders/:id/order-links/override sonucu. */
export interface OrderLinkOverrideResult {
  changedColor: boolean;
  changedWidth: boolean;
  rollsUpdated: number;
  rollsFailed: { rollId: string; barcode: string | null; message: string }[];
  linked: boolean;
  warnings: string[];
}

/** PATCH /work-orders/:id — temel alan güncelleme (rota/sipariş hariç). */
export interface WorkOrderUpdatePayload {
  batchNumber?: string;
  width?: number | null;
  targetQuantity?: number | null;
  targetWeight?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  targetItemId?: string | null;
  targetColorId?: string | null;
  foldType?: string | null;
}

/** POST /work-orders/quick-start gövdesi. */
export interface QuickStartRequest extends WorkOrderPayload {
  rollBarcodes: string[];
  /** İlk rota adımı fason (boyahane) ise: WO açıldıktan sonra o adıma planlanan
   *  firmaya otomatik fason sevki de yapılır (çeki listesi dahil). "Fasona Gönder". */
  dispatchFirstStep?: boolean;
  /** K29 S15b: rotasız iş emri (rota anahtarı gönderilmez; yalnız "Okutmayla" kipinde, değilse 400 SCAN_ROUTE_DISABLED). */
  scanRouted?: boolean;
  /** Kendi üretim formu: `rollBarcodes` boş olabilir (topsuz İE); emanet top 400 WO_OWN_GOODS_CONSIGNED_ROLL. Eski sunucu siler. */
  ownGoods?: boolean;
}

export interface QuickStartResult {
  workOrder: WorkOrder;
  attached: number;
  errors: string[];
  /** Otomatik fason sevki yapıldıysa oluşan sevk (çeki listesi basımı için). */
  dispatch?: { id: string; dispatchNo: string } | null;
  /**
   * Topların bağlandığı PARTİ (P+GGAAYY+NNNN) — `attachRolls`ta doğar, sonuç
   * ekranında iş emri numarasının YANINDA gösterilir. İş Emri No ile aynı şey
   * DEĞİLDİR (kök CLAUDE.md "İş Emri No ≠ Parti"). Eski APK'lar bu alanı
   * göndermeyen backend'e karşı çalışabilsin diye opsiyonel.
   */
  batch?: { id: string; batchNumber: string } | null;
}

/** GET /work-orders/:id/cancel-impact cevabı (iptal önizleme). */
export interface WorkOrderCancelImpact {
  workOrderId: string;
  batchNumber: string;
  status: string;
  canCancel: boolean;
  blockReason: string | null;
  rolls: {
    id: string;
    barcode: string | null;
    status: string;
    currentQty: number;
    colorName: string | null;
    colorHex: string | null;
    propertyCount: number;
    processed: boolean;
    atSubcontractor: boolean;
  }[];
  travelerCardCount: number;
  atSubcontractorCount: number;
  processedCount: number;
}

/** GET /work-orders/:id/travel-card cevabı (refakat/iş emri kartı verisi). */
export interface WorkOrderTravelCard {
  batchNumber: string;
  type: string;
  width: number | null;
  targetColor: { id: string; code: string; name: string } | null;
  status: string;
  route: {
    sequence: number;
    stationCode: string | null;
    stationName: string;
    stationType: string;
    status: string;
  }[];
  linkedOrders: {
    orderNumber: string;
    customerName: string;
    itemName: string;
    colorName: string | null;
    requestedQty: number;
  }[];
  createdAt: string;
}

/** Cursor (keyset) sayfa cevabı — WO listesi infinite scroll için. */
export interface WorkOrderCursorPage {
  success: boolean;
  data: WorkOrder[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    totalEstimate?: number;
  };
}

export interface WorkOrderCursorParams {
  limit?: number;
  cursor?: string | null;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, string | string[]>;
  /** Tarih aralığı (liste ucu `applyDateRange`; `dateField` ZORUNLU). */
  withTotal?: boolean; dateField?: 'createdAt'; dateFrom?: string; dateTo?: string;
}

/** İş emri hareketi — başlık ve Türkçe etiketler sunucuda kurulur. */
export interface WorkOrderTimelineItem {
  id: string;
  at: string;
  group: string;
  title: string;
  detail: string | null;
  reason: string | null;
  actor: string | null;
  channel: string | null;
  trigger: string | null;
  derived: boolean;
}

/** `GET /work-orders/:id/target-color/preview` yanıtı. */
export interface TargetColorPreview {
  blocked: { code: string | null; message: string } | null;
  partial: { dyedCount: number; pendingCount: number } | null;
  warnings: string[];
  cardWillBeStale: boolean;
}

/** `GET /work-orders/:id/detach-candidates` satırı. */
export interface DetachCandidate {
  id: string;
  barcode: string | null;
  currentQty: number;
  status: string;
  detachable: boolean;
  blockers: string[];
}

/** Liste ucunun `withMeterSummary=true` satır alanı (backend `meter-comparison.service` aynası). */
export interface WorkOrderMeterSummary {
  declaredM: number | null;
  measuredMaxM: number | null;
  billedM: number | null;
  diffM: number | null;
  diffPct: number | null;
  withinTolerance: boolean;
  longerThanDeclared: boolean;
}

export interface MeterParty {
  partyKey: string;
  batchNo: string | null;
  declaredM: number | null;
  kursunOutM: number | null;
  tamburInM: number | null;
  tamburCutM: number | null;
  measuredMaxM: number | null;
  billedM: number | null;
  diffM: number | null;
  longerThanDeclared: boolean;
}

/** `GET /work-orders/:id/meter-comparison` yanıtı (okunan alanlar). */
export interface WorkOrderMeterComparison {
  tolerancePct: number;
  parties: MeterParty[];
  totals: { declaredM: number | null; measuredMaxM: number | null; billedM: number | null; diffM: number | null };
}
