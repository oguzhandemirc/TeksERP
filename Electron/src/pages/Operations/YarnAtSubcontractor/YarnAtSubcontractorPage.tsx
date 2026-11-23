// =============================================================================
// FASONDAKİ İPLİK (devere D6c) — "hangi fasoncuda hangi iplikten kaç kg var"
// =============================================================================
// ⚠️ REJİM: devere modülü (karo `isWarpBeamsVisible`, route `devereEnabled`); asıl sed backend
// `requireDevereEnabled` + `requireIplikEnabled`. Okuma `warping-order:read`; satır eylemleri `warping-order:write`
// ile devere sipariş sayfasının pencerelerine iner. Süzgeçler (lot dahil) URL'de `filter[...]`, arama `search` → SUNUCUDA;
// özet şeridi aynı yanıttan (tek where). Değer sütunu yalnız fiyat alanı gelen kullanıcıda (`goods-receipt:read`).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import { useListSearch } from "@/hooks/useListSearch";
import { useLocalTable } from "@/hooks/useLocalTable";
import { useEmanetEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { itemService } from "@/pages/Items/service";
import { YARN_ITEM_FILTER } from "../Yarn/YarnFilterBar";
import { yarnAtSubColumns, type YarnRowAction } from "./columns";
import { rowKey, STATUS_OPTIONS, summarize, toLines, type YarnAtSubLine, type YarnAtSubView } from "./model";
import { RowActionHost, type RowActionTarget } from "./RowActionHost";
import { listYarnAtSubcontractor, yarnAtSubLotOptions, yarnAtSubQueryKey, YARN_AT_SUB_QUERY_KEY, type YarnAtSubFilters } from "./service";
import { StatementDialog } from "./StatementDialog";
import { SummaryStats } from "./SummaryBand";
import { ListFooter } from "@/components/layout/ListPage";

/** Süzgeç tanımları — Lot seçenekleri AYNI uçtan, kendi anahtarı hariç öteki süzgeçlerle (faceted). */
export function yarnAtSubFilters(base: Omit<YarnAtSubFilters, "lotId" | "search">): FilterDef[] {
  return [
    { kind: "lookup", key: "subcontractorId", label: "Fasoncu", service: subcontractorService, queryKey: "subcontractors-yarn-at-filter" },
    { kind: "lookup", key: "yarnItemId", label: "İplik", service: itemService, queryKey: "items-yarn-at-filter", extraFilters: YARN_ITEM_FILTER },
    {
      kind: "lookup", key: "lotId", label: "Lot", service: yarnAtSubLotOptions(base),
      queryKey: `yarn-at-sub-lots:${base.subcontractorId ?? ""}:${base.yarnItemId ?? ""}:${base.status ?? ""}`,
      getLabel: (it) => (it.code ? `${it.name} · ${it.code}` : it.name ?? it.id),
    },
    { kind: "select", key: "status", label: "Sipariş durumu", options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
  ];
}

function useFilters() {
  const [sp, setSp] = useSearchParams();
  const view: YarnAtSubView = sp.get("view") === "yarn" ? "yarn" : "subcontractor";
  const get = (k: string) => sp.get(`filter[${k}]`) ?? undefined;
  // URL değişmedikçe aynı nesne — süzgeç tanımları (lot seçenek kaynağı) gereksiz yere yeniden kurulmasın.
  const base = useMemo(() => ({ subcontractorId: sp.get("filter[subcontractorId]") ?? undefined, yarnItemId: sp.get("filter[yarnItemId]") ?? undefined, status: sp.get("filter[status]") ?? undefined }), [sp]);
  const setView = (v: string) => {
    const next = new URLSearchParams(sp);
    if (v === "yarn") next.set("view", "yarn");
    else next.delete("view");
    setSp(next, { replace: true });
  };
  return { view, setView, base, lotId: get("lotId") };
}

export function YarnAtSubcontractorPage() {
  const { view, setView, base, lotId } = useFilters();
  const { search, setSearch, term } = useListSearch();
  const f: YarnAtSubFilters = { ...base, lotId, search: term };
  const filtered = Boolean(base.subcontractorId || base.yarnItemId || base.status || lotId || term);
  const q = useQuery({ queryKey: yarnAtSubQueryKey(f), queryFn: () => listYarnAtSubcontractor(f) });
  const { hasPermission } = useRoleAccess();
  const showOwner = useEmanetEnabled();
  const showValue = hasPermission("goods-receipt:read");
  const canWrite = hasPermission("warping-order:write");
  const [action, setAction] = useState<RowActionTarget | null>(null);
  const [statement, setStatement] = useState(false);
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const lines = useMemo(() => toLines(rows, view), [rows, view]);
  const columns = useMemo(
    () => yarnAtSubColumns(view, { showOwner, showValue, onAction: canWrite ? (row: YarnAtSubLine, a: YarnRowAction) => setAction({ row, action: a }) : undefined }),
    [view, showOwner, showValue, canWrite],
  );
  const table = useLocalTable<YarnAtSubLine>({ tableKey: `yarn-at-subcontractor:${view}`, data: lines, columns, getRowId: rowKey });
  const s = useMemo(() => summarize(rows), [rows]);
  const split = useMemo(() => splitDefFilters(yarnAtSubFilters(base), ["subcontractorId", "yarnItemId", "lotId", "status"]), [base]);

  return (
    <PageShell>
      <PageHeader
        title="Fasondaki İplik"
        description="Devere için fasoncuya gönderilen ve henüz dönmemiş iplik: hangi fasoncuda, hangi iplikten, hangi lot ve siparişle, kaç gündür. Devreden = siparişi kapanmış ama fasoncuda kalmış iplik."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setStatement(true)}><FileText className="mr-1 h-4 w-4" /> Fasoncu ekstresi</Button>
            <RefreshButton queryKey={YARN_AT_SUB_QUERY_KEY} />
          </>
        }
      />
      <Tabs value={view} onValueChange={setView}>
        <PageTabsList aria-label="Kırılım">
          <PageTabsTrigger value="subcontractor">Fasoncuya göre</PageTabsTrigger>
          <PageTabsTrigger value="yarn">İpliğe göre</PageTabsTrigger>
        </PageTabsList>
      </Tabs>
      <FilterRow search={search} onSearchChange={setSearch} searchHint="Lot no, iplik adı/kodu, fasoncu ya da sipariş no ara" primary={split.primary} more={split.more} tools={{ table, exportName: "Fasondaki iplik" }} />
      <DataTable<YarnAtSubLine>
        table={table}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        errorText="Bu bir “fasonda iplik yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
        emptyText={filtered ? "Bu filtreye ya da aramaya uyan fasondaki iplik yok. Filtreyi temizleyip tekrar bakın." : "Şu an hiçbir fasoncuda iplik yok. Devere siparişine iplik sevk edilince burada görünür."}
        rowClassName={(r) => (r.groupFirst ? "border-t-2 border-t-border" : undefined)}
      />
      {!q.isLoading && !q.isError && <ListFooter loaded={lines.length} summary={<SummaryStats s={s} filtered={filtered} showValue={showValue} />} />}
      {action && <RowActionHost target={action} onClose={() => setAction(null)} />}
      {statement && <StatementDialog initialSubcontractorId={base.subcontractorId} canSeeValue={showValue} onClose={() => setStatement(false)} />}
    </PageShell>
  );
}
