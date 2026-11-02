import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { fetchKursunGramHistory, historyRowText, kursunGramHistoryKey, type KursunGramHistoryOwner } from "./kursunGramHistoryApi";

/**
 * K14: gram fiyatı alanının yanındaki salt-okunur "Fiyat geçmişi". Açılınca okunur (kapalıyken istek yok);
 * en yeni önce, "Daha fazla" cursor ile sunucudan.
 */
export function KursunGramPriceHistory({ owner }: { owner: KursunGramHistoryOwner }) {
  const [open, setOpen] = useState(false);
  const q = useInfiniteQuery({
    queryKey: kursunGramHistoryKey(owner),
    queryFn: ({ pageParam }) => fetchKursunGramHistory(owner, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-1" data-testid="kursun-gram-history">
      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Fiyat geçmişini gizle" : "Fiyat geçmişi"}
      </Button>
      {open && (
        <div className="rounded-md border p-2 text-xs">
          {q.isLoading && <p className="text-muted-foreground">Yükleniyor…</p>}
          {q.isError && <p className="text-destructive">Fiyat geçmişi okunamadı.</p>}
          {!q.isLoading && !q.isError && items.length === 0 && <p className="text-muted-foreground">Henüz gram fiyatı girilmemiş.</p>}
          {items.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-normal">Tarih</th>
                  <th className="font-normal">Fiyat</th>
                  <th className="font-normal">Kim</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const t = historyRowText(i);
                  return (
                    <tr key={i.id} data-testid="kursun-gram-history-row">
                      <td>{t.when}</td>
                      <td>{t.price}</td>
                      <td>{t.who}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {q.hasNextPage && (
            <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 text-xs" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              Daha fazla
            </Button>
          )}
          <p className="mt-1 text-muted-foreground">Fatura, işin yapıldığı gündeki fiyatı kullanır (Genel Ayarlar → Gram fiyatı).</p>
        </div>
      )}
    </div>
  );
}
