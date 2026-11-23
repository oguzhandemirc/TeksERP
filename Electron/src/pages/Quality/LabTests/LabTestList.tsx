// Lab testleri listesi — tek satır süzgeç + tablo (sonsuz kaydırma) + alt çubukta özet. Özet ve tablo AYNI
// sunucu yanıtından (tek where); süzgeç değişince cursor başa döner (sorgu anahtarı süzgeçten türer).
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { labTestService, labTestTypeService, type LabSummary } from "./service";
import { LAB_TEST_COLUMNS } from "./labTestColumns";
import { EMPTY_LAB_FILTERS, isLabFilterDirty, labEmptyMessage, type LabFilterState } from "./labTestRules";
import { BandStats, ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";

const PAGE = 50;
const VERDICT_OPTIONS = [
  { value: "FAIL", label: "Kalan sonucu var" },
  { value: "PASS", label: "Hepsi geçti" },
] as const;
const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Taslak" },
  { value: "APPROVED", label: "Onaylı" },
  { value: "VOIDED", label: "İptal" },
] as const;

export function LabTestList({ onOpen }: { onOpen: (id: string) => void }) {
  const [f, setF] = useState<LabFilterState>(EMPTY_LAB_FILTERS);
  const set = <K extends keyof LabFilterState>(k: K, v: LabFilterState[K]) => setF((x) => ({ ...x, [k]: v }));
  const types = useQuery({ queryKey: ["lab-test-types", "all"], queryFn: () => labTestTypeService.list(false), staleTime: 60_000 });
  // Metin süzgeçleri yazarken her tuşta istek atmasın; seçim süzgeçleri anında.
  const query = { ...f, q: useDebouncedValue(f.q), batchNo: useDebouncedValue(f.batchNo) };
  const q = useInfiniteQuery({
    queryKey: ["lab-tests", "list", query],
    queryFn: ({ pageParam }) => labTestService.list({ ...query, cursor: pageParam, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
  const table = useLocalTable({ tableKey: "lab-tests", data: rows, columns: LAB_TEST_COLUMNS, getRowId: (r) => r.id });
  const summary = q.data?.pages[0]?.summary;
  const typeOptions = (types.data ?? []).map((t) => ({ value: t.id, label: t.name }));

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={f.q} onSearchChange={(v) => set("q", v)} searchHint="Test no, numune ya da top barkodu" />
        <Input className="h-8 w-28 text-xs" placeholder="Parti no" aria-label="Parti no" value={f.batchNo} onChange={(e) => set("batchNo", e.target.value)} />
        <SelectChip id="lab-type" label="Test türü" value={f.testTypeId || null} options={typeOptions} onChange={(v) => set("testTypeId", v ?? "")} />
        <SelectChip id="lab-verdict" label="Sonuç" value={f.verdict || null} options={VERDICT_OPTIONS} onChange={(v) => set("verdict", v ?? "")} />
        <SelectChip id="lab-status" label="Durum" value={f.status || null} options={STATUS_OPTIONS} onChange={(v) => set("status", v ?? "")} />
        <DayRangeChip id="lab-date" label="Tarih" from={f.from} to={f.to} onChange={({ from, to }) => setF((x) => ({ ...x, from, to }))} />
        {isLabFilterDirty(f) && (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setF(EMPTY_LAB_FILTERS)}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Temizle
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Lab testleri" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        onRowClick={(r) => onOpen(r.id)}
        exportName="Lab testleri"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Lab testleri yüklenemedi."
        onRetry={() => void q.refetch()}
        emptyText={labEmptyMessage(f)}
        loadMore={{ hasMore: Boolean(q.hasNextPage), isFetchingMore: q.isFetchingNextPage, onLoadMore: () => q.fetchNextPage() }}
      />
      <ListFooter
        loaded={rows.length}
        hasMore={rows.length > 0 ? Boolean(q.hasNextPage) : undefined}
        isFetchingMore={q.isFetchingNextPage}
        summary={summary ? <SummaryStrip s={summary} /> : undefined}
      />
    </>
  );
}

/** Yalnız sunucu özetini çizer — sayı istemcide toplanmaz (sayfalı listeyle ayrışmasın). */
function SummaryStrip({ s }: { s: LabSummary }) {
  return (
    <div data-testid="lab-summary">
      <BandStats
        label="Lab testi özeti"
        items={[
          { key: "total", label: "Toplam", value: s.total },
          { key: "draft", label: "Taslak", value: s.draft },
          { key: "approved", label: "Onaylı", value: s.approved },
          { key: "voided", label: "İptal", value: s.voided },
          { key: "failing", label: "Kalan sonucu olan", value: s.failing, tone: s.failing > 0 ? "danger" : undefined },
        ]}
      />
    </div>
  );
}
