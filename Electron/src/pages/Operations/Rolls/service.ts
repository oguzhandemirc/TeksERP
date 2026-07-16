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
 * `currentStepKind=TAMBUR` ile `rollKind=OPEN_FABRIC` filtreleri uygulanır
 * (`buildRollForceFilters` içinde). Her iki ekranda da fasondan dönen ve
 * istasyonda sıra bekleyen açık kumaş kayıtları listelenir.
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
  ARCHIVE: "RETURNED_FROM_SUBCONTRACTOR,TAMBUR_CONSUMED,SUBCONTRACTOR_CONSUMED",
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
  /** Üretim Akışı (Kanban) panosu — 6 kolon tek istekte (kolon başına ≤10 + toplam). */
  getProductionFlow: (): Promise<ApiResponse<ProductionFlowData>> =>
    apiClient
      .get<ApiResponse<ProductionFlowData>>("/api/rolls/production-flow")
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
  // Kurşun/KK2 istasyonundaki açık kumaş kayıtları (status=ALL şart — yoksa default STOCK).
  if (tab === "KURSUN_PENDING")
    return { currentStepKind: "PROCESS_QC", rollKind: "OPEN_FABRIC", status: "ALL" };
  // Tambur istasyonunda bekleyen açık kumaş.
  if (tab === "TAMBUR_PENDING")
    return { currentStepKind: "TAMBUR", rollKind: "OPEN_FABRIC", status: "ALL" };
  const statusVal = ROLL_STATUS_TABS[tab];
  const out: Record<string, string | string[]> = {};
  if (statusVal) out.status = statusVal;
  return out;
}
