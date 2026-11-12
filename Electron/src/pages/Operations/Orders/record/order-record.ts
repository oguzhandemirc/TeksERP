// Sipariş kayıt kalıbı — saf yardımcılar: yollar, durum çipi, metre rakamları, kalem özeti.
// Rakamlar mevcut tek kaynaktan (`orderMetreProgress`, `orderShipView`); yeni hesap yok.
import type { IconTileTone } from "@/components/ui/icon-tile";
import { isMeasuredUnit, unitLabel } from "@/lib/item-unit";
import { orderMetreProgress } from "../order-cell-text";
import { orderShipView } from "../order-where-text";
import type { Order, OrderLine } from "../types";

export const ORDER_LIST_PATH = "/operations/orders";
export const ORDER_SELECTED_PARAM = "kayit";
export const ORDER_TAB_PARAM = "sekme";
export const orderRecordPath = (id: string) => `${ORDER_LIST_PATH}/${id}`;

type ShipOrder = Pick<Order, "status" | "shippedQty" | "manualClosedById" | "lines">;

const VIEW_TONE: Record<ReturnType<typeof orderShipView>["tone"], IconTileTone> = {
  warning: "amber",
  info: "blue",
  progress: "violet",
  success: "green",
  muted: "teal",
  neutral: "sky",
  danger: "rose",
};

/** Durum çipi — listedeki "Sevk durumu" ile aynı sözcük, miktar parantezi atılmış (rakamlar kartlarda). */
export function orderStatusChip(order: ShipOrder): { label: string; tone: IconTileTone } {
  const view = orderShipView(order);
  const label = view.text.replace(/\s*\(.*\)$/, "");
  return { label, tone: order.status === "CANCELLED" ? "rose" : VIEW_TONE[view.tone] };
}

export interface OrderMetreFigures {
  requested: number;
  shipped: number;
  remaining: number;
  pct: number;
}

/** İstenen / sevk (BRÜT) / kalan metre — ölçülü kalemi yoksa null (kart çizilmez). */
export function orderMetreFigures(order: Pick<Order, "shippedQty" | "lines">): OrderMetreFigures | null {
  const p = orderMetreProgress(order);
  if (!p) return null;
  return { ...p, remaining: Math.max(0, p.requested - p.shipped) };
}

export interface OrderLineBrief {
  key: string;
  item: string;
  color: string | null;
  hex: string | null;
  qty: number;
  unit: string;
  measured: boolean;
}

/** Aktif kalemler (iptal edilen girmez) — yan panel özeti. */
export function activeLineBriefs(lines: OrderLine[] | undefined): OrderLineBrief[] {
  return (lines ?? [])
    .filter((l) => l.cancelledAt == null)
    .map((l) => ({
      key: l.id,
      item: l.item?.name ?? "—",
      color: l.color?.name ?? null,
      hex: l.color?.hex ?? null,
      qty: Number(l.quantity) || 0,
      unit: unitLabel(l.unit),
      measured: isMeasuredUnit(l.unit),
    }));
}

/** Kalemde düzenlenebilir mi (sheet ile aynı kural). */
export const isOrderEditable = (o: Pick<Order, "status">) => o.status === "APPROVED" || o.status === "PARTIAL_SHIPPED";
export const isOrderCancellable = (o: Pick<Order, "status">) => o.status !== "COMPLETED" && o.status !== "CANCELLED";
export const isOrderClosable = (o: Pick<Order, "status">) => o.status === "PENDING" || isOrderEditable(o);

/** Satır tutarı (birim fiyat × miktar) — fiyat yoksa null. Sipariş toplamı sunucudan (`totalAmount`). */
export function lineAmount(l: Pick<OrderLine, "unitPrice" | "quantity">): number | null {
  if (l.unitPrice == null || l.unitPrice === "") return null;
  const n = Number(l.unitPrice) * Number(l.quantity);
  return Number.isFinite(n) ? n : null;
}
