// WIP karnesi — "hiç başlamamış terbiye iş emirleri" tablosunun kolonları (sayfa dosyası boyut sınırı için ayrıldı).
import type { ColumnDef } from "@tanstack/react-table";
import { fmtNum } from "../_components/formatters";
import type { WipScorecard } from "./wipScorecard";

const ageTone = (d: number | null) => (d === null ? "" : d > 7 ? "text-destructive" : d > 3 ? "text-warning" : "");

export const woColumns: ColumnDef<WipScorecard["neverStarted"][number], unknown>[] = [
  { accessorKey: "workOrderNumber", header: "Terbiye İş Emri" },
  { accessorKey: "status", header: "Durum" },
  {
    accessorKey: "daysOpen",
    header: () => <div className="text-right">Açık</div>,
    cell: ({ getValue }) => {
      const d = getValue() as number;
      return <div className={`text-right tabular-nums ${ageTone(d)}`}>{fmtNum(d)} gün</div>;
    },
  },
];
