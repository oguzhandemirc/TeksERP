// Fiyat geçmişi çekmecesi: bir kademenin (ya da kalem fiyatının) bütün sürümleri, yeniden eskiye.
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtFactoryDate } from "@/lib/factory-time";
import { getServicePriceHistory, type Currency, type HistoryState } from "./service";
import { formatPrice } from "./servicePrices";
import { SERVICE_PRICES_KEY } from "./useServicePriceMutations";

const STATE_BADGE: Record<
  HistoryState,
  { label: string; variant: "default" | "secondary" | "muted" | "outline" }
> = {
  ACTIVE: { label: "Yürürlükte", variant: "default" },
  SCHEDULED: { label: "Yürürlükte · değişecek", variant: "secondary" },
  PENDING: { label: "İleri tarihli", variant: "outline" },
  CLOSED: { label: "Kapandı", variant: "muted" },
};

interface Props {
  itemId: string;
  currency: Currency;
  valueId: string | null;
  label: string;
  onClose: () => void;
}

export function PriceHistorySheet({ itemId, currency, valueId, label, onClose }: Props) {
  const q = useQuery({
    queryKey: [...SERVICE_PRICES_KEY, "history", itemId, currency, valueId],
    queryFn: () => getServicePriceHistory({ itemId, currency, propertyValueId: valueId }),
  });
  const rows = q.data ?? [];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{label} — fiyat geçmişi</SheetTitle>
          <SheetDescription>
            Her değişiklik yeni sürümdür; eski fiyat silinmez. Kesilmiş faturalar kendi fiyatını saklar.
          </SheetDescription>
        </SheetHeader>
        {q.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-destructive">Geçmiş yüklenemedi.</p>
            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Bu kademe için henüz fiyat girilmemiş.</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {rows.map((h) => (
              <li key={h.id} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium tabular-nums">
                    {formatPrice(h.price)} {currency}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {h.customerName ?? "Genel"}
                    </span>
                  </span>
                  <Badge variant={STATE_BADGE[h.state].variant}>{STATE_BADGE[h.state].label}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {fmtFactoryDate(h.validFrom)} → {h.until ? fmtFactoryDate(h.until) : "açık"}
                  {h.revokeReason ? ` · ${h.revokeReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
