import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { Warehouse } from "./types";
import type { WarehouseEventType, WarehouseMovementListResponse } from "./movements";

export const warehouseService = createCrudService<Warehouse>("/api/warehouses");

/**
 * Varsayılan depoyu değiştir. Backend tek tx'te takas eder (önce eskisini düşürür)
 * — istemci iki ayrı PATCH atarsa partial unique'e çarpar, o yüzden ÖZEL uç.
 */
export async function setDefaultWarehouse(id: string): Promise<void> {
  await apiClient.post(`/api/warehouses/${id}/default`);
}

/**
 * DEPO HAREKET DÖKÜMÜ — append-only defterin okuma ucu.
 *
 * ⚠️ YOL TAM YAZILIR ("/api/warehouses/…") — `apiClient.baseURL` `/api` İÇERMEZ.
 * Öneksiz yol 404 alır, çağıran hatayı yutarsa ekran "kayıt yok" gösterir
 * (2026-08-12'de FilterBar lookup'larında tam bu yaşandı).
 *
 * ⚠️ SÜZME SUNUCUDA. Döküm cursor'lu ve KISMİDİR; istemcide süzmek yalnız o anki
 * sayfayı süzer ve kullanıcı "kayıt yok" sanır — oysa kayıt bir sonraki sayfada.
 *
 * ⚠️ `warehouseId` GÖNDERİLMEZSE satırların `direction`'ı NULL gelir (yön bakan
 * depoya göredir). Depo detayından açılan döküm onu HER ZAMAN gönderir.
 */
export async function listWarehouseMovements(params: {
  limit: number;
  cursor?: string;
  warehouseId?: string;
  eventType?: WarehouseEventType;
  rollId?: string;
  sackId?: string;
  /** Mutlak an (ISO). Gün sınırı İSTEMCİNİNDİR — `dayStartIso`/`dayEndIso`. */
  dateFrom?: string;
  dateTo?: string;
}): Promise<WarehouseMovementListResponse> {
  const res = await apiClient.get("/api/warehouses/movements", {
    params: {
      limit: params.limit,
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      ...(params.eventType ? { eventType: params.eventType } : {}),
      ...(params.rollId ? { rollId: params.rollId } : {}),
      ...(params.sackId ? { sackId: params.sackId } : {}),
      ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
      ...(params.dateTo ? { dateTo: params.dateTo } : {}),
    },
  });
  return res.data as WarehouseMovementListResponse;
}
