import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Printer, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { printHtmlString } from "@/lib/print";
import { workOrderService } from "./service";
import type { WorkOrder, TravelerCard } from "./types";

interface Props {
  workOrder: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Refakat Kartı — ÖNİZLEME = BASKI = MOBİL (tek kaynak). Hem ekran önizlemesi hem
 * baskı backend `GET /traveler-cards/:id/html` çıktısını (iframe srcDoc /
 * printHtmlString) kullanır → format her cihazda birebir aynı. İçerik kartın
 * donmuş snapshot'ından üretilir; QR sunucuda gömülür. (Eski @react-pdf
 * TravelerCardPdfDocument yolu kaldırıldı.)
 */
export function TravelerCardPrintDialog({ workOrder, open, onOpenChange }: Props) {
  const cardQuery = useQuery({
    queryKey: ["traveler-cards", workOrder?.id],
    queryFn: () => workOrderService.getTravelerCardHistory(workOrder!.id),
    enabled: open && Boolean(workOrder?.id),
    staleTime: 30_000,
  });

  const activeCard = useMemo<TravelerCard | null>(() => {
    const cards = cardQuery.data?.data ?? [];
    return cards.find((c) => c.status === "ACTIVE") ?? cards[0] ?? null;
  }, [cardQuery.data?.data]);

  // Sayfa boyutu ezmesi TEK SEFERLİKTİR: yalnız bu baskıyı etkiler, kalıcı ayara
  // ve kartın donmuş snapshot'ına yazılmaz. `undefined` = kartın kendi boyutu.
  const [pageSize, setPageSize] = useState<"A4" | "A5" | undefined>(undefined);

  // ÖNİZLEME + BASKI tek kaynak: kartın backend HTML'i.
  const htmlQuery = useQuery({
    queryKey: ["traveler-card-html", activeCard?.id, pageSize ?? "default"],
    queryFn: () => workOrderService.getTravelerCardHtml(activeCard!.id, pageSize),
    enabled: open && Boolean(activeCard?.id),
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;
  // Kartın kendi (donmuş) boyutu — segmentte hangi düğmenin "varsayılan" olduğunu
  // göstermek için HTML'in @page kuralından okunur; ayrı bir istek açmaya değmez.
  const cardPageSize = /@page \{ size: (A4|A5)/.exec(html ?? "")?.[1] as "A4" | "A5" | undefined;
  const effectiveSize = pageSize ?? cardPageSize;

  const handleRefresh = () => {
    void cardQuery.refetch();
    void htmlQuery.refetch();
  };

  if (!workOrder) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Refakat Kartı — Önizleme</DialogTitle>
          <DialogDescription>
            Basım anında dondurulan resmi kart — önizleme baskıyla birebir aynı.
            Partiler her baskıda güncel okunur.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {cardQuery.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !activeCard ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </span>
              <div className="text-sm font-semibold text-foreground">Kart görüntülenemedi</div>
              <p className="max-w-sm text-xs text-muted-foreground">
                Refakat kartı iş emri açılışında otomatik üretilir (kart = iş emri no,
                karekod sabit). Bu iş emrinin kartı yüklenemedi — <strong>Yenile</strong>'yi
                deneyin.
              </p>
            </div>
          ) : htmlQuery.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : html ? (
            <iframe
              title="Refakat Kartı Önizleme"
              srcDoc={html}
              // sandbox: belge HTML'i ileride kullanıcı-yazımı olabilecek (Faz 2
              // uzman modu) — script çalıştırma yüzeyini şimdiden kapat. Boş
              // sandbox tüm yetenekleri kaldırır; kart yalnız statik HTML+CSS.
              sandbox=""
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Belge yüklenemedi.
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Tek seferlik sayfa boyutu — kalıcı ayarı DEĞİŞTİRMEZ (etiket bunu söyler). */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Bu baskı için:</span>
            <div className="inline-flex overflow-hidden rounded-md border">
              {(["A5", "A4"] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setPageSize(sz === cardPageSize ? undefined : sz)}
                  disabled={!html}
                  className={
                    "px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 " +
                    (effectiveSize === sz
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted")
                  }
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRefresh}
            disabled={cardQuery.isFetching || htmlQuery.isFetching}
            className="gap-1"
            title="Önizleme takılırsa yeniden yükle"
          >
            <RefreshCw
              className={
                cardQuery.isFetching || htmlQuery.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"
              }
            />
            Yenile
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button
            type="button"
            className="gap-1"
            disabled={!html}
            onClick={() => html && printHtmlString(html)}
          >
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
