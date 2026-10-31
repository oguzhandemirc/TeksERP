// =============================================================================
// SİPARİŞ ÜRETİM PLANI — satır listesi (SY-K2; tasarım §12.5 madde 3)
// =============================================================================
// Siparişler ekranının "Üretim planı" sekmesi: satır başına plan kolonları + türetilen renk.
// Renk `orderLineProductionState`ten (tek kaynak); istemci hesaplamaz. Liste + cursor + özet şeridi
// AYNI süzülmüş diziden (tek where: `matches`); renk süzgeci SUNUCUDA. Salt okuma.
// =============================================================================
import { OrderStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { decodeDynamicCursor, encodeDynamicCursor } from "../utils/cursor";
import { LINE_RECIPE_SELECT } from "./helpers/line-recipe.helper";
import { DEADLINE_OPEN_ORDER_STATUSES } from "./helpers/order-deadline.helper";
import { LINE_TARGET_VALUES_SELECT } from "./helpers/order-line-target-value.helper";
import {
  ORDER_LINE_PRODUCTION_STATES,
  orderLineProductionState,
  type OrderLineProductionState,
} from "./helpers/order-line-production-state.helper";
import { parseLimit, readQueryList, UUID_RE } from "./ready-works.service";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Plan varsayılanı açık siparişler; kapanmış/iptal yalnız açıkça istenirse (iptal satırı hiç gelmez). */
// Açık durum kümesi termin tek kaynağından (§S bekçisi).
const OPEN_ORDER_STATUSES = DEADLINE_OPEN_ORDER_STATUSES;
const PLAN_ORDER_STATUSES: readonly OrderStatus[] = [...OPEN_ORDER_STATUSES, OrderStatus.COMPLETED];

export interface OrderPlanQuery {
  state?: unknown;
  status?: unknown;
  customerId?: unknown;
  itemId?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

export interface OrderPlanRow {
  lineId: string;
  orderId: string;
  orderNumber: string;
  orderDate: Date;
  deadline: Date | null;
  orderStatus: OrderStatus;
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
  state: OrderLineProductionState;
}

export interface OrderPlanSummary {
  lines: number;
  white: number;
  yellow: number;
  green: number;
  red: number;
  quantity: number;
}

const toNum = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v.toFixed(3)));

function readUuidList(raw: unknown, label: string): string[] {
  const list = readQueryList(raw);
  if (list.some((v) => !UUID_RE.test(v))) throw AppError.badRequest(`${label} kimliği geçersiz`);
  return list;
}

/** Sıralama: sipariş tarihi → sipariş no → satır kimliği (plan görselinin tarih sırası). */
type SortKey = [string, string, string];
const sortKeyOf = (r: OrderPlanRow): SortKey => [r.orderDate.toISOString(), r.orderNumber, r.lineId];
function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function parseCursor(raw: unknown): SortKey | null {
  if (typeof raw !== "string" || !raw) return null;
  const c = decodeDynamicCursor(raw);
  let parsed: unknown = null;
  try { parsed = c?.v ? (JSON.parse(c.v) as unknown) : null; } catch { /* aşağıda 400 */ }
  if (!c || !Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
    throw AppError.badRequest("Geçersiz sayfa imleci");
  }
  return [parsed[0], parsed[1], c.id];
}

const PLAN_LINE_SELECT = {
  id: true, quantity: true, unit: true, shippedQty: true, width: true, unitPrice: true, pieceLengthM: true, cutNote: true,
  order: {
    select: {
      id: true, orderNumber: true, orderDate: true, deadline: true, status: true, currency: true,
      customer: { select: { id: true, name: true, code: true } },
    },
  },
  item: { select: { id: true, code: true, name: true } },
  color: { select: { id: true, name: true } },
  recipe: LINE_RECIPE_SELECT,
  targetValues: LINE_TARGET_VALUES_SELECT,
} satisfies Prisma.OrderLineSelect;

function loadPlanLines(where: Prisma.OrderLineWhereInput) {
  return prisma.orderLine.findMany({ where, select: PLAN_LINE_SELECT });
}

