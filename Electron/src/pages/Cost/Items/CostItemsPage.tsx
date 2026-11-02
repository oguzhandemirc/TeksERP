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
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CostQueryError } from "../shared/CostQueryState";
import { CostItemsTable } from "./CostItemsTable";
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
      <ListToolbar>
        {summary && <CostItemsSummary summary={summary} filter={f} onChange={setF} />}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Ürün kodu ya da adı…" value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} />
        </div>
      </ListToolbar>
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Maliyet kartları" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {filtered ? "Süzgece uyan kumaş yok." : "Aktif kumaş kartı yok — maliyet kartı kumaş (FABRIC) ürünleri için açılır."}
            </div>
          </ListMessage>
        ) : (
          <CostItemsTable rows={rows} onOpen={(id) => nav(`/cost/items/${id}`)} />
        )}
      </ListBody>
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
