import type { Tone } from "@/components/operations/StatusBadge";
import { deriveWoRollup } from "./work-order-rollup";
import type { Order } from "./types";

/**
 * "Genel durum" — siparişin sevk durumu + bağlı iş emirlerinden TEK cümle.
 * Liste hücresi ve Excel aynı fonksiyondan okur (ekran ≠ dosya ayrışmasın).
 * Sıra: iptal → tamamlandı → kısmi sevk → üretim (aktif İE = iptal/yerine-geçilmiş hariç).
 */
export type OrderOverallState =
  | "CANCELLED"
  | "COMPLETED"
  | "PARTIAL_SHIPPED"
  | "IN_PRODUCTION"
  | "PRODUCED_AWAITING_SHIPMENT"
  | "NO_WORK_ORDER";

export function deriveOrderOverallState(order: Pick<Order, "status" | "lines">): OrderOverallState {
  if (order.status === "CANCELLED") return "CANCELLED";
  if (order.status === "COMPLETED") return "COMPLETED";
  if (order.status === "PARTIAL_SHIPPED") return "PARTIAL_SHIPPED";
  const { state } = deriveWoRollup(order.lines);
  if (state === "NONE") return "NO_WORK_ORDER";
  return state === "COMPLETED" ? "PRODUCED_AWAITING_SHIPMENT" : "IN_PRODUCTION";
}

export const orderOverallLabels: Record<OrderOverallState, string> = {
  CANCELLED: "İptal",
  COMPLETED: "Tamamlandı",
  PARTIAL_SHIPPED: "Kısmi sevk",
  IN_PRODUCTION: "Üretimde",
  PRODUCED_AWAITING_SHIPMENT: "Üretim bitti, sevk bekliyor",
  NO_WORK_ORDER: "İş emri yok",
};

export const orderOverallTones: Record<OrderOverallState, Tone> = {
  CANCELLED: "muted",
  COMPLETED: "success",
  PARTIAL_SHIPPED: "progress",
  IN_PRODUCTION: "info",
  PRODUCED_AWAITING_SHIPMENT: "warning",
  NO_WORK_ORDER: "neutral",
};

/** Hücre + Excel metni. */
export function orderOverallStatusText(order: Pick<Order, "status" | "lines">): string {
  return orderOverallLabels[deriveOrderOverallState(order)];
}
