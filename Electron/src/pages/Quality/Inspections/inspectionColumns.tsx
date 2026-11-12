// Muayene listesi — tablo sütunları (ortak DataTable). Muayeneci adı tıklanınca o operatörün süzgeci kurulur.
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { InspectionListRow } from "./service";
import { NONE_TEXT, PHASE_LABEL, STATE_LABEL, inspectionState, numText } from "./inspectionRules";

const right = (label: string) => ({ label, align: "right" as const });
const who = (r: InspectionListRow) => [r.inspectedBy?.fullName ?? "—", r.station?.name].filter(Boolean).join(" · ");

const BASE: ColumnDef<InspectionListRow>[] = [
  {
    id: "roll",
    header: "Top",
    meta: { label: "Top", exportValue: (r) => `${r.roll.barcode ?? "—"}${r.revision > 1 ? ` r${r.revision}` : ""}` },
    accessorFn: (r) => r.roll.barcode ?? "—",
    cell: ({ row: { original: r } }) => (
      <span className="font-mono text-xs">{r.roll.barcode ?? "—"}{r.revision > 1 && <span className="ml-1 text-muted-foreground">r{r.revision}</span>}</span>
    ),
  },
  { id: "item", header: "Kumaş", size: 200, meta: { label: "Kumaş" }, accessorFn: (r) => r.roll.item?.name ?? "—" },
  { id: "phase", header: "Aşama", meta: { label: "Aşama" }, accessorFn: (r) => PHASE_LABEL[r.phase] },
  { id: "length", header: "Uzunluk m", meta: { ...right("Uzunluk m"), exportValue: (r) => numText(r.inspectedLengthM) }, cell: ({ row }) => numText(row.original.inspectedLengthM) },
  {
    id: "width",
    header: "En cm",
    meta: { ...right("En cm"), exportValue: (r) => (r.widthSource === "UNKNOWN" ? "En yok" : numText(r.widthCm)) },
    cell: ({ row: { original: r } }) => (r.widthSource === "UNKNOWN" ? <Badge variant="outline">En yok</Badge> : numText(r.widthCm)),
  },
  { id: "defects", header: "Hata", meta: right("Hata"), accessorFn: (r) => r.defectCount },
  { id: "points", header: "Puan", meta: right("Puan"), accessorFn: (r) => r.totalPoints },
  { id: "per100", header: "/100 m²", meta: { ...right("/100 m²"), exportValue: (r) => numText(r.pointsPer100M2) }, cell: ({ row }) => <span className="font-medium">{numText(row.original.pointsPer100M2)}</span> },
  {
    id: "grade",
    header: "Derece",
    meta: { label: "Derece", exportValue: (r) => `${r.suggestedGradeCode ?? "—"}${r.gradeMismatch ? " (uyumsuz)" : ""}` },
    accessorFn: (r) => r.suggestedGradeCode ?? "—",
    cell: ({ row: { original: r } }) => (
      <span>
        {r.suggestedGradeCode ?? "—"}
        {r.gradeMismatch && <Badge variant="destructive" className="ml-1" title={`Topun kalitesi: ${r.roll.qualityGrade ?? NONE_TEXT}`}>Uyumsuz</Badge>}
      </span>
    ),
  },
  { id: "inspectedAt", header: "Muayene", meta: { label: "Muayene", exportValue: (r) => fmtFactoryDateTime(r.inspectedAt) }, accessorFn: (r) => r.inspectedAt, cell: ({ row }) => <span className="text-xs">{fmtFactoryDateTime(row.original.inspectedAt)}</span> },
];

const STATE_COLUMN: ColumnDef<InspectionListRow> = {
  id: "state",
  header: "Durum",
  meta: { label: "Durum", exportValue: (r) => STATE_LABEL[inspectionState(r)] },
  accessorFn: (r) => inspectionState(r),
  cell: ({ row: { original: r } }) => {
    const st = inspectionState(r);
    return <Badge variant={st === "ACTIVE" ? "outline" : st === "VOIDED" ? "destructive" : "secondary"}>{STATE_LABEL[st]}</Badge>;
  },
};

export function inspectionColumns(onPickOperator: (u: InspectionListRow["inspectedBy"]) => void): ColumnDef<InspectionListRow>[] {
  return [
    ...BASE,
    {
      id: "inspector",
      header: "Muayeneci",
      meta: { label: "Muayeneci", exportValue: who },
      accessorFn: who,
      cell: ({ row: { original: r } }) => (
        <span className="text-xs text-muted-foreground">
          {r.inspectedBy ? (
            <button type="button" className="underline-offset-2 hover:underline" title="Bu operatörün muayeneleri" onClick={(e) => { e.stopPropagation(); onPickOperator(r.inspectedBy); }}>{r.inspectedBy.fullName}</button>
          ) : "—"}
          {r.station ? ` · ${r.station.name}` : ""}
        </span>
      ),
    },
    STATE_COLUMN,
  ];
}
