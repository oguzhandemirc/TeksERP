import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  printedDocumentService,
  type PrintedDocType,
} from "@/services/printedDocumentService";
import { DOC_DEF_MAP, DOC_TYPE_TO_KEY } from "@/services/documentConfig";
import type { DocSheetPreview } from "@/components/print/print-helpers";

/**
 * Client belge anahtarı → backend PrintedDocType.
 *
 * ⚠️ `DOC_TYPE_TO_KEY`in TERSİ olarak TÜRETİLİR, elle yazılmaz. Eski hâli
 * ikinci bir liste tutuyordu ve sessizce bayatladı: ticaret/ön muhasebe
 * paketleriyle gelen DÖRT belge (`depoTransfer` · `malKabul` · `fatura` ·
 * `tahsilatMakbuzu`) bu listeye hiç eklenmediği için Belge Şablonları ekranında
 * ayarları düzenlenebiliyor ama canlı önizleme "Bu belge için önizleme yok."
 * diyordu — yani "önizleme = gerçek baskı" sözleşmesi tam da ayarı yapan kişinin
 * gözü önünde sessizce boşa düşüyordu (2026-08-15'te bulundu ve kapatıldı).
 * Türetilmiş hâlde yeni bir belge tek yere yazılır ve önizlemesi kendiliğinden
 * doğar.
 */
const DOC_TYPE_BY_KEY: Record<string, PrintedDocType> = Object.fromEntries(
  Object.entries(DOC_TYPE_TO_KEY).map(([docType, docKey]) => [docKey, docType as PrintedDocType]),
);

/** Fiziksel sayfa ölçüsü (mm) — backend `fason-ceki.density.PAGE_DIM` aynası. */
const PAGE_DIM = { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 } } as const;

/** CSS px / mm (96 dpi) — @page mm ölçülerini tarayıcı px'ine çevirir. */
const MM = 96 / 25.4;

/**
 * Belge Şablonları canlı önizlemesi — ÖNİZLEME = GERÇEK BASKI (tek kaynak).
 * Gerçek backend renderHtml'i örnek veriyle + DÜZENLENEN taslak config ile çağırır
 * (`sample-html`), sonucu iframe'de gösterir. Eskiden client React sheet'iydi (baskıyla
 * ayrışırdı); artık baskının birebir aynısı. Config değişince debounce'la yeniden çeker.
 *
 * ── SAYFAYA SIĞMA GÖSTERGESİ (2026-08-05) ───────────────────────────────────
 * iframe eskiden serbest yükseklikteydi: içerik ikinci sayfaya taşsa bile önizleme
 * bunu SÖYLEMİYORDU. Fason çeki A5'te tam bu yüzden sessizce iki sayfa basıyordu
 * (ölçüldü: %105 — imza bloğu ikinci kâğıda düşüyordu, kimse fark etmiyordu).
 * Artık iframe sayfanın GERÇEK yazı-alanı genişliğinde kurulur, kesikli çizgiler
 * sayfa sınırını gösterir ve üstteki rozet doluluğu yazar. Ayarı yapan kişi
 * taşmayı KAYDETMEDEN görür.
 *
 * ⚠️ Ölçüm yalnız GÖSTERGE içindir; basılan HTML backend'den gelir ve bu
 * bileşenden etkilenmez. Ölçüm başarısız olursa (iframe okunamadı) rozet
 * çizilmez — yanlış bir "sığıyor" demektense hiçbir şey dememek doğrudur.
 */
