// =============================================================================
// MALİYET & TEKLİF › TEKLİFLER (MAL-5, plan §5) — `quote:read`. Süzme + cursor + özet şeridi SUNUCUDA (tek where);
// panel parametre taşır, sunucu sayısını biçimler. Cari kartından `?customerId=` ile müşteriye süzülü açılır.
// =============================================================================
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
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
          <PermissionGate permission="quote:write">
            <Button onClick={() => nav("/cost/quotes/new")}><Plus className="mr-1 h-4 w-4" />Yeni teklif</Button>
          </PermissionGate>
        }
      />
      <PageBody className="space-y-3 p-4 sm:p-6">
        <QuoteFilters value={f} onChange={setF} />
        {summary && <QuoteSummaryStrip summary={summary} filter={f} onChange={setF} />}
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <CostQueryError error={q.error} what="Teklifler" onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="quotes-empty">
            {filtered ? "Süzgece uyan teklif yok." : "Henüz teklif yok — \"Yeni teklif\" ile başlayın ya da Hızlı Hesaplayıcı'dan \"Teklife ekle\" deyin."}
          </div>
        ) : (
          <>
            <QuotesTable rows={rows} onOpen={(id) => nav(`/cost/quotes/${id}`)} />
            {q.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                  {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
                </Button>
              </div>
            )}
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
