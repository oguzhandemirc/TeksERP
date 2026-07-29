import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type {
  ApiResponse,
  CursorPaginatedResponse,
  CursorParams,
  PaginatedResponse,
  QueryParams,
} from "@/types/api";
import { buildCursorQueryString, buildQueryString } from "@/lib/query-builder";
import type { Roll } from "./types";

/**
 * Top yaşam döngüsü sekmeleri — backend `filter[status]` CSV olarak alır,
 * `buildWhereClause` virgülü `{ in: [...] }`'a çevirir. Sekme her zaman
 * forceFilters üzerinden gönderilir; `withDefault*` artık gerekmiyor.
 *
 * Station-bazlı sekmeler (`KURSUN_PENDING` ve `TAMBUR_PENDING`) status
 * filtrelemez — sırasıyla `currentStepKind=PROCESS_QC` (KK2/Kurşun) ve
 * `currentStepKind=TAMBUR` filtresi uygulanır (`buildRollForceFilters` içinde).
 * İstasyonda sıra bekleyen açık kumaş VE barkodlu toplar birlikte listelenir
 * (rollKind=OPEN_FABRIC filtresi 2026-07-27'de kaldırıldı — barkodlu top da
 * istasyonda meşru bekler).
 */
/**
 * Sekme → backend filter. Null değerli sekmeler `status` filter göndermez,
 * `buildRollForceFilters` üzerinden farklı parametre (rollScope,
 * currentStepKind, rollKind) ile çalışır.
 *
 * Eski "STOCK" sekmesi iki ayrı sekmeye bölündü:
 *   - RAW_STOCK: KK1 ham, henüz üretime girmemiş (rollScope=RAW_STOCK)
 *   - FINISHED_STOCK: Tambur sonrası depoda (rollScope=FINISHED_STOCK)
 * "PRODUCTION" sekmesi super-set: tüm WO akışındaki toplar (Fasonda + Kurşun
 * Bekleyen + Tambur Bekleyen + IN_PRODUCTION). Diğer sekmeler alt-küme.
 */
const STATUS_GROUPS = {
  RAW_STOCK: null,
  PRODUCTION: null,
  SUBCONTRACTOR: "AT_SUBCONTRACTOR",
  KURSUN_PENDING: null,
  TAMBUR_PENDING: null,
  FINISHED_STOCK: null,
  // Çuvalda: bir çuvala konmuş, henüz sevk edilmemiş toplar (rollScope=IN_SACK).
  IN_SACK: null,
  // Sanal anahtar — tepe-sekme DEĞİL; Kartela sayfasının "Kartelada Toplar"
  // sekmesi bunu kullanır (status=AT_KARTELA). SUBCONTRACTOR ile aynı mekanizma.
  KARTELA_SENT: "AT_KARTELA",
  ARCHIVE:
    "RETURNED_FROM_SUBCONTRACTOR,TAMBUR_CONSUMED,SUBCONTRACTOR_CONSUMED,KARTELA_CONSUMED",
} as const;

const base = createCrudService<Roll>("/api/rolls");

export interface InitialEntryPayload {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  weightKg?: number;
  qualityGrade?: string;
  width?: number | null;
  propertyIds?: string[];
  /** İdempotency anahtarı — timeout sonrası tekrar denemede mükerrer (hayalet)
   *  top yaratılmasını önler (backend Roll.clientToken @unique; mobil KK1 emsali). */
  clientToken?: string;
}

export interface RollStats {
  totalCount: number;
  totalQty: number;
  totalWeight: number;
  byStatus: Record<string, number>;
  byQuality: Record<string, number>;
}

// --- Fasonda özet şeridi (Envanter → Fasonda sekmesi) -----------------------
/** İşlem-tipi chip'i — kategori bazında top adedi + Σmetre. Kategorisiz sevkler
 *  (adımda requiredCategory yok) categoryId:null + name:"Bilinmiyor" kovasında
 *  toplanır → chip DISABLED (filtrelenemez). */
export interface FasonSummaryCategory {
  categoryId: string | null;
  name: string;
  rollCount: number;
  totalQty: number;
}

/** Firma kartı — firmadaki top adedi + Σmetre + en eski aktif sevkin yaşı.
 *  subcontractorId:null → açık sevk kalemi bulunamayan AT_SUBCONTRACTOR top
 *  (veri anomalisi) = "Bilinmiyor" kartı, DISABLED (filtrelenemez). */
export interface FasonSummaryFirm {
  subcontractorId: string | null;
  name: string;
  code: string | null;
  rollCount: number;
  totalQty: number;
  /** En eski açık sevkin tarihi (ISO) — null yalnız "Bilinmiyor" grubunda. */
  oldestDispatchedAt: string | null;
  /** En eski açık sevkin yaşı (gün, backend floor). Frontend BUNU basar,
   *  yeniden HESAPLAMAZ; null iken "en eski N gün" satırı gizlenir. */
  oldestDays: number | null;
}

export interface FasonSummary {
  total: { rollCount: number; totalQty: number };
  byCategory: FasonSummaryCategory[];
  bySubcontractor: FasonSummaryFirm[];
}

// --- Üretim Akışı (Kanban) — tek-istek pano cevabı ------------------------
/** Kurşun/Tambur kolonu kartı (adım = bir WO'nun kuyruğu). */
export interface ProductionFlowQueueCard {
  id: string;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  totalCurrentQty: number;
  /** İş emri no (İE…) — eski `batchNumber` alanı parti-redesign köprüsüydü. */
  workOrderNumber: string;
  isUrgent: boolean;
}

/** Sevk kolonu kartı — çıkış bekleyen (PLANNED) planlı sevk. */
export interface ProductionFlowSackCard {
  id: string;
  shipmentNo: string;
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
  sackCount: number;
  totalKg: number;
  totalQty: number;
}

