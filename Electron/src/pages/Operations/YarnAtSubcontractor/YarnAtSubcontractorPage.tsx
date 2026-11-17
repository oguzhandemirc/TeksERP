// =============================================================================
// FASONDAKİ İPLİK (devere D6c) — "hangi fasoncuda hangi iplikten kaç kg var"
// =============================================================================
// ⚠️ REJİM: devere modülü (karo `isWarpBeamsVisible`, route `devereEnabled`); asıl sed backend
// `requireDevereEnabled` + `requireIplikEnabled`. Okuma `warping-order:read`; ekran yazmaz.
// Süzgeçler URL'de `filter[...]` → SUNUCUDA; özet şeridi aynı yanıttan (tek where). Kırılım yalnız sıralamadır.
// =============================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { BandStats, ListBand } from "@/components/layout/ListPage";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { Tabs } from "@/components/ui/tabs";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import { useLocalTable } from "@/hooks/useLocalTable";
import { useEmanetEnabled } from "@/hooks/usePricingEnabled";
import { formatQty } from "@/lib/format";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { itemService } from "@/pages/Items/service";
import { YARN_ITEM_FILTER } from "../Yarn/YarnFilterBar";
import { yarnAtSubColumns } from "./columns";
import { ageText, LONG_WAIT_DAYS, rowKey, STATUS_OPTIONS, summarize, toLines, type YarnAtSubLine, type YarnAtSubView } from "./model";
import { listYarnAtSubcontractor, YARN_AT_SUB_QUERY_KEY } from "./service";

export const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "subcontractorId", label: "Fasoncu", service: subcontractorService, queryKey: "subcontractors-yarn-at-filter" },
  { kind: "lookup", key: "yarnItemId", label: "İplik", service: itemService, queryKey: "items-yarn-at-filter", extraFilters: YARN_ITEM_FILTER },
  { kind: "select", key: "status", label: "Sipariş durumu", options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
];
const SPLIT = splitDefFilters(FILTERS, ["subcontractorId", "yarnItemId", "status"]);
const kgText = (v: number) => formatQty(v, 3, 2);

export function YarnAtSubcontractorPage() {
  const [sp, setSp] = useSearchParams();
  const view: YarnAtSubView = sp.get("view") === "yarn" ? "yarn" : "subcontractor";
  const f = { subcontractorId: sp.get("filter[subcontractorId]") ?? undefined, yarnItemId: sp.get("filter[yarnItemId]") ?? undefined, status: sp.get("filter[status]") ?? undefined };
  const filtered = Boolean(f.subcontractorId || f.yarnItemId || f.status);
  const q = useQuery({
    queryKey: [YARN_AT_SUB_QUERY_KEY, f.subcontractorId ?? "", f.yarnItemId ?? "", f.status ?? ""],
    queryFn: () => listYarnAtSubcontractor(f),
  });
  const showOwner = useEmanetEnabled();
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const lines = useMemo(() => toLines(rows, view), [rows, view]);
  const columns = useMemo(() => yarnAtSubColumns(view, showOwner), [view, showOwner]);
  const table = useLocalTable<YarnAtSubLine>({ tableKey: `yarn-at-subcontractor:${view}`, data: lines, columns, getRowId: rowKey });
  const s = useMemo(() => summarize(rows), [rows]);

  const setView = (v: string) => {
    const next = new URLSearchParams(sp);
    if (v === "yarn") next.set("view", "yarn");
    else next.delete("view");
    setSp(next, { replace: true });
  };

  return (
    <PageShell>
      <PageHeader
        title="Fasondaki İplik"
        description="Devere için fasoncuya gönderilen ve henüz dönmemiş iplik: hangi fasoncuda, hangi iplikten, hangi lot ve siparişle, kaç gündür. Devreden = siparişi kapanmış ama fasoncuda kalmış iplik."
        actions={<RefreshButton queryKey={YARN_AT_SUB_QUERY_KEY} />}
      />
      <Tabs value={view} onValueChange={setView}>
        <PageTabsList aria-label="Kırılım">
          <PageTabsTrigger value="subcontractor">Fasoncuya göre</PageTabsTrigger>
          <PageTabsTrigger value="yarn">İpliğe göre</PageTabsTrigger>
        </PageTabsList>
      </Tabs>
      {!q.isLoading && !q.isError && (
        <ListBand>
          <BandStats
            label="Fasondaki iplik özeti"
            scope={filtered ? "Süzgece uyan" : "Tüm fasoncular"}
            items={[
              { key: "kg", label: "Toplam", value: kgText(s.totalKg), unit: "kg" },
              { key: "subs", label: "Fasoncu", value: s.subcontractorCount },
              { key: "yarns", label: "İplik çeşidi", value: s.yarnCount },
              { key: "carried", label: "Devreden", value: kgText(s.carriedKg), unit: "kg", tone: s.carriedKg > 0 ? "warn" : undefined, title: "Siparişi kapanmış ama fasoncuda kalan iplik — sonraki siparişe aktarılabilir ya da geri alınmalı" },
              ...(s.oldestDays !== null ? [{ key: "oldest", label: "En eski", value: ageText(s.oldestDays), tone: s.oldestDays >= LONG_WAIT_DAYS ? ("warn" as const) : undefined, title: "En uzun süredir fasonda duran ipliğin bekleme süresi" }] : []),
            ]}
          />
        </ListBand>
      )}
      <FilterRow primary={SPLIT.primary} more={SPLIT.more} tools={{ table, exportName: "Fasondaki iplik" }} />
      <DataTable<YarnAtSubLine>
        table={table}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        errorText="Bu bir “fasonda iplik yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
        emptyText={filtered ? "Bu süzgece uyan fasondaki iplik yok. Süzgeci temizleyip tekrar bakın." : "Şu an hiçbir fasoncuda iplik yok. Devere siparişine iplik sevk edilince burada görünür."}
        rowClassName={(r) => (r.groupFirst ? "border-t-2 border-t-border" : undefined)}
      />
    </PageShell>
  );
}
