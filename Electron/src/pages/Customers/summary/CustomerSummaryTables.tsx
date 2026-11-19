import { formatNumber, safeFormat } from "@/lib/format";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { lineLabelsText, orderMetreText } from "@/pages/Operations/Orders/order-cell-text";
import { orderShipView } from "@/pages/Operations/Orders/order-where-text";
import type { Order } from "@/pages/Operations/Orders/types";
import type { OpenOrder, OpenOrderLine } from "@/pages/Operations/SackContentEdit/types";
import type { ShipmentListItem } from "@/pages/Operations/Shipments/types";
import type { ReturnRow } from "@/pages/Operations/Returns/service";
import { SummaryTable, type Column } from "./SummarySection";

// Hücre metinleri liste ekranlarının yardımcılarından (sevk cümlesi, metre ilerlemesi) —
// özet kendi sevk/metre hesabını YAZMAZ. Sevk metresi BRÜT; iade ayrı sütun/bölüm.

const num = (n: number | string | null | undefined, d = 1) => formatNumber(n, d);
const day = (iso: string | null | undefined) => safeFormat(iso, "dd.MM.yyyy");
/** Uzun metin tek satırda kalsın; tamamı fare üstünde. */
const Clip = ({ text, w = "max-w-[180px]" }: { text: string; w?: string }) => (
  <span className={`block truncate ${w}`} title={text}>
    {text || "—"}
  </span>
);

function ShipCell({ o }: { o: Order }) {
  const v = orderShipView(o);
  return <StatusBadge status={o.status} labels={{ [o.status]: v.text }} tones={{ [o.status]: v.tone }} />;
}

const ORDER_COLS: Column<Order>[] = [
  { header: "Sipariş no", render: (o) => <span className="font-mono">{o.orderNumber}</span> },
  { header: "Tarih", render: (o) => day(o.orderDate) },
  { header: "Şube", render: (o) => <Clip text={o.branch?.name ?? ""} w="max-w-[120px]" /> },
  { header: "Kumaş", render: (o) => <Clip text={lineLabelsText(o.lines, "item")} />, className: "w-full" },
  { header: "Metre", render: (o) => orderMetreText(o), align: "right" },
  { header: "Sevk durumu", render: (o) => <ShipCell o={o} /> },
];

export function RecentOrdersTable({ rows }: { rows: Order[] }) {
  return <SummaryTable rows={rows} columns={ORDER_COLS} rowKey={(o) => o.id} />;
}

type OpenLineRow = { order: OpenOrder["order"]; line: OpenOrderLine };

const OPEN_COLS: Column<OpenLineRow>[] = [
  { header: "Sipariş no", render: (r) => <span className="font-mono">{r.order.orderNumber}</span> },
  { header: "Şube", render: (r) => <Clip text={r.order.branch?.name ?? ""} w="max-w-[120px]" /> },
  { header: "Kumaş", render: (r) => <Clip text={r.line.item.name} />, className: "w-full" },
  { header: "Renk", render: (r) => <Clip text={r.line.color?.name ?? ""} w="max-w-[120px]" /> },
  { header: "En", render: (r) => (r.line.width == null ? "—" : num(r.line.width, 0)), align: "right" },
  { header: "İstenen", render: (r) => num(r.line.requested), align: "right" },
  { header: "Sevk", render: (r) => num(r.line.shipped), align: "right" },
  { header: "Açık", render: (r) => <span className="font-medium">{num(r.line.openQty)}</span>, align: "right" },
];

/** En çok bu kadar kalem satırı çizilir; fazlası "Tümünü gör"de. */
export const OPEN_LINE_CAP = 15;

export function OpenOrdersTable({ orders }: { orders: OpenOrder[] }) {
  const all = orders.flatMap((o) => o.lines.map((line) => ({ order: o.order, line })));
  const shown = all.slice(0, OPEN_LINE_CAP);
  return (
    <>
      <SummaryTable rows={shown} columns={OPEN_COLS} rowKey={(r) => r.line.lineId} />
      {all.length > shown.length && <p className="text-[11px] text-muted-foreground">+{all.length - shown.length} kalem daha</p>}
    </>
  );
}

const SHIP_COLS: Column<ShipmentListItem>[] = [
  { header: "Sevk no", render: (s) => <span className="font-mono">{s.shipmentNo}</span> },
  { header: "Sevk tarihi", render: (s) => day(s.dispatchedAt) },
  { header: "Şube", render: (s) => <Clip text={s.branch?.name ?? ""} />, className: "w-full" },
  { header: "Top", render: (s) => num(s._count.rolls, 0), align: "right" },
  { header: "Metre (brüt)", render: (s) => num(s.totalMeters), align: "right" },
  { header: "Kg", render: (s) => (s.kind === "DIRECT" ? "—" : num(s.totalKg)), align: "right" },
  { header: "İade", render: (s) => (s._count.returns > 0 ? `${s._count.returns} top` : "—"), align: "right" },
];

export function ShipmentsTable({ rows }: { rows: ShipmentListItem[] }) {
  return <SummaryTable rows={rows} columns={SHIP_COLS} rowKey={(s) => `${s.kind}:${s.id}`} />;
}

const RETURN_COLS: Column<ReturnRow>[] = [
  { header: "İade no", render: (r) => <span className="font-mono">{r.returnNo ?? "—"}</span> },
  { header: "Tarih", render: (r) => day(r.createdAt) },
  { header: "Sevk no", render: (r) => <span className="font-mono">{r.fromShipment?.shipmentNo ?? "—"}</span> },
  { header: "Kumaş", render: (r) => <Clip text={r.item?.name ?? ""} />, className: "w-full" },
  { header: "Renk", render: (r) => <Clip text={r.color?.name ?? ""} w="max-w-[120px]" /> },
  { header: "Metre", render: (r) => num(r.qty), align: "right" },
  { header: "Neden", render: (r) => <Clip text={r.reason?.name ?? r.reasonText ?? ""} w="max-w-[140px]" /> },
];

export function ReturnsTable({ rows }: { rows: ReturnRow[] }) {
  return <SummaryTable rows={rows} columns={RETURN_COLS} rowKey={(r) => r.id} />;
}