/** 6 kolon; her biri ≤10 önizleme kaydı + gerçek toplam sayaç. */
export interface ProductionFlowData {
  hamStok: { rolls: Roll[]; total: number };
  fason: { rolls: Roll[]; total: number };
  kursun: { cards: ProductionFlowQueueCard[]; total: number };
  tambur: { cards: ProductionFlowQueueCard[]; total: number };
  depo: { rolls: Roll[]; total: number };
  sevk: { shipments: ProductionFlowSackCard[]; total: number };
}

export const rollService = {
  ...base,
  getAll: (params: QueryParams): Promise<PaginatedResponse<Roll>> =>
    apiClient
      .get<PaginatedResponse<Roll>>(`/api/rolls${buildQueryString(params)}`)
      .then((r) => r.data),
  listCursor: (params: CursorParams): Promise<CursorPaginatedResponse<Roll>> =>
    apiClient
      .get<CursorPaginatedResponse<Roll>>(`/api/rolls${buildCursorQueryString(params)}`)
      .then((r) => r.data),
  getStats: (params: QueryParams): Promise<ApiResponse<RollStats>> =>
    apiClient
      .get<ApiResponse<RollStats>>(`/api/rolls/stats${buildQueryString(params)}`)
      .then((r) => r.data),
  /** Envanter özeti — N kategori filtresi için toplu sayım (top + metre) TEK istekte. */
  getStatsBatch: (
    items: Array<{ key: string; filters: Record<string, string | string[]> }>,
  ): Promise<ApiResponse<Array<{ key: string; totalCount: number; totalQty: number }>>> =>
    apiClient
      .post<ApiResponse<Array<{ key: string; totalCount: number; totalQty: number }>>>(
        "/api/rolls/stats-batch",
        { items },
      )
      .then((r) => r.data),
  /** Üretim Akışı (Kanban) panosu — 6 kolon tek istekte (kolon başına ≤10 + toplam). */
  getProductionFlow: (): Promise<ApiResponse<ProductionFlowData>> =>
    apiClient
      .get<ApiResponse<ProductionFlowData>>("/api/rolls/production-flow")
      .then((r) => r.data),
  /** Fasonda özet şeridi — işlem chip'leri + firma kartları TEK istekte.
   *  Evren: AT_SUBCONTRACTOR; includeFire=true iken FIRE toplar da dahil
   *  ("Fire kaliteyi de göster" toggle'ıyla hizalı — şerit/tablo sayıları tutar). */
  getSubcontractorSummary: (includeFire = false): Promise<ApiResponse<FasonSummary>> =>
    apiClient
      .get<ApiResponse<FasonSummary>>(
        `/api/rolls/subcontractor-summary${includeFire ? "?filter[includeFire]=true" : ""}`,
      )
      .then((r) => r.data),
  getByBarcode: (barcode: string): Promise<ApiResponse<Roll>> =>
    apiClient
      .get<ApiResponse<Roll>>(`/api/rolls/barcode/${encodeURIComponent(barcode)}`)
      .then((r) => r.data),
  createInitialEntry: (payload: InitialEntryPayload): Promise<ApiResponse<Roll>> =>
    apiClient
      .post<ApiResponse<Roll>>("/api/rolls/initial-entry", payload)
      .then((r) => r.data),
};

export const ROLL_STATUS_TABS = STATUS_GROUPS;
export type RollStatusTabKey = keyof typeof ROLL_STATUS_TABS;

/**
 * Sekme → backend'e zorla gönderilen taban filtre (forceFilters). Tablo
 * (useDataTable) ve üst-satır özeti (useRollStats) AYNI tabanı paylaşsın diye
 * tek kaynak — yoksa liste ile "Top/Metre" toplamı birbirinden sapar.
 */
export function buildRollForceFilters(
  tab: RollStatusTabKey,
): Record<string, string | string[]> {
  // KK1 ham kumaş: renksiz + henüz hiçbir adıma girmemiş.
  if (tab === "RAW_STOCK") return { rollScope: "RAW_STOCK", status: "ALL" };
  // Super-set: WO akışındaki tüm toplar (Fasonda + Kurşun/Tambur bekleyen + IN_PRODUCTION).
  if (tab === "PRODUCTION") return { rollScope: "PRODUCTION_ACTIVE", status: "ALL" };
  // Tambur sonrası depoya alınmış, sevke hazır.
  if (tab === "FINISHED_STOCK") return { rollScope: "FINISHED_STOCK", status: "ALL" };
  // Çuvalda: bir çuvala konmuş (sackId dolu), henüz sevk edilmemiş toplar.
  if (tab === "IN_SACK") return { rollScope: "IN_SACK", status: "ALL" };
  // Kurşun/KK2 istasyonunda bekleyen kayıtlar (status=ALL şart — yoksa default STOCK).
  // rollKind=OPEN_FABRIC filtresi KALDIRILDI (2026-07-27): "barkodlu top da
  // kesilebilir/işlenebilir" (2026-07-16) sonrası istasyonda barkodlu TOP meşru
  // bekler (Konumu-Düzelt / depodan WO'ya alınan top); barkod filtresi onları
  // gizleyip sekme sayısını Kanban'la çelişik gösteriyordu.
  if (tab === "KURSUN_PENDING")
    return { currentStepKind: "PROCESS_QC", status: "ALL" };
  // Tambur istasyonunda bekleyen kayıtlar (açık kumaş + barkodlu top).
  if (tab === "TAMBUR_PENDING")
    return { currentStepKind: "TAMBUR", status: "ALL" };
  const statusVal = ROLL_STATUS_TABS[tab];
  const out: Record<string, string | string[]> = {};
  if (statusVal) out.status = statusVal;
  return out;
}
