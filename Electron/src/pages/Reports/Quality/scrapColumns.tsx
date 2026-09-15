// Fire Karnesi "tespit" tablosunun kolon tanımı — sayfadan AYRI dosyada:
// kolon listesi sayfa gövdesinin okunurluk sınırını dolduruyordu.
import type { ColumnDef } from "@tanstack/react-table";
import { fmtInt } from "../_components/formatters";
import type { DefectDetectionRow } from "./service";

export const detectionColumns: ColumnDef<DefectDetectionRow, unknown>[] = [
  { accessorKey: "label", header: "Hata / İstasyon" },
  {
    accessorKey: "count",
    header: () => <div className="text-right">Tespit</div>,
    cell: ({ getValue }) => <div className="text-right font-medium tabular-nums">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "cutCount",
    header: () => <div className="text-right">Kesildi</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums text-muted-foreground">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "noCutCount",
    header: () => <div className="text-right">Tutuldu</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums text-muted-foreground">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "openCount",
    header: () => <div className="text-right">Açık</div>,
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <div className={`text-right tabular-nums ${v > 0 ? "text-warning" : "text-muted-foreground"}`}>{fmtInt(v)}</div>;
    },
  },
];
