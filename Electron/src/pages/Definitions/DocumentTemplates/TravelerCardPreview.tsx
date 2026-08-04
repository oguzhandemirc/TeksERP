import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { workOrderService } from "@/pages/Operations/WorkOrders/service";
import type { TravelerCardConfig } from "@/services/featureFlagService";

/**
 * Refakat Kartı canlı önizlemesi — ÖNİZLEME = GERÇEK BASKI (tek kaynak). Gerçek
 * backend renderTravelerCardHtml'i örnek veriyle + DÜZENLENEN taslak config ile
 * çağırır (`sample-html`), iframe'de gösterir. Eskiden @react-pdf belgesiydi
 * (baskıyla ayrışırdı); artık mobil + masaüstü baskının birebir aynısı.
 */
export function TravelerCardPreview({
  config,
  template,
}: {
  config: TravelerCardConfig;
  /** Şablon Stüdyosu taslağı — KAYDEDİLMEDEN önizlenir (uzman modu dahil).
   *  Verilmezse yerleşik kart; Refakat Kartı Ayarları ekranı bunu kullanır. */
  template?: { mode: "BUILTIN" | "SECTIONS" | "RAW_HTML"; html?: string | null; name?: string };
}) {
  const debouncedCfg = useDebouncedValue(config, 300);
  const debouncedTpl = useDebouncedValue(template, 300);
  const cfgKey = useMemo(
    () => JSON.stringify({ c: debouncedCfg, t: debouncedTpl }),
    [debouncedCfg, debouncedTpl],
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const htmlQuery = useQuery({
    queryKey: ["traveler-sample-html", cfgKey],
    queryFn: () => workOrderService.getTravelerCardSampleHtml(debouncedCfg, debouncedTpl),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  // Test baskısı — iframe'i (örnek kart) OS yazdırma diyaloğuna gönder. Baskıda
  // @media print + @page geçerli → gri zemin/gölge yok, gerçek A4/A5 + kenar payı.
  const testPrint = () => iframeRef.current?.contentWindow?.print();

  // ── Sayfa sığma göstergesi ────────────────────────────────────────────────
  // A5'e geçişin bütün amacı "tek yaprak". Ayarı yapan kişi KAYDETMEDEN önce
  // taşma olup olmadığını görmeli — yoksa taşmayı ilk fark eden saha olur.
  // Ölçüm iframe'in KENDİ belgesinden yapılır: .sheet'in yüksekliği ↔ yazı alanı
  // (sayfa − kenar payları). @media screen sheet'e mm genişlik + padding verdiği
  // için oran doğrudan okunabilir; ekstra hesap gerekmez.
  //
  // ⚠️ `.sheet`in KENDİ yüksekliği ölçüm için KULLANILAMAZ: @media screen ona
  // `min-height: <sayfa boyu>mm` verir → içerik kısa olsa bile kutu tam sayfadır
  // ve oran hep %100 çıkardı. Doğru ölçü, yazı alanının üst kenarından SON
  // ÇOCUĞUN alt kenarına olan mesafedir. (Filigran `.sheet` dışında ve
  // position:fixed → ölçüme girmez.)
  const [fit, setFit] = useState<number | null>(null);
  const pageH = config.pageSize === "A5" ? 210 : 297; // mm
  const measure = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    const sheet = win?.document?.querySelector<HTMLElement>(".sheet");
    if (!win || !sheet || sheet.children.length === 0) return setFit(null);
    const cs = win.getComputedStyle(sheet);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const contentH = (pageH * 96) / 25.4 - padTop - padBottom;
    if (!(contentH > 0)) return setFit(null);
    const top = sheet.getBoundingClientRect().top + padTop;
    const bottom = Math.max(
      ...Array.from(sheet.children).map((k) => k.getBoundingClientRect().bottom),
    );
    setFit((bottom - top) / contentH);
  }, [pageH]);
  const overflowing = fit != null && fit > 1.001;

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Önizleme — örnek veri (gerçek baskı çıktısı, {config.pageSize})
          </span>
          {fit != null && (
            <span
              className={
                "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium " +
                (overflowing
                  ? "bg-destructive/10 text-destructive"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")
              }
              title={
                overflowing
                  ? "Örnek kart bu ayarlarla ikinci sayfaya taşıyor. Yazı ölçeğini küçültün, bir bölümü kapatın ya da A4'e geçin."
                  : "Örnek kart tek sayfaya sığıyor."
              }
            >
              {overflowing
                ? `⚠ ${Math.ceil(fit)} sayfaya taşıyor`
                : `✓ tek sayfa (%${Math.round(fit * 100)} dolu)`}
            </span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1"
          disabled={!html}
          onClick={testPrint}
        >
          <Printer className="h-3.5 w-3.5" /> Test Baskısı
        </Button>
      </div>
      <div className="h-[70vh]">
        {htmlQuery.isLoading && !html ? (
          <Skeleton className="h-full w-full" />
        ) : html ? (
          <iframe
            ref={iframeRef}
            title="Refakat Kartı Önizleme"
            srcDoc={html}
            // Script çalıştırma KAPALI (allow-scripts YOK) — belge HTML'i ileride
            // kullanıcı-yazımı olabilir (Faz 2 uzman modu) ve burası Electron
            // renderer'ıdır. allow-same-origin + allow-modals bilinçli: "Test
            // Baskısı" parent'tan contentWindow.print() çağırıyor; ikisi olmadan
            // iframe opak-origin olur ve buton sessizce çalışmaz.
            sandbox="allow-same-origin allow-modals"
            onLoad={measure}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Önizleme yüklenemedi.
          </div>
        )}
      </div>
    </div>
  );
}
