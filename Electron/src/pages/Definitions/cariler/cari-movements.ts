// Cari hareketleri — kaynak satırlarını tek biçime çeviren SAF eşleyiciler + birleştirme (zaman azalan).
// Sevk metresi BRÜT (liste alanı `totalMeters` zaten brüttür); para birimleri toplanmaz, satır kendi biriminde.
import { formatMeasure } from "@/lib/format";
import { orderStatusLabels } from "@/types/enums";
import { money } from "@/pages/Finance/service";
import { shipmentStatusLabels, type ShipmentListItem } from "@/pages/Operations/Shipments/types";
import type { Order } from "@/pages/Operations/Orders/types";
import { orderPath, shipmentPath, type CariMovement, type FasonDispatchRow, type PaymentRow } from "./cari-sources";

export const metre = (v: number | string | null | undefined): string | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return n == null || !Number.isFinite(n) ? null : formatMeasure(n, "m", 0);
};

const PAYMENT_METHOD: Record<PaymentRow["method"], string> = { CASH: "Nakit", BANK_TRANSFER: "Havale/EFT", CREDIT_CARD: "Kredi kartı", OTHER: "Diğer" };

export function orderMovement(o: Order): CariMovement {
  const qty = (o.lines ?? []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  return {
    key: `order:${o.id}`,
    kind: "Sipariş",
    tone: "blue",
    docNo: o.orderNumber,
    sub: orderStatusLabels[o.status] ?? null,
    amount: qty > 0 ? metre(qty) : null,
    at: o.createdAt,
    to: orderPath(o.id),
    muted: o.status === "CANCELLED",
  };
}

export function shipmentMovement(s: ShipmentListItem): CariMovement {
  return {
    key: `shipment:${s.kind}:${s.id}`,
    kind: s.kind === "DIRECT" ? "Doğrudan sevk" : "Sevk",
    tone: s.kind === "DIRECT" ? "teal" : "green",
    docNo: s.shipmentNo,
    sub: shipmentStatusLabels[s.status] ?? null,
    amount: metre(s.totalMeters),
    at: s.createdAt,
    to: shipmentPath(s),
    muted: s.status === "CANCELLED",
  };
}

export function paymentMovement(p: PaymentRow): CariMovement {
  return {
    key: `payment:${p.id}`,
    kind: p.direction === "IN" ? "Tahsilat" : "Ödeme",
    tone: p.direction === "IN" ? "violet" : "orange",
    docNo: p.docNo,
    sub: p.reference || PAYMENT_METHOD[p.method] || null,
    amount: money(p.amount, p.currency),
    at: p.paymentDate,
    to: null,
    muted: p.status === "CANCELLED",
  };
}

export function fasonMovement(d: FasonDispatchRow): CariMovement {
  return {
    key: `fason:${d.id}`,
    kind: "Fasona giden",
    tone: "amber",
    docNo: d.dispatchNo,
    sub: d.workOrder?.workOrderNumber ?? null,
    amount: metre(d.totalQty),
    at: d.dispatchedAt,
    to: null,
    muted: Boolean(d.cancelledAt),
  };
}

/** Zamana göre azalan; eşitlikte anahtar (belirlenimli sıra). */
export function mergeMovements(lists: CariMovement[][], limit: number): CariMovement[] {
  return lists
    .flat()
    .sort((a, b) => (a.at === b.at ? a.key.localeCompare(b.key) : a.at < b.at ? 1 : -1))
    .slice(0, limit);
}
