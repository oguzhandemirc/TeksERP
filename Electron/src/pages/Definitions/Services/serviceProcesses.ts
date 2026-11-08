// Hizmet kartı ↔ süreç türü eşlemesi (fason F3, `service_item_processes`). Bir süreç türü TEK karta eşlenir;
// yazım kart başına KÜME değişimidir (`PUT /:id/processes`). Ayar `finance.serviceBilling.stepWorks` açıkken
// eşlenen türdeki adım işi hizmet satırı olur. Tel şekli backend `service-item/processes.ts` aynası.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export const SERVICE_PROCESS_MAP_QUERY_KEY = ["service-items", "process-map"] as const;

export interface ServiceProcessRow {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  categoryActive: boolean;
  serviceItemId: string;
  serviceItemCode: string;
  serviceItemName: string;
}

const BASE = "/api/service-items";

/** Son okunan harita — tablo dışa aktarımı (statik kolon tanımı) ekranda görünenle AYNI metni yazsın diye. */
let lastProcessMap: ServiceProcessRow[] = [];
export const lastServiceProcessMap = (): readonly ServiceProcessRow[] => lastProcessMap;

/** Bütün eşlemeler — Hizmet Kartları ve Fason Kategorileri listeleri aynı tek isteği paylaşır. */
export async function getServiceProcessMap(): Promise<ServiceProcessRow[]> {
  lastProcessMap = (await apiClient.get<ApiResponse<ServiceProcessRow[]>>(`${BASE}/process-map`)).data.data ?? [];
  return lastProcessMap;
}

/** Kartın süreç türü kümesini değiştirir (boş dizi = eşlemeyi kaldır). 409 `SERVICE_PROCESS_TAKEN` toast'ı apiClient'ta. */
export async function putServiceItemProcesses(serviceItemId: string, categoryIds: string[]): Promise<{ rows: ServiceProcessRow[]; changed: boolean }> {
  const res = await apiClient.put<ApiResponse<ServiceProcessRow[]> & { changed?: boolean }>(`${BASE}/${serviceItemId}/processes`, { categoryIds });
  return { rows: res.data.data ?? [], changed: res.data.changed ?? true };
}

/** Kartın eşlemeleri (haritadan; ayrı istek yok). */
export function processesOf(serviceItemId: string, map: readonly ServiceProcessRow[]): ServiceProcessRow[] {
  return map.filter((r) => r.serviceItemId === serviceItemId);
}

/** Süreç türünün eşlendiği kart (yoksa null). */
export function serviceOfCategory(categoryId: string, map: readonly ServiceProcessRow[]): ServiceProcessRow | null {
  return map.find((r) => r.categoryId === categoryId) ?? null;
}

export interface ProcessOption {
  id: string;
  name: string;
  /** Başka karta eşliyse o kartın adı — seçilemez (önce oradan kaldırılır). */
  takenBy: string | null;
  inactive: boolean;
}

/**
 * Diyalog seçenekleri: aktif türler + (pasif olsa bile) bu karta zaten eşli türler; başka karta eşli tür
 * işaretlenir ve seçilemez — backend aynı durumu 409 ile reddeder, ekran önceden söyler.
 */
export function processOptions(
  serviceItemId: string,
  categories: ReadonlyArray<{ id: string; name: string; isActive: boolean }>,
  map: readonly ServiceProcessRow[],
): ProcessOption[] {
  const byCat = new Map(map.map((r) => [r.categoryId, r]));
  return categories
    .filter((c) => c.isActive || byCat.get(c.id)?.serviceItemId === serviceItemId)
    .map((c) => {
      const owner = byCat.get(c.id);
      return {
        id: c.id,
        name: c.name,
        takenBy: owner && owner.serviceItemId !== serviceItemId ? owner.serviceItemName : null,
        inactive: !c.isActive,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}