export function DocumentPreview({
  docKey,
  preview,
}: {
  docKey: string;
  preview: DocSheetPreview;
}) {
  const docType = DOC_TYPE_BY_KEY[docKey];

  // Config her tuş vuruşunda değişir → debounce + serileştirilmiş queryKey.
  const debouncedCfg = useDebouncedValue(preview.cfg, 300);
  const cfgKey = useMemo(() => JSON.stringify(debouncedCfg), [debouncedCfg]);

  const htmlQuery = useQuery({
    queryKey: ["doc-sample-html", docType, cfgKey],
    // docType, `enabled: Boolean(docType)` ile korunur → queryFn yalnız tanımlıyken çalışır.
    queryFn: () => printedDocumentService.getSampleHtml(docType!, debouncedCfg),
    enabled: Boolean(docType),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  // Sayfa yazı alanı (mm → px). Kenar boşluğu verilmeyen kenar belgenin kendi
  // varsayılanını kullanır — o varsayılan backend'de yaşıyor, panel `DocDef`
  // üzerinden aynalar (sapma yalnız önizleme çerçevesini etkiler, baskıyı DEĞİL).
  const pageSize = debouncedCfg.style?.pageSize === "A5" ? "A5" : "A4";
  const dim = PAGE_DIM[pageSize];
  const defMargin = DOC_DEF_MAP[docKey]?.defaultMarginMm ?? 9;
  const m = debouncedCfg.style?.margins ?? {};
  const contentW = (dim.w - (m.left ?? defMargin) - (m.right ?? defMargin)) * MM;
  const contentH = (dim.h - (m.top ?? defMargin) - (m.bottom ?? defMargin)) * MM;

  return (
    // Dar ekranda kolonlar alt alta yığılır ve ebeveynin kesin yüksekliği YOKTUR
    // → `h-full` orada sıfıra çöker. Bu yüzden taban `70vh`, lg'de `h-full`.
    <div className="flex h-[70vh] min-h-0 flex-col rounded-md border bg-muted/30 lg:h-full">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Önizleme — örnek veri (gerçek baskı çıktısı)
        </span>
        <span className="text-[11px] text-muted-foreground">
          {pageSize} · {dim.w}×{dim.h} mm
        </span>
      </div>

      {!docType ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Bu belge için önizleme yok.
        </div>
      ) : htmlQuery.isLoading && !html ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : html ? (
        <PagedPreview html={html} contentW={contentW} contentH={contentH} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Önizleme yüklenemedi.
        </div>
      )}
    </div>
  );
}

/**
 * Belgeyi gerçek sayfa genişliğinde çizer, panele sığacak kadar ölçekler ve
 * sayfa sınırlarını gösterir. Ölçek yalnız GÖRÜNTÜdür — ölçüm ölçeklenmemiş
 * iframe belgesinden alınır, yani rozet zoom'dan etkilenmez.
 */
function PagedPreview({
  html,
  contentW,
  contentH,
}: {
  html: string;
  contentW: number;
  contentH: number;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    setHeight(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight));
  }, []);

  // srcDoc yüklendikten sonra ölç; yazı tipleri/görseller geç oturabildiği için
  // bir de kısa gecikmeyle tekrarla (tek ölçüm bazen kısa okuyor).
  useEffect(() => {
    setHeight(null);
    const t = window.setTimeout(measure, 250);
    return () => window.clearTimeout(t);
  }, [html, measure]);

  // Panel genişliğine sığdır (asla büyütme — 1:1 üstü zoom yanıltıcı olur).
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => setScale(Math.min(1, (box.clientWidth - 24) / contentW));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [contentW]);

  const pages = height != null ? Math.max(1, Math.ceil(height / contentH - 0.001)) : null;
  const fill = height != null ? Math.round((height / contentH) * 100) : null;
  const overflow = height != null ? Math.round(height - contentH * (pages ?? 1)) : null;

  return (
    <>
      {pages != null && (
        <div
          className={`shrink-0 border-b px-3 py-1 text-[11px] ${
            pages > 1
              ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          }`}
        >
          {pages > 1 ? (
            <>
              ⚠ İçerik <b>{pages} sayfaya</b> taşıyor (doluluk %{fill}). Tek sayfaya
              indirmek için yazı ölçeğini düşürün, kenar boşluğunu azaltın, kapatılabilir
              bölümleri kapatın ya da sayfa boyutunu büyütün.
            </>
          ) : (
            <>
              ✓ İçerik <b>tek sayfaya</b> sığıyor — doluluk %{fill}
              {overflow != null && fill != null && fill > 92 ? " (sınıra yakın)" : ""}
            </>
          )}
        </div>
      )}
      <div ref={boxRef} className="min-h-0 flex-1 overflow-auto p-3">
        <div
          style={{
            width: contentW * scale,
            height: (height ?? contentH) * scale,
            position: "relative",
          }}
        >
          <div
            style={{
              width: contentW,
              height: height ?? contentH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              position: "relative",
            }}
          >
            <iframe
              ref={frameRef}
              title="Belge Önizleme"
              srcDoc={html}
              onLoad={measure}
              // Backend HTML'i basıyoruz ama baskı yüzeyiyle aynı güvenlik duruşu
              // korunur (`lib/print.ts` ile hizalı): script YOK.
              sandbox="allow-same-origin"
              scrolling="no"
              style={{ width: contentW, height: height ?? contentH, border: 0, background: "#fff", display: "block" }}
            />
            {/* Sayfa sınırı çizgileri — nerede bölüneceğini göster. */}
            {pages != null &&
              Array.from({ length: pages - 1 }, (_, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: contentH * (i + 1),
                    borderTop: "2px dashed #f59e0b",
                    pointerEvents: "none",
                  }}
                />
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
