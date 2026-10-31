// SY-K2 — Siparişler › Üretim planı ucu (`GET /api/orders/plan-lines`). Renk SUNUCUDAN gelir;
// istemci renk hesaplamaz. Renk süzgeci query'de kalır (liste, imleç ve özet aynı süzgeçten).
import apiClient from "@/services/apiClient";

export type OrderPlanState = "WHITE" | "YELLOW" | "GREEN" | "RED";
export const ORDER_PLAN_STATES: readonly OrderPlanState[] = ["WHITE", "YELLOW", "GREEN", "RED"];

export const PLAN_STATE_LABEL: Record<OrderPlanState, string> = {
  WHITE: "İş açılmadı",
  YELLOW: "Üretimde",
  GREEN: "Sevke hazır",
  RED: "Termin geçti",
};

export interface OrderPlanRow {
  lineId: string;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  deadline: string | null;
  orderStatus: string;
  currency: string;
  customer: { id: string; name: string; code: string | null };
  item: { id: string; code: string; name: string };
  recipe: { id: string; code: string; name: string; variantCode: string | null } | null;
  color: { id: string; name: string } | null;
  quantity: number;
  unit: string;
  shippedQty: number;
  width: number | null;
  unitPrice: number | null;
  pieceLengthM: number | null;
  cutNote: string | null;
  targetValues: Array<{ propertyId: string; propertyName: string; valueId: string; valueName: string }>;
  state: OrderPlanState;
}

export interface OrderPlanSummary {
  lines: number;
  white: number;
  yellow: number;
  green: number;
  red: number;
  quantity: number;
}

export interface OrderPlanPage {
  items: OrderPlanRow[];
  nextCursor: string | null;
  summary: OrderPlanSummary;
}

export interface OrderPlanParams {
  states: readonly string[];
  customerIds?: readonly string[];
  cursor?: string | null;
  limit?: number;
}

/** URL'deki `planState` CSV'sinden tanınan renkler (tanınmayan düşer; sunucu yine 400 verir). */
export function parsePlanStates(raw: string | null): OrderPlanState[] {
  if (!raw) return [];
  return raw.split(",").filter((s): s is OrderPlanState => (ORDER_PLAN_STATES as readonly string[]).includes(s));
}

export function orderPlanQueryString(p: OrderPlanParams): string {
  const q = new URLSearchParams();
  if (p.states.length > 0) q.set("state", p.states.join(","));
  if (p.customerIds && p.customerIds.length > 0) q.set("customerId", p.customerIds.join(","));
  if (p.cursor) q.set("cursor", p.cursor);
  if (p.limit) q.set("limit", String(p.limit));
  return q.toString();
}

export async function getOrderPlan(p: OrderPlanParams): Promise<OrderPlanPage> {
  const r = await apiClient.get<{ success: boolean; data: OrderPlanPage }>(`/api/orders/plan-lines?${orderPlanQueryString(p)}`);
  return r.data.data;
}
