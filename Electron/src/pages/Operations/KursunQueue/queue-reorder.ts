import { arrayMove } from "@dnd-kit/sortable";
import type { KursunQueueItem } from "./types";

export interface QueueReorderResult {
  /** Ekranda gösterilecek YENİ liste (iyimser güncelleme). */
  next: KursunQueueItem[];
  /** Backend'e gidecek priority payload'ı (acil satırlar HARİÇ; boş olabilir). */
  payload: { id: string; priority: number }[];
}

/**
 * Kuyruk DÜZ bir listedir — kurşun tek istasyondur, gruplama YOKTUR. Sürüklenen
 * satır yeni yerine taşınır, `priority` liste index'inden üretilir.
 *
 * Acil (isUrgent) satırlar payload'a GİRMEZ: backend onları listenin başına
 * pinler, priority'leri anlamsızdır ve yazılırsa acillik kalkınca satır
 * beklenmedik bir yere düşer.
 *
 * Taşınamayan durumlar (aynı hücre, listede olmayan id) `null` döner — çağıran
 * hiçbir şey yapmaz.
 */
export function reorderQueue(
  items: KursunQueueItem[],
  activeId: string,
  overId: string,
): QueueReorderResult | null {
  if (activeId === overId) return null;

  const oldIdx = items.findIndex((i) => i.workOrderStepId === activeId);
  const newIdx = items.findIndex((i) => i.workOrderStepId === overId);
  if (oldIdx < 0 || newIdx < 0) return null;

  const next = arrayMove(items, oldIdx, newIdx);
  const payload = next
    .filter((i) => !i.isUrgent)
    .map((i, idx) => ({ id: i.workOrderStepId, priority: idx * 10 }));

  return { next, payload };
}
