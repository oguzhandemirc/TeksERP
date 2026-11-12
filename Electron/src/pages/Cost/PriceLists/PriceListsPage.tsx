// =============================================================================
// MALİYET & TEKLİF › FİYAT LİSTELERİ (MAL-5) — `price-list:read`. Genel ya da müşteriye özel, dövizli satış fiyatı
// listeleri; teklif kalemi fiyat önerisinde ÖNCE yayındaki listeye bakar. Süzme + cursor + özet SUNUCUDA.
// =============================================================================
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CostQueryError } from "../shared/CostQueryState";
import { PriceListCreateDialog } from "./PriceListCreateDialog";
import { PriceListFilters } from "./PriceListFilters";
import { PRICE_LIST_COLUMNS } from "./columns";
import { priceListService } from "./service";
import { EMPTY_PRICE_LIST_FILTER, type PriceListFilter } from "./pl-types";
import { RefreshButton } from "@/components/RefreshButton";

const PAGE = 50;

export function PriceListsPage() {
  const nav = useNavigate();
  const [f, setF] = useState<PriceListFilter>(EMPTY_PRICE_LIST_FILTER);
  const [creating, setCreating] = useState(false);
  const query = { ...f, q: useDebouncedValue(f.q) };
  const q = useInfiniteQuery({
    queryKey: ["price-lists", "list", query],
    queryFn: ({ pageParam }) => priceListService.list(query, pageParam, PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.data);
  const table = useLocalTable({ tableKey: "cost:price-lists", data: rows, columns: PRICE_LIST_COLUMNS, getRowId: (r) => r.id });
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_PRICE_LIST_FILTER);
  return (
    <PageShell>
      <PageHeader
        title="Fiyat Listeleri"
        description="Genel ya da müşteriye özel satış fiyatları. Teklif kalemine fiyat önerilirken önce yayındaki liste kullanılır. Yayınlanan liste değişmez — değişiklik revizyondur."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["price-lists", "list"]} />
            <PermissionGate permission="price-list:write">
              <Button onClick={() => setCreating(true)} data-testid="pl-new"><Plus className="mr-1 h-4 w-4" />Yeni liste</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar className="flex-row flex-wrap items-start">
        <PriceListFilters value={f} onChange={setF} summary={q.data?.pages[0]?.ozet} />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Fiyat listeleri" />
        </div>
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} onRowClick={(r) => nav(`/cost/price-lists/${r.id}`)} exportName="Fiyat listeleri" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Fiyat listeleri" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="pl-empty">
              {filtered ? "Süzgece uyan liste yok." : "Henüz fiyat listesi yok — \"Yeni liste\" ile başlayın; satırları standart maliyetten doldurabilirsiniz."}
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
      {creating && <PriceListCreateDialog open onOpenChange={setCreating} onCreated={(id) => nav(`/cost/price-lists/${id}`)} />}
    </PageShell>
  );
}
