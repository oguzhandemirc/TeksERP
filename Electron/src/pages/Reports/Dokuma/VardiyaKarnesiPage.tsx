// =============================================================================
// VARDİYA KARNESİ — fabrika gününün vardiyaları; kaynak kırılımı toplamda ERİMEZ
// ("K'sı ölçüldü, L'si elle, M'si ölçülemedi")
// =============================================================================
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Card } from "@/components/ui/card";
import { DetailTable, MetricCard, ReportDateFilter, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtInt } from "../_components/formatters";
import { buildVardiyaKarnesiExport } from "./dokumaExport";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { optionLabel, pickReportData, shiftOptionsFrom } from "./dokumaFilters";
import { HorizonNote, SealBadge, SourceBreakdownStrip, fmtSec } from "./DokumaShared";
import { SOURCE_LABELS, formatPct } from "./dokuma-regime";
import { useFactoryDay } from "../_hooks/useReportDay";
import { dokumaReportsApi, type ShiftMachineRow, type ShiftRow } from "./service";

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
  // Gün URL'de yaşar (`factoryDay`; bugün yazılmaz) — yenilemede ve paylaşılan linkte kaybolmaz.
  const { ymd: day, params } = useFactoryDay("dokuma/vardiya-karnesi");
  const [sp, setSp] = useSearchParams();
  const shiftId = sp.get("shift") ?? "";
  // GÜN sorgusu SÜZGEÇSİZDİR: vardiya seçenekleri buradan doğar. Süzgeçli
  // yanıttan doğsaydı seçimden sonra liste tek vardiyaya daralır ve kullanıcı
  // kendi seçimine kilitlenirdi (Randıman'daki aynı tuzak).
  const gun = useQuery({
    queryKey: ["reports", "dokuma", "vardiya-karnesi", day],
    queryFn: () => dokumaReportsApi.shiftScorecard(params),
    staleTime: 30_000,
  });
  const suzgecli = useQuery({
    queryKey: ["reports", "dokuma", "vardiya-karnesi", day, shiftId],
    queryFn: () => dokumaReportsApi.shiftScorecard({ ...params, shiftDefinitionId: shiftId }),
    enabled: shiftId !== "",
    staleTime: 30_000,
  });
  const isLoading = gun.isLoading || (shiftId !== "" && suzgecli.isLoading);
  const data = pickReportData({ windowData: gun.data, filteredData: suzgecli.data, filterId: shiftId });
  const rapor = data?.data;
  const shiftOptions = useMemo(() => shiftOptionsFrom(gun.data?.data.vardiyalar), [gun.data]);
  const shiftLabel = optionLabel(shiftOptions, shiftId);
  // Süzgeç TEK GÜNDÜR (tarih aralığı değil) — başlık da onu söyler.
  const spec = useMemo(
    () => () => (rapor ? buildVardiyaKarnesiExport({ rapor, day, filterLabel: shiftLabel }) : null),
    [rapor, day, shiftLabel],
  );
  // ÖZET ŞERİDİ: sayılar RAPORUN KENDİ yanıtından toplanır, yeni uç yok.
  // "Ölçülemedi" ayrı kart DEĞİL, duruş kartının ipucu: sayı ile beyanı ayırmak
  // okuyucuya "kaç satır güvenilir" sorusunu iki yerde sordururdu.
  const summary = useMemo(() => {
    const v = rapor?.vardiyalar ?? [];
    const metreVar = v.some((x) => x.uretim.producedM !== null);
    return {
      vardiya: v.length,
      atki: v.reduce((a, x) => a + x.uretim.unitsActual, 0),
      metre: metreVar ? v.reduce((a, x) => a + (x.uretim.producedM ?? 0), 0) : null,
      durus: v.reduce((a, x) => a + x.durusSec, 0),
      olculemedi: v.reduce((a, x) => a + x.ozet.olculemedi, 0),
      satir: v.reduce((a, x) => a + x.ozet.toplamSatir, 0),
    };
  }, [rapor]);
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey="dokuma/vardiya-karnesi" bare />
      <DokumaFilterBar
        id="karne-vardiya"
        label="Vardiya"
        value={shiftId}
        options={shiftOptions}
        onChange={(id) => setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set("shift", id); else n.delete("shift"); return n; }, { replace: true })}
      />
    </div>
  );
  return (
    <ReportPageLayout reportKey="dokuma/vardiya-karnesi" title="Vardiya Karnesi" description="Vardiya başına üretim ve duruş; her satır kaynağını taşır, toplam tek yüzdeye çökertilmez." filters={filters} actions={<ReportExportBar disabled={!rapor || rapor.vardiyalar.length === 0} buildSpec={spec} />}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Vardiya" value={rapor ? fmtInt(summary.vardiya) : null} hint={rapor ? `${fmtInt(summary.satir)} tezgah satırı` : undefined} isLoading={isLoading} />
        <MetricCard label="Atkı (Σ)" value={rapor ? fmtInt(summary.atki) : null} isLoading={isLoading} />
        <MetricCard label="Metre (Σ)" value={rapor ? (summary.metre === null ? "ölçülmedi" : summary.metre.toLocaleString("tr-TR")) : null} hint="Metre yalnız ölçülmüş koşumlardan" isLoading={isLoading} />
        <MetricCard label="Duruş (Σ)" value={rapor ? fmtSec(summary.durus) : null} hint={rapor && summary.olculemedi > 0 ? `${fmtInt(summary.olculemedi)} satırda oran ölçülemedi` : undefined} tone={rapor && summary.olculemedi > 0 ? "warn" : "neutral"} isLoading={isLoading} />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {!isLoading && rapor && rapor.vardiyalar.length === 0 && <p className="text-sm text-muted-foreground">Bu günde vardiya penceresi yok (takvim job'u 30 gün ileri yazar; dokuma modülü açık mı?).</p>}
      {rapor?.vardiyalar.map((v) => <ShiftCard key={v.shiftInstanceId} v={v} />)}
      <HorizonNote meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
