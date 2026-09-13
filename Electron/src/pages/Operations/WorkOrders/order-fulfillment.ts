import { isMeasuredUnit } from "@/lib/item-unit";
import type { WorkOrder } from "./types";

type OrderLink = NonNullable<WorkOrder["orderLinks"]>[number];

/**
 * Bir sipariş kaleminin açık (eksik sevk) metresi. Negatif clamp (aşım = 0).
 * Üretim hassasiyeti 1 ondalık ([[feedback_one_decimal_precision]]) — ham fark
 * döner; sıfır kararı için isEffectivelyZero kullan.
 */
export function lineOpen(quantity: number, shippedQty: number): number {
  return Math.max(0, quantity - shippedQty);
}

/**
 * Açık metraj, ÖLÇÜLEBİLİYORSA. KG/ADET satırın karşılaması metre defterinden
 * ölçülmez → `null` ("ölçülmüyor"); metreye DÜŞÜLMEZ. `unit` yoksa (eski backend)
 * metre sayılır — backend `isMeasuredLine` ikizi.
 */
export function lineOpenMeasured(line: {
  quantity: number | string;
  shippedQty?: number | string | null;
  unit?: string | null;
}): number | null {
  if (!isMeasuredUnit(line.unit)) return null;
  return lineOpen(Number(line.quantity), Number(line.shippedQty ?? 0));
}

/** 1 ondalığa yuvarlandığında sıfır mı (üretimde <0.05 m = 10cm altı ihmal). */
export function isEffectivelyZero(value: number): boolean {
  return value < 0.05;
}

export interface LinkedFulfillment {
  requested: number;
  shipped: number;
  open: number;
}

/**
 * WO'ya bağlı sipariş kalemlerinin karşılanma özeti (rollup).
 * - İPTAL siparişlerin kalemleri HARİÇ (ölü talep aksiyon doğurmasın).
 * - Her orderLineId bir kez (distinct) — aynı kalem birden çok linkte sayılmaz.
 * - shippedQty kalemin TOPLAM sevkidir (spec havuzu); WO'ya atfedilmez.
 */
export function summarizeLinkedFulfillment(orderLinks: OrderLink[]): LinkedFulfillment {
  let requested = 0;
  let shipped = 0;
  const seen = new Set<string>();
  for (const link of orderLinks) {
    if (seen.has(link.orderLineId)) continue;
    seen.add(link.orderLineId);
    const ol = link.orderLine;
    if (!ol) continue;
    if (ol.order?.status === "CANCELLED") continue;
    requested += Number(ol.quantity ?? 0);
    shipped += Number(ol.shippedQty ?? 0);
  }
  return { requested, shipped, open: Math.max(0, requested - shipped) };
}
