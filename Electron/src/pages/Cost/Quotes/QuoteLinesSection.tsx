// Kalemler bölümü: tablo + (taslakta) Kalem ekle · Yeni desen · Maliyeti tazele. Teklif toplamı, toplam maliyet ve
// marj SUNUCU alanlarıdır (maliyet/marj yalnız yanıtta varsa görünür).
import { useState } from "react";
import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyCalculator } from "../Calculator/calculator-body";
import { fmtDec, fmtPct } from "../shared/format";
import { AddLineDialog } from "./AddLineDialog";
import type { PendingLine } from "./line-body";
import { QuoteLinesTable } from "./QuoteLinesTable";
import { quoteService } from "./service";
import type { QuoteDetail, QuoteLine } from "./quote-types";
import { useQuoteMutation } from "./useQuoteMutation";

const emptyAdHocSeed = () => emptyCalculator().adHoc;

interface Props { quote: QuoteDetail; editable: boolean; pending?: PendingLine | null }

function Totals({ quote }: { quote: QuoteDetail }) {
  return (
    <div className="space-y-0.5 text-right">
      <p className="text-base font-semibold tabular-nums" data-testid="quote-total">Toplam {fmtDec(quote.totalAmount)} {quote.currency}</p>
      {quote.totalCostTry !== undefined && <p className="text-xs text-muted-foreground tabular-nums">Toplam maliyet {fmtDec(quote.totalCostTry)} TL</p>}
      {quote.marj && (
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="quote-margin">
          Brüt marj {fmtDec(quote.marj.brutMarjTry)} TL ({fmtPct(quote.marj.marjPct)})
        </p>
      )}
    </div>
  );
}

export function QuoteLinesSection({ quote, editable, pending }: Props) {
  const [dialog, setDialog] = useState<{ open: boolean; seed: PendingLine | null; key: number }>({ open: Boolean(pending), seed: pending ?? null, key: 0 });
  const openWith = (seed: PendingLine | null) => setDialog((d) => ({ open: true, seed, key: d.key + 1 }));
  const price = useQuoteMutation({ quoteId: quote.id, fn: (v: { line: QuoteLine; text: string }) => quoteService.updateLine(quote.id, v.line.id, { unitPrice: v.text }) });
  const del = useQuoteMutation({ quoteId: quote.id, fn: (l: QuoteLine) => quoteService.deleteLine(quote.id, l.id) });
  const refresh = useQuoteMutation({ quoteId: quote.id, fn: () => quoteService.refreshCosts(quote.id) });
  const busy = price.isPending || del.isPending || refresh.isPending;
  return (
    <section className="space-y-3" aria-label="Kalemler">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Kalemler</h2>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => openWith(null)} data-testid="open-add-line"><Plus className="mr-1 h-4 w-4" />Kalem ekle</Button>
            <Button size="sm" variant="outline" onClick={() => openWith({ mode: "adHoc", adHoc: emptyAdHocSeed(), rateCode: "" })}>
              <Sparkles className="mr-1 h-4 w-4" />Yeni desen
            </Button>
            <Button size="sm" variant="outline" disabled={busy || quote.lines.length === 0} onClick={() => refresh.mutate()}>
              <RefreshCw className="mr-1 h-4 w-4" />Maliyeti tazele
            </Button>
          </div>
        )}
      </div>
      {quote.lines.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {editable ? "Kalem yok — \"Kalem ekle\" ile kart ürünü, \"Yeni desen\" ile elle yapı ekleyin." : "Bu teklifte kalem yok."}
        </p>
      ) : (
        <QuoteLinesTable
          lines={quote.lines}
          currency={quote.currency}
          editable={editable}
          busy={busy}
          onPrice={(line, text) => price.mutate({ line, text })}
          onDelete={(l) => del.mutate(l)}
        />
      )}
      <Totals quote={quote} />
      {editable && (
        <AddLineDialog
          key={dialog.key}
          quoteId={quote.id}
          customerId={quote.customerId}
          currency={quote.currency}
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          pending={dialog.seed}
        />
      )}
    </section>
  );
}
