// Lab testleri listesi — tablo sütunları (ortak DataTable).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { fmtCalendarDay } from "@/lib/factory-time";
import type { LabTestListRow } from "./service";
import { STATUS_BADGE, STATUS_LABEL } from "./labTestRules";

const subjectText = (r: LabTestListRow) => (r.roll ? `Top ${r.roll.barcode ?? "—"}` : `Parti ${r.batch?.batchNumber ?? "—"}`);
const sampleText = (r: LabTestListRow) => [r.sampleCode, r.labName].filter(Boolean).join(" · ") || "—";
const resultText = (r: LabTestListRow) => (r.resultCount === 0 ? "Sonuç yok" : `${r.hasFail ? "Kalan var" : "Geçti"} · ${r.resultCount}`);

export const LAB_TEST_COLUMNS: ColumnDef<LabTestListRow>[] = [
  { id: "testNo", header: "Test No", meta: { label: "Test No" }, accessorFn: (r) => r.testNo, cell: ({ row }) => <span className="font-mono text-xs">{row.original.testNo}</span> },
  { id: "testedOn", header: "Test tarihi", meta: { label: "Test tarihi", exportValue: (r) => fmtCalendarDay(r.testedOn) }, accessorFn: (r) => r.testedOn, cell: ({ row }) => fmtCalendarDay(row.original.testedOn) },
  {
    id: "subject",
    header: "Konu",
    meta: { label: "Konu", exportValue: subjectText },
    accessorFn: subjectText,
    cell: ({ row: { original: r } }) =>
      r.roll ? <>Top <span className="font-mono">{r.roll.barcode ?? "—"}</span></> : <>Parti <span className="font-mono">{r.batch?.batchNumber ?? "—"}</span></>,
  },
  { id: "item", header: "Kumaş", size: 200, meta: { label: "Kumaş" }, accessorFn: (r) => r.item?.name ?? "—" },
  { id: "sample", header: "Numune · Lab", meta: { label: "Numune · Lab" }, accessorFn: sampleText, cell: ({ row }) => <span className="text-xs text-muted-foreground">{sampleText(row.original)}</span> },
  {
    id: "result",
    header: "Sonuç",
    meta: { label: "Sonuç", exportValue: resultText },
    accessorFn: resultText,
    cell: ({ row: { original: r } }) =>
      r.resultCount === 0 ? <span className="text-xs text-muted-foreground">Sonuç yok</span>
        : r.hasFail ? <Badge variant="destructive">Kalan var · {r.resultCount}</Badge>
        : <Badge variant="outline">Geçti · {r.resultCount}</Badge>,
  },
  { id: "status", header: "Durum", meta: { label: "Durum", exportValue: (r) => STATUS_LABEL[r.status] }, accessorFn: (r) => r.status, cell: ({ row }) => <Badge variant={STATUS_BADGE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge> },
];
