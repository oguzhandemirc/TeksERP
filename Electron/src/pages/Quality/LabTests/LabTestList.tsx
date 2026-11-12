// Lab testleri listesi — süzgeçler + özet şeridi + cursor ile "Daha fazla yükle". Şerit ve tablo AYNI
// sunucu yanıtından (tek where); süzgeç değişince cursor başa döner (sorgu anahtarı süzgeçten türer).
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { cn } from "@/lib/utils";
import { labTestService, labTestTypeService, type LabSummary } from "./service";
import { LAB_TEST_COLUMNS } from "./labTestColumns";
import { EMPTY_LAB_FILTERS, isLabFilterDirty, labEmptyMessage, type LabFilterState } from "./labTestRules";
import { QualityListState } from "../QualityListState";
import { ListBand, ListBody, ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";

const PAGE = 50;
const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";

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

  return (
    <>
      {summary && (
        <ListBand>
          <SummaryStrip s={summary} active={f.status} onPick={(s) => set("status", s)} />
        </ListBand>
      )}
      <ListToolbar>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Ara…" title="Test no, numune ya da top barkodu" aria-label="Lab testi ara: test no, numune ya da top barkodu" value={f.q} onChange={(e) => set("q", e.target.value)} />
          </div>
          <Input className="w-full sm:w-36" placeholder="Parti no" aria-label="Parti no" value={f.batchNo} onChange={(e) => set("batchNo", e.target.value)} />
          <select aria-label="Test türü" className={SELECT} value={f.testTypeId} onChange={(e) => set("testTypeId", e.target.value)}>
            <option value="">Tüm test türleri</option>
            {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select aria-label="Sonuç" className={SELECT} value={f.verdict} onChange={(e) => set("verdict", e.target.value as LabFilterState["verdict"])}>
            <option value="">Tüm sonuçlar</option>
            <option value="FAIL">Kalan sonucu var</option>
            <option value="PASS">Hepsi geçti</option>
          </select>
          <select aria-label="Durum" className={SELECT} value={f.status} onChange={(e) => set("status", e.target.value as LabFilterState["status"])}>
            <option value="">Tüm durumlar</option>
            <option value="DRAFT">Taslak</option>
            <option value="APPROVED">Onaylı</option>
            <option value="VOIDED">İptal</option>
          </select>
          <DateRangeInput from={f.from} to={f.to} onFrom={(v) => set("from", v)} onTo={(v) => set("to", v)} inputClassName="h-9 w-[9.5rem]" />
          {isLabFilterDirty(f) && (
            <Button variant="ghost" size="sm" onClick={() => setF(EMPTY_LAB_FILTERS)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Süzgeçleri temizle
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <DataTableTools table={table} compact exportName="Lab testleri" />
          </div>
        </div>
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} onRowClick={(r) => onOpen(r.id)} exportName="Lab testleri" />
      ) : (
      <ListBody>
        <QualityListState isLoading={q.isLoading} isError={q.isError} errorTitle="Lab testleri yüklenemedi." noneText="test yok" emptyText={labEmptyMessage(f)} onRetry={() => void q.refetch()} />
      </ListBody>
      )}
      {/* [EL-09] sapması devralındı: elle "Daha fazla yükle" (davranış korunarak alt şeride taşındı). */}
      <ListFooter loaded={rows.length}>
        {q.hasNextPage && (
          <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
          </Button>
        )}
      </ListFooter>
    </>
  );
}

function SummaryStrip({ s, active, onPick }: { s: LabSummary; active: string; onPick: (v: LabFilterState["status"]) => void }) {
  const items: Array<{ key: LabFilterState["status"]; label: string; n: number }> = [
    { key: "", label: "Toplam", n: s.total },
    { key: "DRAFT", label: "Taslak", n: s.draft },
    { key: "APPROVED", label: "Onaylı", n: s.approved },
    { key: "VOIDED", label: "İptal", n: s.voided },
  ];
  return (
    <div className="flex flex-wrap gap-2" data-testid="lab-summary">
      {items.map((i) => (
        <button key={i.label} type="button" onClick={() => onPick(i.key)}
          className={cn("rounded-md border px-3 py-1.5 text-left text-xs", active === i.key && "border-primary bg-primary/5")}>
          <span className="text-muted-foreground">{i.label}</span>
          <span className="ml-2 text-sm font-semibold tabular-nums">{i.n}</span>
        </button>
      ))}
      <div className="rounded-md border border-destructive/30 px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">Kalan sonucu olan</span>
        <span className="ml-2 text-sm font-semibold tabular-nums text-destructive">{s.failing}</span>
      </div>
    </div>
  );
}
