// =============================================================================
// MALİYET › MALİYET KARTLARI (MAL-3, plan §5) — kumaş başına yapı durumu, aktif standart maliyet, "Girdi değişti".
// Süzme + cursor + özet şeridi SUNUCUDA (tek küme); panel yalnız parametre taşır ve sunucu sayısını biçimler.
// =============================================================================
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Calculator, Search } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CostQueryError } from "../shared/CostQueryState";
import { COST_ITEM_COLUMNS } from "./columns";
import { CostItemsSummary } from "./CostItemsSummary";
import { costItemService, type CostItemFilter } from "./service";
import { RefreshButton } from "@/components/RefreshButton";

const PAGE = 50;
const EMPTY: CostItemFilter = { q: "", durum: "", girdiDegisti: false };

export function CostItemsPage() {
  const nav = useNavigate();
  const [f, setF] = useState<CostItemFilter>(EMPTY);
  const query = { ...f, q: useDebouncedValue(f.q) };
  const q = useInfiniteQuery({
    queryKey: ["cost-items", "list", query],
    queryFn: ({ pageParam }) => costItemService.list(query, pageParam, PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.data);
  const table = useLocalTable({ tableKey: "cost:items", data: rows, columns: COST_ITEM_COLUMNS, getRowId: (r) => r.itemId });
  const summary = q.data?.pages[0]?.ozet;
  const filtered = f.durum !== "" || f.girdiDegisti || f.q.trim() !== "";
  return (
    <PageShell>
      <PageHeader
        title="Maliyet Kartları"
        description="Her kumaşın yapı durumu ve kayıtlı standart metre maliyeti. 'Girdi değişti' = kayıttan sonra fiyat/parametre/yapı değişti; kayıtlı sayı değişmez."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-items", "list"]} />
            <Button variant="outline" onClick={() => nav("/cost/calculator")}><Calculator className="mr-1 h-4 w-4" />Hızlı hesapla</Button>
          </div>
        }
      />
      <ListToolbar className="flex-row flex-wrap items-center">
        {summary && <CostItemsSummary summary={summary} filter={f} onChange={setF} />}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Ara…" title="Ürün kodu ya da adı" aria-label="Ürün maliyeti ara: ürün kodu ya da adı" value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Ürün maliyetleri" />
        </div>
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} onRowClick={(r) => nav(`/cost/items/${r.itemId}`)} exportName="Ürün maliyetleri" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Maliyet kartları" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {filtered ? "Süzgece uyan kumaş yok." : "Aktif kumaş kartı yok — maliyet kartı kumaş (FABRIC) ürünleri için açılır."}
            </div>
          </ListMessage>
        )}
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
    </PageShell>
  );
}
