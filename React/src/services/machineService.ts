import apiClient from "./apiClient";
import { createCrudService } from "./crudService";
import type { PaginatedResponse, QueryParams } from "@/types/api";
import type { Machine } from "@/types/models";
import { buildQueryString } from "@/lib/query-builder";

const crudOps = createCrudService<Machine>("/api/machines");

export const machineService = {
  ...crudOps,
  getAll(params: QueryParams): Promise<PaginatedResponse<Machine>> {
    const qs = buildQueryString(params);
    return apiClient
      .get<PaginatedResponse<Machine>>(`/api/stations/machines${qs}`)
      .then((r) => r.data);
  },
};
