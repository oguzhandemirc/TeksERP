import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import type { PrinterModel, PrinterLanguage } from "./types";

// Diller markaya özel değil — endüstri dilleri/emülasyonlar: PPLA=Datamax kökenli
// (Argox kullanır), PPLB=Eltron/EPL2 lehçesi, ZPL=Zebra kökenli (Bixolon BPL-Z gibi
// emülasyonlar da anlar). Parantez içi köken bilgisidir, uyumluluk sınırı değil.
export const PRINTER_LANGUAGE_LABELS: Record<PrinterLanguage, string> = {
  RASTER_HTML: "HTML (OS sürücü)",
  PPLA: "PPLA (Argox/Datamax)",
  PPLB: "PPLB (Eltron/EPL)",
  ZPL: "ZPL (Zebra uyumlu)",
};

export const printerModelColumns: ColumnDef<PrinterModel>[] = [
  {
    id: "code",
    header: "Kod / Ad",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="font-mono text-xs">{row.original.code}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {row.original.name}
          {row.original.manufacturer ? ` · ${row.original.manufacturer}` : ""}
        </div>
      </div>
    ),
  },
  { accessorKey: "dpi", header: "DPI", cell: ({ row }) => <span className="tabular-nums">{row.original.dpi}</span> },
  {
    accessorKey: "maxWidthMm",
    header: "Max En",
    cell: ({ row }) => <span className="tabular-nums">{row.original.maxWidthMm} mm</span>,
  },
  {
    accessorKey: "language",
    header: "Dil",
    cell: ({ row }) => <Badge variant="muted">{PRINTER_LANGUAGE_LABELS[row.original.language]}</Badge>,
  },
  {
    id: "defaultProfile",
    header: "Varsayılan Profil",
    cell: ({ row }) =>
      row.original.defaultProfile ? (
        <span className="font-mono text-[11px]">{row.original.defaultProfile.code}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
];
