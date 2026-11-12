// Sipariş planı sütunları (ortak DataTable) — fabrikanın plan görselinin sırası. Renk SUNUCUDAN; burada yalnız görünüm.
import type { ColumnDef } from "@tanstack/react-table";
import { fmtCalendarDay, fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { PLAN_STATE_LABEL, type OrderPlanRow, type OrderPlanState } from "./orderPlanService";
import { formatQty } from "@/lib/format";

export const DOT_CLASS: Record<OrderPlanState, string> = {
  WHITE: "border border-muted-foreground/50 bg-background",
  YELLOW: "bg-amber-400",
  GREEN: "bg-emerald-500",
  RED: "bg-red-500",
};

/** Binlik ayırıcısız (liste standardı), en çok `digits` ondalık. */
export const n = (v: number | null, digits = 1) => (v === null ? "—" : formatQty(v, digits));
const right = (label: string) => ({ label, align: "right" as const });
const qtyText = (r: OrderPlanRow) => `${n(r.quantity)} ${r.unit === "MT" ? "" : r.unit}`.trim();
const priceText = (r: OrderPlanRow) => (r.unitPrice === null ? "—" : `${n(r.unitPrice, 2)} ${r.currency}`);
const beltText = (r: OrderPlanRow) => (r.targetValues.length > 0 ? r.targetValues.map((t) => t.valueName).join(", ") : "—");

const PLAN_COLUMNS: ColumnDef<OrderPlanRow>[] = [
  {
    id: "state",
    header: "",
    size: 36,
    meta: { label: "Renk", exportValue: (r) => PLAN_STATE_LABEL[r.state] },
    accessorFn: (r) => r.state,
    cell: ({ row: { original: r } }) => (
      <span title={PLAN_STATE_LABEL[r.state]} className={cn("inline-block h-2.5 w-2.5 rounded-full", DOT_CLASS[r.state])} aria-label={PLAN_STATE_LABEL[r.state]} />
    ),
  },
  { id: "orderDate", header: "Tarih", meta: { label: "Tarih", exportValue: (r) => fmtFactoryDate(r.orderDate) }, accessorFn: (r) => r.orderDate, cell: ({ row }) => fmtFactoryDate(row.original.orderDate) },
  { id: "deadline", header: "Termin", meta: { label: "Termin", exportValue: (r) => fmtCalendarDay(r.deadline) }, accessorFn: (r) => r.deadline, cell: ({ row }) => fmtCalendarDay(row.original.deadline) },
  {
    id: "item",
    header: "Desen",
    meta: { label: "Desen", exportValue: (r) => `${r.item.code} ${r.item.name}` },
    accessorFn: (r) => r.item.code,
    cell: ({ row: { original: r } }) => <span>{r.item.code} <span className="text-muted-foreground">{r.item.name}</span></span>,
  },
  { id: "variant", header: "Varyant", meta: { label: "Varyant" }, accessorFn: (r) => (r.recipe ? (r.recipe.variantCode ?? r.recipe.code) : "—") },
  { id: "quantity", header: "Metre", meta: { ...right("Metre"), exportValue: qtyText }, accessorFn: (r) => r.quantity, cell: ({ row }) => qtyText(row.original) },
  { id: "width", header: "En", meta: { ...right("En"), exportValue: (r) => n(r.width) }, accessorFn: (r) => r.width, cell: ({ row }) => n(row.original.width) },
  { id: "customer", header: "Müşteri", meta: { label: "Müşteri" }, accessorFn: (r) => r.customer.code ?? r.customer.name },
];

const TAIL_COLUMNS: ColumnDef<OrderPlanRow>[] = [
  { id: "belt", header: "Kuşak", meta: { label: "Kuşak" }, accessorFn: beltText },
  { id: "pieceLength", header: "Top boyu", meta: { ...right("Top boyu"), exportValue: (r) => n(r.pieceLengthM) }, accessorFn: (r) => r.pieceLengthM, cell: ({ row }) => n(row.original.pieceLengthM) },
  { id: "cutNote", header: "Not", size: 240, meta: { label: "Not" }, accessorFn: (r) => r.cutNote ?? "—", cell: ({ row: { original: r } }) => <span title={r.cutNote ?? undefined}>{r.cutNote ?? "—"}</span> },
  { id: "orderNumber", header: "Sipariş", meta: { label: "Sipariş" }, accessorFn: (r) => r.orderNumber, cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNumber}</span> },
];

const PRICE_COLUMN: ColumnDef<OrderPlanRow> = {
  id: "unitPrice",
  header: "Fiyat",
  meta: { ...right("Fiyat"), exportValue: priceText },
  accessorFn: (r) => r.unitPrice,
  cell: ({ row }) => priceText(row.original),
};

export function orderPlanColumns(pricingEnabled: boolean): ColumnDef<OrderPlanRow>[] {
  return [...PLAN_COLUMNS, ...(pricingEnabled ? [PRICE_COLUMN] : []), ...TAIL_COLUMNS];
}
