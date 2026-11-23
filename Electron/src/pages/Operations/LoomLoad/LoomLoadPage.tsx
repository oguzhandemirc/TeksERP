// Tezgâh Yükü — "hangi tezgâh ne zamana kadar dolu?" (salt okuma, Seyitoğlu 3. bölüm L2). Sayılar sunucudan
// (`/api/weaving-orders/loom-load`); ekran hesap yapmaz, yalnız biçimler, çizelgeye dizer ve bilinmeyenin nedenini söyler.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Spool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoPopover } from "@/components/ui/info-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { fmtFactoryDateTime, fmtFactoryTime } from "@/lib/factory-time";
import { TERIM } from "@/lib/terim";
import { cn } from "@/lib/utils";
import { loomLoadService } from "./service";
import {
  HORIZON_LABEL, LOOM_FILTER_LABEL, assumptionText, horizonDays, jobMatches, loomMatches, summaryText,
  type HorizonChoice, type LoomFilter,
} from "./loom-load-text";
import { timelineAxis } from "./loom-load-axis";
import { ChartHead, LoomGroup } from "./LoomLoadChart";
import { Legend, UnassignedSection } from "./LoomLoadParts";

export const LOOM_LOAD_QUERY_KEY = ["weaving-orders", "loom-load"] as const;

export function LoomLoadPage() {
  const q = useQuery({ queryKey: LOOM_LOAD_QUERY_KEY, queryFn: () => loomLoadService.get() });
  const d = q.data;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LoomFilter>("all");
  const [horizon, setHorizon] = useState<HorizonChoice>("auto");
  // İstemci süzmesi meşru (EL-15): yanıt sayfasız, tezgâhların tamamı tek istekte gelir.
  const looms = useMemo(() => (d ? d.looms.filter((l) => loomMatches(l, query, filter)) : []), [d, query, filter]);
  const unassigned = useMemo(() => (d && filter === "all" ? d.unassigned.filter((j) => jobMatches(j, query)) : []), [d, query, filter]);
  const axis = useMemo(() => (d ? timelineAxis(d.generatedAt, horizonDays(d.looms, horizon)) : null), [d, horizon]);
  const narrowed = query.trim() !== "" || filter !== "all";
  const noLooms = !!d && d.looms.length === 0 && d.unassigned.length === 0;

  return (
    <PageShell className="overflow-hidden">
      <PageHeader
        title="Tezgâh Yükü"
        titleExtra={d ? <span data-testid="loom-load-assumption"><InfoPopover label="Boşalma zamanı nasıl hesaplanır" desc={assumptionText(d.assumption)} /></span> : undefined}
        actions={
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={q.isFetching} onClick={() => void q.refetch()} aria-label="Yenile">
            <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} /> <span className="hidden lg:inline">Yenile</span>
          </Button>
        }
      />
      {d && !noLooms && (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <ListSearchBox value={query} onSearchChange={setQuery} searchHint={`Tezgâh kodu/adı, ${TERIM.dokumaIsEmri.tekilKucuk} no, ürün kodu/adı`} />
          <Select value={filter} onValueChange={(v) => setFilter(v as LoomFilter)}>
            <SelectTrigger className="h-8 w-44" aria-label="Tezgâh durumu"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(LOOM_FILTER_LABEL) as LoomFilter[]).map((k) => <SelectItem key={k} value={k}>{LOOM_FILTER_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-testid="loom-load-summary" title={`${fmtFactoryDateTime(d.generatedAt)} itibarıyla`}>
            {summaryText(d)} · {fmtFactoryTime(d.generatedAt)} itibarıyla
          </span>
          <div className="flex shrink-0 items-center gap-3">
            <Legend />
            <Select value={horizon} onValueChange={(v) => setHorizon(v as HorizonChoice)}>
              <SelectTrigger className="h-8 w-40" aria-label="Çizelge ufku">
                <span className="text-muted-foreground">Ufuk:</span> <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(HORIZON_LABEL) as HorizonChoice[]).map((k) => <SelectItem key={k} value={k}>{HORIZON_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <PageBody className="p-3">
        {q.isError ? (
          <EmptyState icon={Spool} title="Tezgâh yükü okunamadı" description="Bağlantıyı kontrol edip yeniden deneyin." action={<Button size="sm" variant="outline" onClick={() => void q.refetch()}>Yeniden dene</Button>} />
        ) : !d || !axis ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : noLooms ? (
          <EmptyState
            icon={Spool}
            title="Tanımlı dokuma tezgâhı yok"
            description={`Tanımlar › Üretim İstasyonları ekranından dokuma tezgâhı ekleyin; ${TERIM.dokumaIsEmri.tekilKucuk} tezgâhta başlayınca yükü burada görünür.`}
          />
        ) : (
          <div className="flex min-w-[46rem] flex-col gap-3">
            <div role="table" aria-label="Tezgâh yük çizelgesi" className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card">
              <ChartHead axis={axis} />
              {looms.length > 0 ? (
                looms.map((l) => <LoomGroup key={l.machineId} loom={l} axis={axis} />)
              ) : (
                <div className="flex items-center justify-between gap-3 px-3 py-6 text-sm text-muted-foreground">
                  <span>{narrowed ? "Aramaya ya da filtreye uyan tezgâh yok." : "Tanımlı dokuma tezgâhı yok."}</span>
                  {narrowed && <Button size="sm" variant="outline" onClick={() => { setQuery(""); setFilter("all"); }}>Filtreyi temizle</Button>}
                </div>
              )}
            </div>
            <UnassignedSection jobs={unassigned} />
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
