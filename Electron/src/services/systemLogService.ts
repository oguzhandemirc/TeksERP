import apiClient from "./apiClient";
import type { ApiResponse, CursorPaginatedResponse } from "@/types/api";
import type {
  SystemLogListItem,
  SystemLogDetail,
  SystemLogListParams,
  SystemLogUserOption,
  SystemLogStats,
  SystemLogArchiveResult,
} from "@/types/systemLog";

const BASE = "/api/admin/system-logs";

export const systemLogService = {
  list: (params: SystemLogListParams) =>
    apiClient
      .get<CursorPaginatedResponse<SystemLogListItem>>(BASE, { params })
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
