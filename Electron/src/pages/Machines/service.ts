import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import { buildQueryString } from "@/lib/query-builder";
import type { PaginatedResponse, QueryParams } from "@/types/api";
import type { Machine } from "./types";

// Backend asimetrisi: liste /api/stations/machines, CRUD /api/machines.
const base = createCrudService<Machine>("/api/machines");

export const machineService = {
  ...base,
  getAll: (params: QueryParams): Promise<PaginatedResponse<Machine>> =>
    apiClient
      .get<PaginatedResponse<Machine>>(`/api/stations/machines${buildQueryString(params)}`)
      .then((r) => r.data),
};
