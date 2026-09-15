// Talep Analizi "spec" tablosunun kolon tanımı — sayfadan AYRI dosyada: kolon
// listesi ekranın değil RAPORUN sözleşmesidir ve sayfa gövdesini şişiriyordu.
import type { ColumnDef } from "@tanstack/react-table";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import type { DemandSpecRow } from "./demandAnalysis";

export const specColumns: ColumnDef<DemandSpecRow, unknown>[] = [
  { accessorKey: "itemName", header: "Kumaş" },
  {
    accessorKey: "colorName",
    header: "Renk",
    cell: ({ row }) => {
      const s = row.original;
      if (!s.colorName) return <span className="text-muted-foreground">Renk belirtilmemiş</span>;
      return (
        <span className="flex items-center gap-1.5">
          {s.colorHex ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: s.colorHex }}
              aria-hidden
            />
          ) : null}
          {s.colorName}
        </span>
      );
    },
  },
  {
    accessorKey: "width",
    header: () => <div className="text-right">En</div>,
    cell: ({ getValue }) => {
      const w = getValue() as number | null;
      return <div className="text-right tabular-nums">{w == null ? "—" : fmtNum(w)}</div>;
    },
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Talep</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium tabular-nums">
        {fmtNum(row.original.qty)} m
        <span className="ml-1 text-[10px] text-muted-foreground">
          ({fmtPercent(row.original.sharePct)})
        </span>
      </div>
    ),
  },
  {
    accessorKey: "customerCount",
    header: () => <div className="text-right">Müşteri</div>,
    // Tek müşteriden gelen talep, stoğa üretim için ZAYIF sinyaldir — bu yüzden
    // ayrı sütun ve tekil olan soluk basılır.
    cell: ({ row }) => (
      <div
        className={`text-right tabular-nums ${row.original.customerCount === 1 ? "text-muted-foreground" : ""}`}
      >
        {fmtInt(row.original.customerCount)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          / {fmtInt(row.original.lineCount)} kalem
        </span>
      </div>
    ),
  },
];
