// Taslak teklifin başlığı — düzenlenir ve "Başlığı kaydet" ile PATCH'lenir (yalnız DRAFT; sunucu claim'i 409 verir).
import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuoteHeaderFields } from "./QuoteHeaderFields";
import { headerFromQuote, quoteService, type QuoteHeaderForm } from "./service";
import type { QuoteDetail } from "./quote-types";
import { useQuoteMutation } from "./useQuoteMutation";

export function QuoteDraftHeader({ quote }: { quote: QuoteDetail }) {
  const [h, setH] = useState<QuoteHeaderForm>(() => headerFromQuote(quote));
  const saved = headerFromQuote(quote);
  const dirty = JSON.stringify(h) !== JSON.stringify(saved);
  const save = useQuoteMutation({ quoteId: quote.id, fn: () => quoteService.update(quote.id, h, saved) });
  return (
    <section className="space-y-3 rounded-md border p-3" aria-label="Teklif başlığı">
      <QuoteHeaderFields value={h} onChange={(patch) => setH((x) => ({ ...x, ...patch }))} mode="update" fxSource={quote.fxRateSource} customerName={quote.customer.name} />
      <div className="flex justify-end">
        <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          <Save className="mr-1 h-4 w-4" />{save.isPending ? "Kaydediliyor…" : "Başlığı kaydet"}
        </Button>
      </div>
    </section>
  );
}
