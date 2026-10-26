// Hızlı Hesaplayıcı › "Teklife ekle": hesaplanan kumaşı/elle yapıyı yeni teklif taslağına ya da açık bir TASLAK
// teklife kalem olarak taşır. Seçim doğrudan modalda; kalem formu teklif ekranında açılır (miktar/fiyat orada).
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCalendarDay } from "@/lib/factory-time";
import { quoteNumberLabel } from "./labels";
import type { PendingLine } from "./line-body";
import { quoteService } from "./service";
import { EMPTY_QUOTE_FILTER } from "./quote-types";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; pending: PendingLine }

export function AddToQuoteDialog({ open, onOpenChange, pending }: Props) {
  const nav = useNavigate();
  const drafts = useQuery({
    queryKey: ["quotes", "list", "drafts-for-calculator"],
    queryFn: () => quoteService.list({ ...EMPTY_QUOTE_FILTER, status: "DRAFT" }, null, 50),
    enabled: open,
  });
  const go = (to: string) => void nav(to, { state: { pendingLine: pending } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Teklife ekle</DialogTitle>
          <DialogDescription>Kalem teklif ekranında açılır; miktarı girin, fiyatı sunucu önerir. Ezmeler (devir, fire…) teklife taşınmaz — kalem kartın/yapının kendi değerleriyle fiyatlanır.</DialogDescription>
        </DialogHeader>
        <Button onClick={() => go("/cost/quotes/new")} data-testid="atq-new"><Plus className="mr-1 h-4 w-4" />Yeni teklif taslağı</Button>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {drafts.isLoading && <p className="text-sm text-muted-foreground">Taslaklar yükleniyor…</p>}
          {drafts.data?.data.length === 0 && <p className="text-sm text-muted-foreground">Açık taslak teklif yok.</p>}
          {drafts.data?.data.map((q) => (
            <button key={q.id} type="button" onClick={() => go(`/cost/quotes/${q.id}`)} className="flex w-full items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-muted">
              <span><span className="font-mono text-xs">{quoteNumberLabel(q)}</span> · {q.customer.name}</span>
              <span className="text-xs text-muted-foreground">{formatCalendarDay(q.quoteDate)} · {q._count.lines} kalem</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
