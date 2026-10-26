import apiClient from "./apiClient";
import type { ApiResponse, CursorPaginatedResponse } from "@/types/api";
import type {
  SystemLogListItem,
  SystemLogDetail,
  SystemLogListParams,
  SystemLogUserOption,
  SystemLogStats,
  SystemLogArchiveResult,
  SystemLogIslem,
  SystemLogIslemDetay,
} from "@/types/systemLog";

const BASE = "/api/admin/system-logs";

/** Liste yanıtı: `q` aramasında sunucu `warnings` döndürebilir. */
export type SystemLogListResponse<T> = CursorPaginatedResponse<T> & {
  warnings?: string[];
  /** B4: sunucu "Reddedilenler" süzgecini tanıyor (yoksa eski backend → çip gizli). */
  reddedilenSuzgeci?: boolean;
};

export const systemLogService = {
  list: (params: SystemLogListParams) =>
    apiClient
      .get<SystemLogListResponse<SystemLogListItem>>(BASE, { params })
      .then((r) => r.data),

  /**
   * Etkinlik akışı: `gorunum=islem` (iş eylemi) ya da satır. Eski backend
   * `gorunum`u yok sayıp satır döndürebilir — öğe tipi çağıranda ayırt edilir.
   */
  feed: (params: SystemLogListParams) =>
    apiClient
      .get<SystemLogListResponse<SystemLogIslem | SystemLogListItem>>(BASE, { params })
      .then((r) => r.data),

  /** Tek işlem: iz + cihaz adı + etkilenen kayıtlar. Eski backend 404 verir. */
  getIslem: (requestId: string) =>
    apiClient
      .get<ApiResponse<SystemLogIslemDetay>>(`${BASE}/islem/${encodeURIComponent(requestId)}`)
      .then((r) => r.data),

  findById: (id: string) =>
    apiClient.get<ApiResponse<SystemLogDetail>>(`${BASE}/${id}`).then((r) => r.data),

  users: () =>
    apiClient
      .get<ApiResponse<SystemLogUserOption[]>>(`${BASE}/users`)
      .then((r) => r.data),

  tables: () =>
    apiClient.get<ApiResponse<string[]>>(`${BASE}/tables`).then((r) => r.data),

  stats: () =>
    apiClient.get<ApiResponse<SystemLogStats>>(`${BASE}/stats`).then((r) => r.data),

  archive: (monthsToKeep: number) =>
    apiClient
      .post<ApiResponse<SystemLogArchiveResult>>(`${BASE}/archive`, { monthsToKeep })
      .then((r) => r.data),

  listArchive: (params: SystemLogListParams) =>
    apiClient
      .get<CursorPaginatedResponse<SystemLogListItem>>(`${BASE}/archive`, { params })
      .then((r) => r.data),

  findArchiveById: (id: string) =>
    apiClient
      .get<ApiResponse<SystemLogDetail>>(`${BASE}/archive/${id}`)
      .then((r) => r.data),
};
