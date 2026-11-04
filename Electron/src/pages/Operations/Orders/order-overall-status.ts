// "Genel durum" — sevk durumu (OrderStatus) ile üretim rollup'ını TEK etikette birleştirir.
// Saha (2026-11-04): "Durum" sevki, "İş Emri" üretimi gösterdiği için Excel'de "bitenleri"
// süzmek zordu. Ekran hücresi ve Excel AYNI fonksiyondan okur (order-cell-text deseni).
import type { Tone } from "@/components/operations/StatusBadge";
import { TERIM } from "@/lib/terim";
import { deriveWoRollup } from "./work-order-rollup";
import type { Order } from "./types";

export type OrderOverallState =
  | "CANCELLED"
  | "COMPLETED"
  | "PARTIAL_SHIPPED"
  | "IN_PRODUCTION"
  | "PRODUCED_AWAITING_SHIPMENT"
  | "NO_WORK_ORDER";

/**
 * Öncelik: sipariş statüsü (iptal · tamam · kısmi sevk) → üretim rollup'ı.
 * Aktif iş emri kümesi `deriveWoRollup` ile AYNI (CANCELLED + SUPERSEDED hariç):
 * hiç yok → NO_WORK_ORDER; hepsi COMPLETED → PRODUCED_AWAITING_SHIPMENT; diğer → IN_PRODUCTION.
 */
export function deriveOrderOverallState(order: Pick<Order, "status" | "lines">): OrderOverallState {
  if (order.status === "CANCELLED") return "CANCELLED";
  if (order.status === "COMPLETED") return "COMPLETED";
  if (order.status === "PARTIAL_SHIPPED") return "PARTIAL_SHIPPED";
  const { state } = deriveWoRollup(order.lines);
  if (state === "NONE") return "NO_WORK_ORDER";
  if (state === "COMPLETED") return "PRODUCED_AWAITING_SHIPMENT";
  return "IN_PRODUCTION";
}

/** Etiketler okuma anında çözülür — TERIM rejime göre değişir, modül düzeyinde dondurulmaz. */
export function orderOverallLabels(): Record<OrderOverallState, string> {
  return {
    CANCELLED: "İptal",
    COMPLETED: "Tamamlandı",
    PARTIAL_SHIPPED: "Kısmi sevk",
    IN_PRODUCTION: "Üretimde",
    PRODUCED_AWAITING_SHIPMENT: "Üretim bitti, sevk bekliyor",
    NO_WORK_ORDER: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} yok`,
  };
}

export const orderOverallTones: Record<OrderOverallState, Tone> = {
  CANCELLED: "muted",
  COMPLETED: "success",
  PARTIAL_SHIPPED: "progress",
  IN_PRODUCTION: "info",
  PRODUCED_AWAITING_SHIPMENT: "warning",
  NO_WORK_ORDER: "neutral",
};

/** Ekran ve Excel'in ortak metni. */
export function orderOverallText(order: Pick<Order, "status" | "lines">): string {
  return orderOverallLabels()[deriveOrderOverallState(order)];
}
