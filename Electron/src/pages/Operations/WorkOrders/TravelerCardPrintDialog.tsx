import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
import { DocVersionHistory } from "@/components/print/DocVersionBar";
import { printHtmlString } from "@/lib/print";
import { PrintPageSizeToggle, readDocPageSize } from "@/components/print/PrintPageSizeToggle";
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
 *
 * ⚠️ "GÜNCEL DEĞİL" BANDI KALDIRILDI (2026-08-06, kullanıcı kararı). `contentDirty`
 * *sahada malla gezen kâğıdın* eskidiğini söylüyordu, ekrandaki belgenin değil — ama
 * operatör uyarıyı bastığı belgenin yanında görüp "ekrandaki eski" diye okuyordu ve
 * içerik canlı çözüldüğünden bu okuma HER ZAMAN yanlıştı. İşaret ayrıca canlı bir iş
 * emrinde sürekli yanıyordu (parti doğumu / fason sevki / WO düzenlemesi işaretler,
 * yalnız baskı olayı temizler) → gürültü sinyali yuttu. Backend tarafı DURUYOR
 * (kolon + `print-event` temizliği + audit `wasDirty`); yalnız gösterim kalktı.
 * Geri getirmek istenirse çözüm bu bandı geri koymak DEĞİL, işareti gerçek
 * karşılaştırmaya bağlamaktır (`planKey` + basılan parti parmak izi).
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

  /**
   * Geçmişten seçilen sürüm — `null` = güncel plan (VARSAYILAN ve saha kuralı:
   * kartı açan kişi her zaman yürürlükteki planı görür, ayrı bir "revize et"
   * tuşuna basması gerekmez).
   */
  const [viewVersion, setViewVersion] = useState<number | null>(null);

  // ÖNİZLEME + BASKI tek kaynak: kartın backend HTML'i.
  const htmlQuery = useQuery({
    queryKey: ["traveler-card-html", activeCard?.id, pageSize ?? "default", viewVersion ?? "current"],
    queryFn: () =>
      workOrderService.getTravelerCardHtml(activeCard!.id, pageSize, viewVersion ?? undefined),
    enabled: open && Boolean(activeCard?.id),
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;
  // Kartın kendi (donmuş) boyutu — segmentte hangi düğmenin "varsayılan" olduğunu
  // göstermek için HTML'in @page kuralından okunur; ayrı bir istek açmaya değmez.
  const cardPageSize = readDocPageSize(html);

  const handleRefresh = () => {
    void cardQuery.refetch();
    void htmlQuery.refetch();
  };

  const queryClient = useQueryClient();

  /**
   * Yazdır → baskı diyaloğu → BAŞARILIYSA "basıldı" bildir.
   *
   * Bildirim baskının KENDİSİNDEN ayrı bir çağrıdır, çünkü backend GET /html'de
   * bayrağı temizleyemez (o uç önizlemeyi de besler). Baskı TAMAMEN istemci
   * tarafındadır (`printHtmlString` → izole iframe → yazıcı): bildirim düşse de
   * kâğıt çıkmıştır.
   *
   * ⚠️ HATA MESAJI SONUCU SÖYLER, HTTP'yi DEĞİL (2026-08-06 saha bildirimi:
   * "kart çıkıyor ama sunucu hatası yazıyor"). Eskiden bu dal sessizdi ama
   * SESSİZLİK GERÇEKLEŞMİYORDU: genel interceptor 5xx'te "Sunucu hatası",
   * sunucu kapalıyken "Sunucuya ulaşılamıyor" basıyor, catch ise ondan SONRA
   * çalışıyordu. Elinde kâğıt tutan operatör bunu "baskı başarısız" diye okuyup
   * tekrar bastırıyordu. Artık istek `suppressErrorToast` taşıyor (bkz. service.ts)
   * ve mesajı burası basıyor. Sessiz geçmek de doğru DEĞİL: bildirim düştüğünde
   * kâğıda basılan versiyon numarası DB'ye yazılmaz (otomatik revizyon), yani
   * kayıt ile kâğıt ayrışır — bunu söylemeyen bir arayüz yanlış güven verir.
   */
  const handlePrint = async () => {
    if (!html || !activeCard) return;
    printHtmlString(html);
    try {
      await workOrderService.recordTravelerCardPrint(activeCard.id);
      // Rozet üç yerde okunuyor (WO detay başlığı, kart geçmişi, bu diyalog).
      //
      // ⚠️ Anahtarlar EKRANLARIN kullandığıyla BİREBİR olmalı (2026-08-17 dersi,
      // `LinkOrderDialog.tsx`'te yazılı — bu ONUN İKİNCİ VAKASI): burada da
      // `["work-order", id]` invalidate ediliyordu ve repoda böyle bir sorgu YOK.
      // Detay yüzeyleri `["work-order-detail", id]` (WorkOrderDetailSheet:67 +
      // WorkOrderDetailPage:41), parti şeridi `["work-order-branches", id]`.
      // Ölü anahtar hata vermez — sessizce hiçbir şeyi tazelemez; baskı sonrası
      // detay başlığındaki kart rozeti/versiyonu eski kalıyordu.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["traveler-cards", workOrder?.id] }),
        queryClient.invalidateQueries({ queryKey: ["work-order-detail", workOrder?.id] }),
        queryClient.invalidateQueries({ queryKey: ["work-order-branches", workOrder?.id] }),
        // Baskı yeni bir sürüm doğurmuş olabilir (içerik değiştiyse) — geçmiş
        // listesi bayat kalırsa kullanıcı az önce bastığı sürümü göremez.
        queryClient.invalidateQueries({
          queryKey: ["printed-doc-versions", "TRAVELER_CARD", activeCard.id],
        }),
      ]);
    } catch {
      toast.warning("Kart yazdırıldı — baskı kaydı sunucuya işlenemedi.", {
        description:
          "Kâğıt geçerlidir; tekrar bastırmanız gerekmez. Kartın baskı tarihi ve versiyonu güncellenmedi.",
        duration: 8000,
      });
    }
  };

  if (!workOrder) return null;

  const viewingOld = viewVersion !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Kapanışta güncele dön: bir dahaki açılışta ESKİ bir sürümün açık kalması,
        // sahadaki en tehlikeli hata (yürürlükten kalkmış planı basmak).
        if (!next) setViewVersion(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex h-[85vh] max-h-[85vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Refakat Kartı — Önizleme</DialogTitle>
          <DialogDescription>
            Önizleme baskıyla birebir aynı. İçerik her baskıda iş emrinin güncel
            hâlinden üretilir; plan değiştiyse kart yeni versiyona geçer.
          </DialogDescription>
        </DialogHeader>

        {/* Eski sürüm görüntüleniyor — baskı yolu KAPALI. Gerekçe: kart sahaya
            inen kontrollü bir belgedir; yürürlükten kalkmış planı yanlışlıkla
            basmak, geçmişi görememekten çok daha pahalıdır. */}
        {viewingOld && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs">
            <span>
              <strong>Rev.{viewVersion}</strong> — geçmiş kopya. Basmak için güncel sürüme dönün.
            </span>
            <Button type="button" size="sm" variant="secondary" onClick={() => setViewVersion(null)}>
              Güncele dön
            </Button>
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
          <PrintPageSizeToggle
            value={pageSize}
            onChange={setPageSize}
            docPageSize={cardPageSize}
            disabled={!html}
          />
          <div className="flex gap-2">
          {activeCard && (
            <DocVersionHistory
              docType="TRAVELER_CARD"
              sourceId={activeCard.id}
              // Geçmişteki "seçili" satır = şu an bakılan sürüm. Güncel plandayken
              // kartın kendi sürümünü işaretleriz (o da defterdeki ACTIVE satırdır).
              currentVersion={viewVersion ?? activeCard.version}
              onSelectVersion={(v) => setViewVersion(v)}
              // Yanındaki Yenile/Kapat/Yazdır normal boyutlu — şerit ölçüsü burada kaçık durur.
              compact={false}
              // Defter baskıyla yazılır: ÖNİZLEME kayıt bırakmaz (GET yan etkisiz).
              // Sebebi yazılmazsa "geçmiş çalışmıyor" diye okunur.
              emptyText="Henüz baskı alınmadı — defter ilk baskıda oluşur. Önizleme kayıt bırakmaz."
            />
          )}
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
          {!viewingOld && (
            <Button type="button" className="gap-1" disabled={!html} onClick={() => void handlePrint()}>
              <Printer className="h-4 w-4" /> Yazdır
            </Button>
          )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
