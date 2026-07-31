import { arrayMove } from "@dnd-kit/sortable";
import type { KursunQueueItem } from "./types";

export interface QueueReorderResult {
  /** Ekranda gösterilecek YENİ düz liste (yalnız ilgili istasyon satırları yer değiştirir). */
  next: KursunQueueItem[];
  /** Backend'e gidecek priority payload'ı (acil satırlar HARİÇ; boş olabilir). */
  payload: { id: string; priority: number }[];
}

/**
 * Kuyruk sıralaması İSTASYON GRUBU içinde yapılır: grup içi yeni sıra hesaplanır,
 * düz listede o grubun İŞGAL ETTİĞİ pozisyonlara yazılır — diğer istasyonların
 * satırları yerinde kalır (gruplar backend sırasını korur).
 *
 * `priority` grup içi index'ten üretilir. Acil (isUrgent) satırlar payload'a
 * GİRMEZ: backend onları listenin başına pinler, priority'leri anlamsızdır ve
 * yazılırsa acillik kalkınca satır beklenmedik yere düşer.
 *
 * Taşınamayan durumlar (aynı hücre, gruba ait olmayan id) `null` döner — çağıran
 * hiçbir şey yapmaz.
 */
export function reorderWithinStation(
  items: KursunQueueItem[],
  stationName: string,
  activeId: string,
  overId: string,
): QueueReorderResult | null {
  if (activeId === overId) return null;

  const groupItems = items.filter((i) => i.stationName === stationName);
  const oldIdx = groupItems.findIndex((i) => i.workOrderStepId === activeId);
  const newIdx = groupItems.findIndex((i) => i.workOrderStepId === overId);
  if (oldIdx < 0 || newIdx < 0) return null;

  const nextGroup = arrayMove(groupItems, oldIdx, newIdx);

  let cursor = 0;
  const next = items.map((i) => {
    if (i.stationName !== stationName) return i;
    // `?? i` ulaşılamaz (nextGroup grubun tam kopyası) — yalnız tip kapısı.
    return nextGroup[cursor++] ?? i;
  });

  const payload = nextGroup
    .filter((i) => !i.isUrgent)
    .map((i, idx) => ({ id: i.workOrderStepId, priority: idx * 10 }));

  return { next, payload };
}
