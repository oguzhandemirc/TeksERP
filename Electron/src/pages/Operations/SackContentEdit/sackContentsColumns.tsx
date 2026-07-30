import type { ColumnDef } from "@tanstack/react-table";
import type { SackContentRoll } from "./types";

const fmtM = (n: number) => `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/**
 * Çuval içeriği (TOP) sütunları — seçilebilir DataTable. Kartelalar ayrı listede.
 * Seçim kolonu (checkbox) DataTable tarafından otomatik eklenir; burada yok.
 */
export const sackContentsColumns: ColumnDef<SackContentRoll>[] = [
  {
    accessorKey: "barcode",
    header: "Barkod",
    meta: { label: "Barkod", exportValue: (r) => r.barcode ?? "Açık Kumaş" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.barcode ?? "Açık Kumaş"}</span>,
  },
  {
    id: "item",
    header: "Kumaş",
    meta: { label: "Kumaş", exportValue: (r) => r.item.name },
    cell: ({ row }) => <span className="text-sm">{row.original.item.name}</span>,
  },
  {
    id: "color",
    header: "Renk",
    meta: { label: "Renk", exportValue: (r) => r.color?.name ?? "Ham" },
    cell: ({ row }) => {
      const c = row.original.color;
      return (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {c?.hex && <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: c.hex }} />}
          {c?.name ?? "Ham"}
        </span>
      );
    },
  },
  {
    id: "width",
    header: "En",
    meta: { label: "En", exportValue: (r) => (r.width ? `${r.width} cm` : "") },
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.width ? `${row.original.width} cm` : "—"}</span>
    ),
  },
  {
    id: "qty",
    // summable → Excel'e SAYI olarak yazılır + altta TOPLAM satırı doğar. Eskiden
    // exportValue "700 m" METNİ dönüyordu; Excel'de toplanamıyor, TOPLAM hiç çıkmıyordu.
    meta: { label: "Metre", summable: true, exportValue: (r) => Number(r.currentQty) },
    header: "Metre",
    cell: ({ row }) => <span className="text-sm tabular-nums">{fmtM(Number(row.original.currentQty))}</span>,
  },
  {
    accessorKey: "qualityGrade",
    header: "Kalite",
    meta: { label: "Kalite" },
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.qualityGrade ?? "—"}</span>,
  },
];
