import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LabeledSelect } from "@/components/forms/LabeledSelect";
import { DetailTable, MetricCard, ReportAxisBar, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { useAxisNotes, useReportAxes } from "../_hooks/useReportAxes";
import { droppedNote } from "../_hooks/reportAxisFilters";
import { fmtInt } from "../_components/formatters";
import { ReportErrorCard } from "../Finance/ReportErrorCard";
import { chainColumns } from "./productionChainColumns";
import { ChainBucketsPanel } from "./ChainBucketsPanel";
import { buildChainExport, CHAIN_STATUS_ALL, CHAIN_STATUS_OPTIONS, chainFilterNotes, chainParams, productionChainApi, type ChainRow } from "./productionChain";

// Müşteri ekseni sunucudan (`meta.secenekler.customerId`, süzgeçten bağımsız); statusFilter + gecikmiş satır düzeyinde sunucuda süzülür.
const AXIS_KEYS = ["customerId"] as const;

export function ProductionChainPage() {
  const axes = useReportAxes();
  const [sp, setSp] = useSearchParams();
  const statusFilter = sp.get("durum") ?? CHAIN_STATUS_ALL;
  const lateOnly = sp.get("gecikmis") === "true";
  const [tab, setTab] = useState<"zincir" | "bagsiz">("zincir");
  const writeParam = (key: string, value: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (value) n.set(key, value); else n.delete(key); return n; }, { replace: true });

  const params = chainParams(axes.params, statusFilter, lateOnly);
  const query = useQuery({ queryKey: ["reports", "dokuma", "zincir", params], queryFn: () => productionChainApi.get(params), staleTime: 30_000 });
  const c = query.data?.data;
  // Eksen şerhleri hook'tan; durum/gecikmiş şerhi eksen SEÇİLMEMİŞKEN de yazılır (o da bir süzgeçtir) — kesilen satır sayısıyla.
  const extraNotes = useMemo(() => chainFilterNotes(statusFilter, lateOnly), [statusFilter, lateOnly]);
  const { secenekler, notes: axisNotesList } = useAxisNotes(query.data, axes.sel, AXIS_KEYS, { ek: extraNotes });
  const dropped = query.data?.suzgec?.dusenSatir;
  const notes = useMemo(() => (axisNotesList.length > 0 ? axisNotesList : extraNotes.length > 0 ? [...extraNotes, ...(droppedNote(dropped) ? [droppedNote(dropped) as string] : [])] : []), [axisNotesList, extraNotes, dropped]);
  const spec = useMemo(() => () => (c ? buildChainExport(c, notes) : null), [c, notes]);
  const columns = useMemo(() => chainColumns(c?.moduller.devere ?? false), [c?.moduller.devere]);

  return (
    <ReportPageLayout
      reportKey="dokuma/zincir"
      title="Üretim Zinciri"
      description="Her satır bir sipariş kalemi: iş emri → dokuma işi → levent. Hücreye tıklamak o belgeyi açar."
      filters={
        <div className="flex flex-wrap items-end gap-2">
          <ReportAxisBar reportKey="dokuma/zincir" axes={axes} secenekler={secenekler} eksenler={AXIS_KEYS} />
          <LabeledSelect label="Durum" value={statusFilter} options={CHAIN_STATUS_OPTIONS} onChange={(v) => writeParam("durum", v === CHAIN_STATUS_ALL ? null : v)} />
          <label className="flex h-9 items-center gap-1 rounded-md border px-2 text-xs">
            <input type="checkbox" checked={lateOnly} onChange={(e) => writeParam("gecikmis", e.target.checked ? "true" : null)} /> Yalnız gecikmişler
          </label>
        </div>
      }
      actions={<ReportExportBar disabled={!c} buildSpec={spec} />}
    >
      {query.isError ? <ReportErrorCard error={query.error} onRetry={() => void query.refetch()} /> : null}
      <ReportFilterNotes notes={notes} />
      {c && c.satirOmitted > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span><strong>{fmtInt(c.satirOmitted)} satır</strong> listeye sığmadı (tavan 500). Özet rakamları <strong>tüm</strong> satırları kapsar. Süzgeçle daraltın.</span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Zincirdeki satır" value={fmtInt(c?.ozet.satir)} hint="Açık sipariş kalemi" icon={Link2} isLoading={query.isLoading} />
        <MetricCard label="Gecikmiş" value={fmtInt(c?.ozet.gecikmis)} hint="Plan bitişi ya da teslim tarihi geçmiş" icon={AlertTriangle} tone={c === undefined ? "neutral" : c.ozet.gecikmis > 0 ? "bad" : "ok"} isLoading={query.isLoading} />
        <MetricCard label="Bağsız kayıt" value={fmtInt(c?.ozet.bagsiz)} hint={c?.moduller.devere ? "İşsiz levent · siparişsiz dokuma · dışarıdan top" : "Siparişsiz dokuma · dışarıdan top"} icon={Unlink} tone={c === undefined ? "neutral" : c.ozet.bagsiz > 0 ? "warn" : "ok"} isLoading={query.isLoading} />
      </div>

      <div className="flex gap-1 border-b" role="tablist">
        <Button role="tab" aria-selected={tab === "zincir"} variant={tab === "zincir" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("zincir")}>Zincir ({fmtInt(c?.ozet.satir)})</Button>
        <Button role="tab" aria-selected={tab === "bagsiz"} variant={tab === "bagsiz" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("bagsiz")}>Bağsız kayıtlar ({fmtInt(c?.ozet.bagsiz)})</Button>
      </div>

      {tab === "zincir" ? (
        <DetailTable<ChainRow>
          title="Zincir"
          description="Gecikmişler ve statusFilter süzgeçle daraltılır; boş hücre bağın kurulmadığını söyler, hesaplanmış bir sonucu değil."
          data={c?.satirlar ?? []}
          columns={columns}
          isLoading={query.isLoading}
          emptyLabel={query.isError ? "Rapor yüklenemedi — yukarıdaki hata kartına bakın" : "Açık sipariş satırı yok"}
        />
      ) : (
        <ChainBucketsPanel c={c} isLoading={query.isLoading} />
      )}
    </ReportPageLayout>
  );
}
