// =============================================================================
// TEKLİFLER › YENİ TEKLİF (MAL-5) — `quote:write`. Başlık kaydı DRAFT teklif doğurur (numara doğuşta, sunucuda);
// kalemler detay ekranında eklenir. Kayıt idempotent: `clientToken` mantıksal deneme başına, yalnız belirsiz hatada yapışır.
// Hızlı Hesaplayıcı'dan gelen bekleyen kalem (`state.pendingLine`) detay ekranına taşınır.
// =============================================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useAttemptToken } from "@/lib/attemptToken";
import { QuoteHeaderFields } from "./QuoteHeaderFields";
import { quoteErrorMessage } from "./quote-errors";
import { EMPTY_HEADER, quoteService, type QuoteHeaderForm } from "./service";
import { suggestionHint, useQuoteCurrencySuggestion } from "./quote-currency";

export function QuoteNewPage() {
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [draft, setH] = useState<QuoteHeaderForm>(EMPTY_HEADER);
  // SY-J1: kullanıcı para birimine dokunmadıkça sunucunun ön seçimi uygulanır (türetilmiş; efekt yok).
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const suggestion = useQuoteCurrencySuggestion(draft.customerId).data;
  const h: QuoteHeaderForm = !currencyTouched && suggestion && draft.customerId ? { ...draft, currency: suggestion.doviz } : draft;
  const create = useMutation({
    mutationFn: () => quoteService.create(h, attempt.token()),
    onSuccess: (r) => {
      attempt.onSuccess();
      toast.success(r.message ?? "Teklif oluşturuldu.");
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      void nav(`/cost/quotes/${r.data.id}`, { replace: true, state: location.state });
    },
    onError: (e) => {
      attempt.onFailure(e);
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istek `suppressErrorToast` taşır (service.ts OWN).
      toast.error(quoteErrorMessage(e));
    },
  });
  return (
    <PageShell>
      <PageHeader title="Yeni teklif" description="Önce başlığı kaydedin; kalemler (kart ürünü ya da yeni desen) sonraki ekranda eklenir ve sunucu fiyat önerir." />
      <PageBody className="space-y-4 p-4 sm:p-6">
        <QuoteHeaderFields
          value={h}
          onChange={(patch) => {
            if (patch.currency !== undefined) setCurrencyTouched(true);
            setH((x) => ({ ...x, ...patch }));
          }}
          mode="create"
          currencyHint={currencyTouched ? undefined : suggestionHint(suggestion)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => nav("/cost/quotes")}>Vazgeç</Button>
          <Button disabled={!h.customerId || create.isPending} onClick={() => create.mutate()} data-testid="quote-create">
            {create.isPending ? "Kaydediliyor…" : "Taslağı oluştur"}
          </Button>
        </div>
      </PageBody>
    </PageShell>
  );
}
