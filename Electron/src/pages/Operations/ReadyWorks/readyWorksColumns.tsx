// Sevke Hazır İşler — tablo sütunları (ortak DataTable). İlk sütunun başlığı seçili gruplamanın adıdır.
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { CariHoldBadge } from "@/pages/Finance/CariHold/CariHoldBadge";
import type { ReadyWorkRow } from "./service";
import { ProgressCell } from "./ReadyWorksTable";
import { readinessPercent, STATE_LABEL } from "./ready-works-view";

const fmtM = (m: number) => `${formatNumber(m, 1)} m`;
const countText = (n: number, m: number) => `${n} top · ${fmtM(m)}`;
const right = (label: string) => ({ label, align: "right" as const });

const REST_COLUMNS: ColumnDef<ReadyWorkRow>[] = [
  {
    id: "customer",
    header: "Müşteri",
    meta: { label: "Müşteri" },
    accessorFn: (r) => r.customerName ?? "—",
    cell: ({ row: { original: r } }) => (
      <span>
        {r.customerName ?? "—"}
        <CariHoldBadge view={r.customerHold} />
      </span>
    ),
  },
  {
    id: "state",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => STATE_LABEL[r.state] },
    accessorFn: (r) => r.state,
    cell: ({ row: { original: r } }) => (
      <Badge variant={r.state === "READY" ? "default" : r.state === "PARTIAL" ? "secondary" : "muted"} className="whitespace-nowrap">
        {STATE_LABEL[r.state]}
      </Badge>
    ),
  },
  { id: "progress", header: "İlerleme", size: 160, meta: { label: "İlerleme", exportValue: (r) => `%${readinessPercent(r)}` }, accessorFn: readinessPercent, cell: ({ row }) => <ProgressCell row={row.original} /> },
  { id: "ready", header: "Hazır", meta: { ...right("Hazır"), exportValue: (r) => countText(r.readyCount, r.readyMeters) }, accessorFn: (r) => r.readyMeters, cell: ({ row: { original: r } }) => countText(r.readyCount, r.readyMeters) },
  { id: "inProcess", header: "İşlemde", meta: { ...right("İşlemde"), exportValue: (r) => countText(r.inProcessCount, r.inProcessMeters) }, accessorFn: (r) => r.inProcessMeters, cell: ({ row: { original: r } }) => countText(r.inProcessCount, r.inProcessMeters) },
  { id: "shipped", header: "Sevk edilen", meta: { ...right("Sevk edilen"), exportValue: (r) => fmtM(r.shippedMeters) }, accessorFn: (r) => r.shippedMeters, cell: ({ row }) => fmtM(row.original.shippedMeters) },
  {
    id: "target",
    header: "Hedef",
    meta: { ...right("Hedef"), exportValue: (r) => (r.targetMeters == null ? "—" : fmtM(r.targetMeters)) },
    accessorFn: (r) => r.targetMeters,
    cell: ({ row: { original: r } }) => (r.targetMeters == null ? "—" : fmtM(r.targetMeters)),
  },
];

export function readyWorksColumns(unitLabel: string, isCustomer: boolean): ColumnDef<ReadyWorkRow>[] {
  return [
    {
      id: "label",
      header: unitLabel,
      enableHiding: false,
      meta: { label: unitLabel },
      accessorFn: (r) => r.label,
      cell: ({ row: { original: r } }) => (
        <span className="font-medium">
          {r.label}
          {isCustomer && <CariHoldBadge view={r.customerHold} />}
        </span>
      ),
    },
    ...REST_COLUMNS,
  ];
}
