// =============================================================================
// KART FİKSTÜRÜ — ürün kartı (`items`) ↔ hizmet kartı (`service_items`) ayrımı (D1a)
// =============================================================================
// Bekçiler eskiden hizmeti `items`'ta `itemType: SERVICE` ile açıyordu; artık `items_no_service_ck`
// bunu reddeder. Tür parametreli fikstür yardımcıları buradan açar: SERVICE → `service_items`
// (aynı kod/ad/birim/durum), diğerleri → `items`. Temizlik iki tabloyu birlikte siler.
// =============================================================================
import type { ItemLifecycleStatus, ItemType, ItemUnit } from "@prisma/client";
import prisma from "../../src/lib/prisma";

export interface KartVerisi {
  code: string;
  name: string;
  itemType: ItemType | "SERVICE" | "FABRIC" | "YARN" | "CONSUMABLE";
  unit?: ItemUnit;
  isActive?: boolean;
  lifecycleStatus?: ItemLifecycleStatus;
}

/** Türüne göre doğru tabloda kart açar; dönen `{ id }`. */
export async function kartAc(data: KartVerisi): Promise<{ id: string }> {
  const { itemType, ...ortak } = data;
  if (itemType === "SERVICE") return prisma.serviceItem.create({ data: ortak, select: { id: true } });
  return prisma.item.create({ data: { ...ortak, itemType: itemType as ItemType }, select: { id: true } });
}

/** Fikstür temizliği: id kümesi iki tabloda da silinir (hangisinde olduğu bilinmeden). */
export async function kartlariSil(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.item.deleteMany({ where: { id: { in: ids } } });
  await prisma.serviceItem.deleteMany({ where: { id: { in: ids } } });
}

/** Fiyat satırı temizliği: konu ürün ya da hizmet kartı. */
export function fiyatKonusuWhere(ids: string[]) {
  return { OR: [{ itemId: { in: ids } }, { serviceItemId: { in: ids } }] };
}
