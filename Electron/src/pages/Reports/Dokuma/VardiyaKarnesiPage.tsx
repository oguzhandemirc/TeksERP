// =============================================================================
// VARDİYA KARNESİ — fabrika gününün vardiyaları; kaynak kırılımı toplamda ERİMEZ
// ("K'sı ölçüldü, L'si elle, M'si ölçülemedi")
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DetailTable, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtInt } from "../_components/formatters";
import { buildVardiyaKarnesiExport } from "./dokumaExport";
import { HorizonNote, SealBadge, SourceBreakdownStrip, fmtSec } from "./DokumaShared";
import { SOURCE_LABELS, formatPct } from "./dokuma-regime";
import { dokumaReportsApi, toFactoryYmd, type ShiftMachineRow, type ShiftRow } from "./service";

const columns: ColumnDef<ShiftMachineRow>[] = [
  { accessorKey: "machine.code", header: "Tezgah", cell: ({ row }) => `${row.original.machine.code} · ${row.original.machine.name}` },
  { accessorKey: "source", header: "Kaynak", cell: ({ row }) => (row.original.emptyLoom ? "Boş tezgah" : SOURCE_LABELS[row.original.source]) },
  { accessorKey: "unitsActual", header: "Atkı", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "producedM", header: "Metre", cell: ({ getValue }) => { const v = getValue() as number | null; return v === null ? "—" : v.toLocaleString("tr-TR"); } },
  { accessorKey: "durusSec", header: "Duruş", cell: ({ getValue }) => fmtSec(getValue() as number) },
  { accessorKey: "availabilityPct", header: "Kullanılabilirlik", cell: ({ getValue }) => formatPct(getValue() as number | null) },
  { accessorKey: "performancePct", header: "Performans", cell: ({ getValue }) => formatPct(getValue() as number | null) },
  { accessorKey: "effectivenessPct", header: "Etkinlik", cell: ({ getValue }) => formatPct(getValue() as number | null) },
  { accessorKey: "sealState", header: "Durum", cell: ({ row }) => <SealBadge sealState={row.original.sealState} live={row.original.live} /> },
];

function ShiftCard({ v }: { v: ShiftRow }) {
  const o = v.ozet;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {v.shift.name} ({v.shift.code}) · {new Date(v.startsAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}–{new Date(v.endsAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
          {v.isCancelled ? " · İPTAL" : ""}
        </h3>
        <p className="text-xs text-muted-foreground">
          Atkı {fmtInt(v.uretim.unitsActual)} · Metre {v.uretim.producedM === null ? "—" : v.uretim.producedM.toLocaleString("tr-TR")} · Duruş {fmtSec(v.durusSec)}
        </p>
      </div>
      <p className="text-xs">
        {o.toplamSatir} tezgah satırı: <b>{o.olculen}</b> ölçüldü · <b>{o.elle}</b> elle girildi · <b>{o.simule}</b> simüle · <b>{o.cikarim}</b> çıkarım (boş tezgah) · <b>{o.olculemedi}</b> performansı ölçülemedi
      </p>
      <SourceBreakdownStrip kirilim={v.kaynakKirilimi} />
      <DetailTable<ShiftMachineRow> data={v.makineler} columns={columns} />
    </Card>
  );
}

export function VardiyaKarnesiPage() {
  const [day, setDay] = useState(toFactoryYmd(undefined));
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "dokuma", "vardiya-karnesi", day],
    queryFn: () => dokumaReportsApi.shiftScorecard({ factoryDay: day }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(day),
    staleTime: 30_000,
  });
  const rapor = data?.data;
  // Süzgeç TEK GÜNDÜR (tarih aralığı değil) — başlık da onu söyler.
  const spec = useMemo(() => () => (rapor ? buildVardiyaKarnesiExport({ rapor, day }) : null), [rapor, day]);
  const filters = (
    <div className="flex items-end gap-3 border-b px-4 py-3">
      <div className="space-y-1">
        <Label htmlFor="karne-gun">Fabrika günü</Label>
        <Input id="karne-gun" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
      </div>
    </div>
  );
  return (
    <ReportPageLayout title="Vardiya Karnesi" description="Vardiya başına üretim ve duruş; her satır kaynağını taşır, toplam tek yüzdeye çökertilmez." filters={filters} actions={<ReportExportBar disabled={!rapor || rapor.vardiyalar.length === 0} buildSpec={spec} />}>
      {isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {!isLoading && rapor && rapor.vardiyalar.length === 0 && <p className="text-sm text-muted-foreground">Bu günde vardiya penceresi yok (takvim job'u 30 gün ileri yazar; dokuma modülü açık mı?).</p>}
      {rapor?.vardiyalar.map((v) => <ShiftCard key={v.shiftInstanceId} v={v} />)}
      <HorizonNote meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
