// Kalemden iş emri seçimi — tek iş emri = tek kumaş + renk + en. Sheet ve kayıt sayfası Kalemler sekmesi AYNI kuralı okur.
import { lineOpenMeasured } from "@/pages/Operations/WorkOrders/order-fulfillment";
import type { OrderLine } from "./types";

/** Kalem imzası (kumaş + renk + en). */
export const lineSig = (l: OrderLine) => `${l.itemId}::${l.colorId ?? ""}::${l.width ?? ""}`;
/**
 * Açık (sevk edilmemiş) metre — 0 ise kalem iş emrine alınamaz. Formül tek yerde (`lineOpenMeasured`; KG/ADET → null:
 * satır yine iş emrine alınabilir, metreye düşülmez). İptal edilmiş kalemin AÇIĞI YOKTUR (2026-08-27).
 */
export const lineRem = (l: OrderLine): number | null => (l.cancelledAt != null ? 0 : lineOpenMeasured(l));
/** Çapaya göre hangi nitelikler farklı — "neden seçilemez" metni. */
export const diffLabel = (anchor: OrderLine, line: OrderLine) => {
  const parts: string[] = [];
  if (anchor.itemId !== line.itemId) parts.push("kumaş");
  if ((anchor.colorId ?? "") !== (line.colorId ?? "")) parts.push("renk");
  if ((anchor.width ?? "") !== (line.width ?? "")) parts.push("en");
  return parts.length ? `Farklı ${parts.join(" + ")}` : "Farklı spec";
};
