// =============================================================================
// LEVENT BİTİŞ TAHMİNİ — tablo kolonları (null → "—", 0 değil)
// =============================================================================
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { fmtCalendarDate, fmtMeters, fmtNum } from "../_components/formatters";
import { gerekce } from "./leventShared";
import { leadText, spareText, type FinishForecastRow } from "./leventReportTypes";

/** S1: devereye ver günü + teslim süresi açıklaması; yedek yok ∧ gün geldi → kırmızı rozet. */
function DevereyeVerCell({ r }: { r: FinishForecastRow }) {
  if (r.orderByDay === undefined) return <>—</>;
  if (r.orderByDay === null) return <span className="text-muted-foreground">{gerekce(r.orderByGerekce)}</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        {fmtCalendarDate(r.orderByDay)}
        {r.devereAcil && <Badge variant="danger" title="Aynı kartta hazır ya da yolda levent yok ve devereye verme günü geldi">Devereye ver</Badge>}
      </span>
      <span className="text-xs text-muted-foreground">{leadText(r)}</span>
    </div>
  );
}

export const bitisColumns: ColumnDef<FinishForecastRow>[] = [
  { accessorKey: "beamNo", header: "Levent" },
  { accessorKey: "machine.code", header: "Tezgah", cell: ({ row }) => `${row.original.machine.code} · ${row.original.machine.name}` },
  { accessorKey: "position", header: "Yuva", cell: ({ getValue }) => fmtNum(getValue() as number | null) },
  { id: "warpSpec", header: "Çözgü", accessorFn: (r) => (r.warpSpec ? `${r.warpSpec.code} · ${r.warpSpec.name}` : "—") },
  { accessorKey: "kalanM", header: "Kalan", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "gunlukOrtM", header: "Günlük ort.", cell: ({ getValue }) => fmtMeters(getValue() as number | null) },
  { id: "kaynak", header: "Otomatik / elle (7 gün)", cell: ({ row }) => `${fmtMeters(row.original.kaynak.otomatik)} / ${fmtMeters(row.original.kaynak.elle)}` },
  { accessorKey: "tahminiBitisGun", header: "Tahmini bitiş", cell: ({ row }) => fmtCalendarDate(row.original.tahminiBitisGun) },
  { accessorKey: "kalanGun", header: "Kalan gün", cell: ({ getValue }) => fmtNum(getValue() as number | null) },
  { id: "spare", header: "Yedek", accessorFn: (r) => spareText(r.spare, fmtMeters) },
  { id: "orderByDay", header: "Devereye ver", accessorFn: (r) => r.orderByDay ?? r.orderByGerekce ?? "—", cell: ({ row }) => <DevereyeVerCell r={row.original} /> },
  { accessorKey: "hesaplanamadi", header: "Hesaplanamadı", cell: ({ row }) => gerekce(row.original.hesaplanamadi) },
];
