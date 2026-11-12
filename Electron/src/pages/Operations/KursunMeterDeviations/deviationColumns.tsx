// Sapma tablosu sütunları (ortak DataTable). "Onayla" yalnız OFFICE kipli bekleyen satırda.
import type { ColumnDef } from "@tanstack/react-table";
import { formatFactory } from "@/lib/factory-time";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { MODE_LABEL, STATUS_HINT, STATUS_LABEL, STATUS_TONE_CLASS, canOfficeAck, fmtDiff, fmtMeters, sourceBadge, thresholdText } from "./deviation-labels";
import type { MeterDeviationRow } from "./types";

function inText(r: MeterDeviationRow): string {
  return r.basis === "MEASURED_IN" && r.measuredIn != null ? `${fmtMeters(r.measuredIn)} (ölçülen)` : `${fmtMeters(r.declaredIn)} (bildirilen)`;
}

function signatureText(r: MeterDeviationRow): string {
  if (!r.ack) return "—";
  const who = r.ack.approvedByName ? ` · ${r.ack.approvedByName}` : "";
  const why = r.ack.reasonCode ?? r.ack.reasonText;
  return `${MODE_LABEL[r.ack.mode]}${who}${why ? ` · ${why}` : ""}`;
}

const sub = (text: string | null | undefined) => (text ? <span className="ml-1.5 text-xs text-muted-foreground">{text}</span> : null);
const num = (label: string) => ({ label, align: "right" as const });

const BASE_COLUMNS: ColumnDef<MeterDeviationRow>[] = [
  { id: "createdAt", header: "Zaman", meta: { label: "Zaman", exportValue: (r) => formatFactory(r.createdAt, "dd.MM.yyyy HH:mm") }, cell: ({ row }) => formatFactory(row.original.createdAt, "dd.MM.yyyy HH:mm") },
  {
    id: "barcode",
    header: "Top",
    meta: { label: "Top", exportValue: (r) => [r.barcode, r.workOrderNumber].filter(Boolean).join(" ") },
    cell: ({ row: { original: r } }) => (
      <span>
        <span className="font-mono">{r.barcode ?? "—"}</span>
        {sub(r.workOrderNumber)}
      </span>
    ),
  },
  { id: "machine", header: "Makine", meta: { label: "Makine" }, accessorFn: (r) => r.machineName ?? "—" },
  { id: "customer", header: "Müşteri", meta: { label: "Müşteri" }, accessorFn: (r) => r.customerName ?? "—" },
  { id: "in", header: "Giriş", meta: { ...num("Giriş"), exportValue: inText }, cell: ({ row }) => <span className="tabular-nums">{inText(row.original)}</span> },
  { id: "out", header: "Çıkış", meta: { ...num("Çıkış"), exportValue: (r) => fmtMeters(r.outMeters) }, cell: ({ row }) => <span className="tabular-nums">{fmtMeters(row.original.outMeters)}</span> },
  { id: "diff", header: "Fark", meta: { ...num("Fark"), exportValue: (r) => fmtDiff(r.diffMeters) }, cell: ({ row }) => <span className="font-medium tabular-nums">{fmtDiff(row.original.diffMeters)}</span> },
  {
    id: "threshold",
    header: "Eşik · kip",
    meta: { label: "Eşik · kip", exportValue: (r) => `${thresholdText(r)} · ${MODE_LABEL[r.approvalMode]}` },
    cell: ({ row: { original: r } }) => (
      <span>
        {thresholdText(r)}
        {sub(MODE_LABEL[r.approvalMode])}
      </span>
    ),
  },
  {
    id: "source",
    header: "Kaynak",
    meta: { label: "Kaynak", exportValue: (r) => sourceBadge(r.source).label },
    cell: ({ row }) => {
      const src = sourceBadge(row.original.source);
      return <span className={`rounded-badge px-2 py-0.5 text-xs ${src.className}`} title={src.hint}>{src.label}</span>;
    },
  },
  {
    id: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => STATUS_LABEL[r.status] },
    cell: ({ row: { original: r } }) => (
      <span className={`rounded-badge px-2 py-0.5 text-xs ${STATUS_TONE_CLASS[r.status]}`} title={STATUS_HINT[r.status]}>
        {STATUS_LABEL[r.status]}
      </span>
    ),
  },
  {
    id: "signature",
    header: "İmza",
    meta: { label: "İmza", exportValue: signatureText },
    cell: ({ row: { original: r } }) => <span title={r.ack?.reasonText ?? undefined} className={r.ack ? undefined : "text-muted-foreground"}>{signatureText(r)}</span>,
  },
];

export function deviationColumns(onAck: (row: MeterDeviationRow) => void): ColumnDef<MeterDeviationRow>[] {
  return [
    ...BASE_COLUMNS,
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      meta: { label: "İşlem", align: "right" },
      cell: ({ row: { original: r } }) =>
        canOfficeAck(r) ? (
          <PermissionGate permission="kursun:meter-approve">
            <Button size="sm" className="h-7" onClick={() => onAck(r)}>
              Onayla
            </Button>
          </PermissionGate>
        ) : null,
    },
  ];
}
