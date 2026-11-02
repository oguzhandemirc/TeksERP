// =============================================================================
// MALİYET & TEKLİF › TEKLİFLER (MAL-5, plan §5) — `quote:read`. Süzme + cursor + özet şeridi SUNUCUDA (tek where);
// panel parametre taşır, sunucu sayısını biçimler. Cari kartından `?customerId=` ile müşteriye süzülü açılır.
// =============================================================================
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CostQueryError } from "../shared/CostQueryState";
import { QuoteFilters } from "./QuoteFilters";
import { QuoteSummaryStrip } from "./QuoteSummaryStrip";
import { QuotesTable } from "./QuotesTable";
import { quoteService } from "./service";
import { EMPTY_QUOTE_FILTER, type QuoteFilter } from "./quote-types";
import { RefreshButton } from "@/components/RefreshButton";

const PAGE = 50;

export function QuotesPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState<QuoteFilter>({ ...EMPTY_QUOTE_FILTER, customerId: params.get("customerId") });
  const query = { ...f, q: useDebouncedValue(f.q) };
  const q = useInfiniteQuery({
    queryKey: ["quotes", "list", query],
    queryFn: ({ pageParam }) => quoteService.list(query, pageParam, PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.data);
  const summary = q.data?.pages[0]?.ozet;
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_QUOTE_FILTER);
  return (
    <PageShell>
      <PageHeader
        title="Teklifler"
        description="Müşteriye verilen fiyat teklifleri. Gönderilen teklif değişmez — değişiklik revizyondur; kabul edilen teklif tek tıkla siparişe dönüşür."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["quotes", "list"]} />
            <PermissionGate permission="quote:write">
              <Button onClick={() => nav("/cost/quotes/new")}><Plus className="mr-1 h-4 w-4" />Yeni teklif</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar>
        {summary && <QuoteSummaryStrip summary={summary} filter={f} onChange={setF} />}
        <QuoteFilters value={f} onChange={setF} />
      </ListToolbar>
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Teklifler" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="quotes-empty">
              {filtered ? "Süzgece uyan teklif yok." : "Henüz teklif yok — \"Yeni teklif\" ile başlayın ya da Hızlı Hesaplayıcı'dan \"Teklife ekle\" deyin."}
            </div>
          </ListMessage>
        ) : (
          <QuotesTable rows={rows} onOpen={(id) => nav(`/cost/quotes/${id}`)} />
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
