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
 */
const STATUS_GROUPS = {
  STOCK: "STOCK,WAREHOUSE",
  PRODUCTION: "IN_PRODUCTION",
  SUBCONTRACTOR: "AT_SUBCONTRACTOR",
  READY: "READY_FOR_SHIP",
  ARCHIVE: "SHIPPED,SCRAP,A1_STOCK,PRODUCED,RETURNED_FROM_SUBCONTRACTOR,TAMBUR_CONSUMED",
} as const;

const base = createCrudService<Roll>("/api/rolls");

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
  getByBarcode: (barcode: string): Promise<ApiResponse<Roll>> =>
    apiClient
      .get<ApiResponse<Roll>>(`/api/rolls/barcode/${encodeURIComponent(barcode)}`)
      .then((r) => r.data),
};

export const ROLL_STATUS_TABS = STATUS_GROUPS;
export type RollStatusTabKey = keyof typeof ROLL_STATUS_TABS;
