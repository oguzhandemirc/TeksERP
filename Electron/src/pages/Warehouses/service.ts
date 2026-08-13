import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { Warehouse } from "./types";

export const warehouseService = createCrudService<Warehouse>("/api/warehouses");

/**
 * Varsayılan depoyu değiştir. Backend tek tx'te takas eder (önce eskisini düşürür)
 * — istemci iki ayrı PATCH atarsa partial unique'e çarpar, o yüzden ÖZEL uç.
 */
export async function setDefaultWarehouse(id: string): Promise<void> {
  await apiClient.post(`/api/warehouses/${id}/default`);
}
