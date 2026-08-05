import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Inbox, Printer, RefreshCw } from "lucide-react";
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
 * printHtmlString) kullanır → format her cihazda birebir aynı. QR sunucuda gömülür.
 *
 * İÇERİK CANLIDIR (2026-08-05): ACTIVE kartta HTML iş emrinin GÜNCEL hâlinden
 * üretilir ve `print-event` basılan planı kaydeder — içerik değiştiyse otomatik
 * `version++`. Bu yüzden önizlemedeki "v" numarası kartın DB'deki mevcut sürümü
 * değil, **bu baskının alacağı** sürümdür; ikisini karıştırıp ekranda ayrı bir
 * "mevcut sürüm" göstergesi yazma.
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

  const queryClient = useQueryClient();

  /**
   * Yazdır → baskı diyaloğu → BAŞARILIYSA "basıldı" bildir.
   *
   * Bildirim baskının KENDİSİNDEN ayrı bir çağrıdır, çünkü backend GET /html'de
   * bayrağı temizleyemez (o uç önizlemeyi de besler). Bildirim hata verirse
   * SESSİZ geçilir: kâğıt çıktı, operatörün işi bitti — rozetin bir süre daha
   * durması, baskıyı hata toast'ıyla kesmekten iyidir.
   */
  const handlePrint = async () => {
    if (!html || !activeCard) return;
    printHtmlString(html);
    try {
      await workOrderService.recordTravelerCardPrint(activeCard.id);
      // Rozet üç yerde okunuyor (WO detay başlığı, kart geçmişi, bu diyalog).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["traveler-cards", workOrder?.id] }),
        queryClient.invalidateQueries({ queryKey: ["work-order", workOrder?.id] }),
      ]);
    } catch {
      /* yukarıdaki gerekçe — baskı akışını düşürme */
    }
  };

  if (!workOrder) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Refakat Kartı — Önizleme</DialogTitle>
          <DialogDescription>
            Önizleme baskıyla birebir aynı. İçerik her baskıda iş emrinin güncel
            hâlinden üretilir; plan değiştiyse kart yeni versiyona geçer.
          </DialogDescription>
        </DialogHeader>

        {activeCard?.contentDirty && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Sahadaki basılı kopya güncel değil.</strong> Kart basıldıktan
              sonra parti, fason sevki veya iş emri içeriği değişti — eldeki kâğıtta
              eksik/yanlış bilgi olabilir. Aşağıdaki önizleme iş emrinin{" "}
              <em>şu anki hâlidir</em>: yazdırın ve sahadaki eski kâğıtla değiştirin.
              İçerik değiştiyse kart, yazdırdığınızda üstünde yazan versiyona revize
              edilir.
            </span>
          </div>
        )}

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
          <Button type="button" className="gap-1" disabled={!html} onClick={() => void handlePrint()}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
