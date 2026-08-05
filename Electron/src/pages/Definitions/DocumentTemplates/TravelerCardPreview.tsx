import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const pageW = config.pageSize === "A5" ? 148 : 210; // mm

  // ── SAYFAYA SIĞDIR ────────────────────────────────────────────────────────
  // Önizleme eskiden sayfayı 1:1 (96dpi) çiziyordu: A4 1123px, A5 794px. Panel
  // ~70vh olduğu için İKİSİNİN DE altı kesiliyordu → "A5 seçtim ama boy aynı
  // görünüyor" (saha geri bildirimi, 2026-08-04). Oysa A5 A4'ün YARISI DEĞİL:
  // alan yarısı, ama boy 210/297 ≈ %71, en 148/210 ≈ %70. Kesilen bir sayfada
  // bu fark görünmez.
  //
  // Çözüm: sayfayı panele SIĞDIR (ölçekle) — böylece hem gerçek oran hem
  // içeriğin nerede bittiği tek bakışta görünür. Metni okumak gerektiğinde
  // %100'e geçilir. Ölçek yalnız ÖNİZLEMEYİ etkiler; baskı @page ile gider.
  const MM_PX = 96 / 25.4;
  const BODY_PAD = 28; // @media screen: body { padding: 14px 0 }
  const frameW = pageW * MM_PX;
  const frameH = pageH * MM_PX + BODY_PAD;
  const [fitToPage, setFitToPage] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e?.contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = fitToPage && box.w > 0 ? Math.min(1, box.w / frameW, box.h / frameH) : 1;
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
          {/* Fiziksel ölçü AÇIKÇA yazılır. Sebep: A serisi kâğıtların ORANI
              sabittir (1:√2) — A4 ve A5 ekranda BİREBİR aynı şekilde görünür,
              yalnız gerçek boyları farklıdır. Ölçekli bir önizlemede bu fark
              görsel olarak ANLATILAMAZ; tek dürüst yol mm'yi yazmaktır. */}
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Önizleme — örnek veri · {config.pageSize} ({pageW}×{pageH} mm)
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
        <div className="flex shrink-0 items-center gap-1">
          <div className="inline-flex overflow-hidden rounded-md border">
            {[
              { v: true, label: "Sığdır" },
              { v: false, label: "%100" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setFitToPage(o.v)}
                className={
                  "px-2 py-1 text-[11px] font-medium transition-colors " +
                  (fitToPage === o.v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")
                }
                title={
                  o.v
                    ? "Sayfanın tamamını göster — A4/A5 oranı ve içeriğin nerede bittiği görünür"
                    : "Gerçek boyut (96 dpi) — metni okumak için"
                }
              >
                {o.label}
              </button>
            ))}
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
      </div>
      <div ref={boxRef} className="h-[70vh] overflow-auto p-2">
        {htmlQuery.isLoading && !html ? (
          <Skeleton className="h-full w-full" />
        ) : html ? (
          // Ölçekleme SARMALAYICIYA değil iframe'e uygulanır; sarmalayıcıya
          // ölçeklenmiş ölçüler verilir ki kaydırma alanı doğru olsun (transform
          // düzen akışını değiştirmez — yalnız çizimi).
          <div
            style={{ width: frameW * scale, height: frameH * scale }}
            className="relative mx-auto"
          >
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
              style={{
                width: frameW,
                height: frameH,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
              className="absolute left-0 top-0 border-0 bg-white"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Önizleme yüklenemedi.
          </div>
        )}
      </div>
    </div>
  );
}
