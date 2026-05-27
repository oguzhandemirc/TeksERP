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
 * (RollsTable.tsx içinde). Her iki ekranda da fasondan dönen ve istasyonda
 * sıra bekleyen açık kumaş kayıtları listelenir.
 */
/**
 * Sekme → backend filter. Null değerli sekmeler `status` filter göndermez,
 * RollsTable.tsx `forceFilters` üzerinden farklı parametre (rollScope,
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
}

export interface RollStats {
  totalCount: number;
  totalQty: number;
  totalWeight: number;
  byStatus: Record<string, number>;
  byQuality: Record<string, number>;
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