function summarize(rows: readonly OrderPlanRow[]): OrderPlanSummary {
  const summary: OrderPlanSummary = { lines: 0, white: 0, yellow: 0, green: 0, red: 0, quantity: 0 };
  let qty = new Prisma.Decimal(0);
  for (const r of rows) {
    summary.lines++;
    if (r.state === "WHITE") summary.white++;
    else if (r.state === "YELLOW") summary.yellow++;
    else if (r.state === "GREEN") summary.green++;
    else summary.red++;
    qty = qty.plus(r.quantity);
  }
  summary.quantity = Number(qty.toFixed(3));
  return summary;
}

type PlanLine = Awaited<ReturnType<typeof loadPlanLines>>[number];

function toRow(l: PlanLine, state: OrderLineProductionState): OrderPlanRow {
  return {
    lineId: l.id,
    orderId: l.order.id,
    orderNumber: l.order.orderNumber,
    orderDate: l.order.orderDate,
    deadline: l.order.deadline,
    orderStatus: l.order.status,
    currency: l.order.currency,
    customer: l.order.customer,
    item: l.item,
    recipe: l.recipe,
    color: l.color,
    quantity: toNum(l.quantity) ?? 0,
    unit: l.unit,
    shippedQty: toNum(l.shippedQty) ?? 0,
    width: toNum(l.width),
    unitPrice: l.unitPrice === null ? null : Number(l.unitPrice.toFixed(2)),
    pieceLengthM: toNum(l.pieceLengthM),
    cutNote: l.cutNote,
    targetValues: l.targetValues.map((t) => ({ propertyId: t.propertyId, propertyName: t.property.name, valueId: t.valueId, valueName: t.value.name })),
    state,
  };
}

/** Sorgu parametreleri — tanınmayan renk/durum/kimlik FAIL-CLOSED 400. */
function parsePlanQuery(q: OrderPlanQuery) {
  const states = readQueryList(q.state);
  const badState = states.find((s) => !ORDER_LINE_PRODUCTION_STATES.includes(s as OrderLineProductionState));
  if (badState) throw AppError.badRequest(`Renk yalnız ${ORDER_LINE_PRODUCTION_STATES.join(", ")} olabilir`, { code: "ORDER_PLAN_BAD_STATE" });
  const statuses = readQueryList(q.status);
  const badStatus = statuses.find((s) => !PLAN_ORDER_STATUSES.includes(s as OrderStatus));
  if (badStatus) throw AppError.badRequest(`Sipariş durumu yalnız ${PLAN_ORDER_STATUSES.join(", ")} olabilir`, { code: "ORDER_PLAN_BAD_STATUS" });
  const customerIds = readUuidList(q.customerId, "Müşteri");
  const itemIds = readUuidList(q.itemId, "Kumaş");
  const where: Prisma.OrderLineWhereInput = {
    cancelledAt: null,
    order: {
      status: { in: statuses.length > 0 ? (statuses as OrderStatus[]) : [...OPEN_ORDER_STATUSES] },
      ...(customerIds.length > 0 ? { customerId: { in: customerIds } } : {}),
    },
    ...(itemIds.length > 0 ? { itemId: { in: itemIds } } : {}),
  };
  return { states, where, limit: parseLimit(q.limit, DEFAULT_LIMIT, MAX_LIMIT), after: parseCursor(q.cursor) };
}

export async function listOrderPlan(q: OrderPlanQuery): Promise<{ success: true; data: { items: OrderPlanRow[]; nextCursor: string | null; summary: OrderPlanSummary } }> {
  const { states, where, limit, after } = parsePlanQuery(q);
  const lines = await loadPlanLines(where);
  const colors = await orderLineProductionState(lines.map((l) => l.id));
  const rows: OrderPlanRow[] = [];
  for (const l of lines) {
    const state = colors.get(l.id);
    if (state) rows.push(toRow(l, state));
  }
  // TEK WHERE: liste, imleç ve özet şeridi aynı süzülmüş diziden.
  const filtered = rows
    .filter((r) => states.length === 0 || states.includes(r.state))
    .sort((a, b) => compareKeys(sortKeyOf(a), sortKeyOf(b)));
  const summary = summarize(filtered);

  const start = after ? filtered.findIndex((r) => compareKeys(sortKeyOf(r), after) > 0) : 0;
  const page = start < 0 ? [] : filtered.slice(start, start + limit);
  const hasMore = start >= 0 && start + limit < filtered.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeDynamicCursor({ v: JSON.stringify([last.orderDate.toISOString(), last.orderNumber]), id: last.lineId, t: "s" })
    : null;
  return { success: true, data: { items: page, nextCursor, summary } };
}
