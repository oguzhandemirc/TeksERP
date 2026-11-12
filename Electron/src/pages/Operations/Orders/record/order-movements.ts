// Sipariş "son hareketler" — hazır kaynaklardan: sevkiyatlar (BRÜT, tarihli), dokuma işleri (açılış tarihi),
// bağlı iş emirleri (kalem bağından; uç tarih vermez → tarihsiz, sona). Uydurma tarih yok.
import type { IconTileTone } from "@/components/ui/icon-tile";
import { formatMeasure } from "@/lib/format";
import { TERIM } from "@/lib/terim";
import { workOrderStatusLabels } from "@/types/enums";
import { shipmentStatusLabels } from "@/pages/Operations/Shipments/types";
import { WEAVING_STATUS_META, type WeavingOrder } from "@/pages/Operations/WeavingOrders/types";
import type { OrderShipmentRow } from "../service";
import type { OrderLine } from "../types";

export interface OrderMovement {
  key: string;
  kind: string;
  tone: IconTileTone;
  docNo: string;
  sub: string | null;
  amount: string | null;
  at: string | null;
  to: string | null;
  muted?: boolean;
}

export function shipmentRoute(r: Pick<OrderShipmentRow, "shipmentId" | "kind">): string | null {
  if (!r.shipmentId) return null;
  return r.kind === "DIRECT" ? `/operations/shipments/direct/${r.shipmentId}` : `/operations/shipments/${r.shipmentId}`;
}

export function shipmentMovement(r: OrderShipmentRow, i: number, canOpen: boolean): OrderMovement {
  return {
    key: `s-${r.shipmentId || i}`,
    kind: r.kind === "DIRECT" ? "Fason sevk" : "Sevkiyat",
    tone: "blue",
    docNo: r.shipmentNo,
    sub: r.kind === "DIRECT" ? "Fasondan doğrudan" : shipmentStatusLabels[r.status],
    amount: formatMeasure(r.qty, "m"),
    at: r.date,
    to: canOpen ? shipmentRoute(r) : null,
  };
}

export function weavingMovement(w: WeavingOrder): OrderMovement {
  return {
    key: `w-${w.id}`,
    kind: TERIM.dokumaIsEmri.tekil,
    tone: "teal",
    docNo: w.weavingOrderNumber,
    sub: WEAVING_STATUS_META[w.status].label,
    amount: w.plannedM != null ? formatMeasure(w.plannedM, "m") : null,
    at: w.createdAt,
    to: null,
    muted: w.status === "CANCELLED",
  };
}

/** Kalemlerdeki bağlı iş emirleri (tekil). */
export function linkedWorkOrders(lines: OrderLine[] | undefined) {
  const map = new Map<string, NonNullable<OrderLine["workOrderLinks"]>[number]["workOrder"]>();
  for (const l of lines ?? []) for (const link of l.workOrderLinks ?? []) map.set(link.workOrder.id, link.workOrder);
  return [...map.values()];
}

export function workOrderMovements(lines: OrderLine[] | undefined, canOpen: boolean): OrderMovement[] {
  return linkedWorkOrders(lines).map((w) => ({
    key: `wo-${w.id}`,
    kind: TERIM.terbiyeIsEmri.tekil,
    tone: "violet",
    docNo: w.workOrderNumber,
    sub: workOrderStatusLabels[w.status],
    amount: null,
    at: null,
    to: canOpen ? `/operations/work-orders/${w.id}` : null,
    muted: w.status === "CANCELLED",
  }));
}

/** En yeni önce; tarihsizler sonda (sıraları korunur). */
export function mergeOrderMovements(groups: OrderMovement[][], limit: number): OrderMovement[] {
  const all = groups.flat();
  const dated = all.filter((m) => m.at).sort((a, b) => (a.at! < b.at! ? 1 : a.at! > b.at! ? -1 : a.key.localeCompare(b.key)));
  return [...dated, ...all.filter((m) => !m.at)].slice(0, limit);
}
