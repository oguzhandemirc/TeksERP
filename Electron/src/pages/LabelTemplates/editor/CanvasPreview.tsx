// =============================================================================
// Etiket Stüdyosu — kanvas WYSIWYG önizleme (backend render; önizleme = baskı)
// =============================================================================
// Nihai görüntü DAİMA backend'ten: tasarım → emit → native→SVG / HTML. Kanvas
// sahnesi yaklaşıktır; buradaki görüntü yazıcıya gidenin aynısıdır. 350ms
// debounce ile kaydetmeden canlı yansır. Dil seçilebilir (Aktif = cihaz ayarı).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  labelTemplateService,
  rawCodeLangLabels,
  type LabelKind,
  type RawCodeLang,
} from "@/services/labelTemplateService";
import type { CanvasLayout } from "@/types/label-canvas";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";
import { NO_GRADE, type SampleGrade } from "./useSampleGrade";

interface Props {
  kind: LabelKind;
  widthMm: number;
  heightMm: number;
  layout: CanvasLayout;
  /** Örnek top kalitesi (koşullu eleman değerlendirmesi) — stüdyo kabuğunda tutulur. */
  sample: SampleGrade;
}

/** Önizleme kutusu üst sınırı (px) — dar/uzun etiketler bunda sınırlanır. */
const PREVIEW_MAX_H = 460;
/** CSS mm → px (ekran 96dpi): buildCanvasLabelHtml `.label` fiziksel mm basar. */
const PX_PER_MM = 96 / 25.4;

export function CanvasPreview({ kind, widthMm, heightMm, layout, sample }: Props) {
  const [view, setView] = useState<"visual" | "code">("visual");
  const [lang, setLang] = useState<"active" | RawCodeLang>("active");
  // "Aktif dil" → bu bilgisayara seçili Cihaz Kaydı yazıcısının dili (PPLA/PPLB/ZPL);
  // cihaz yoksa RASTER_HTML. Top-etiket önizlemesiyle aynı mantık — peripheralId geçilir,
  // backend dili cihazın languageOverride'ından çözer (getCanvasPreview zaten destekliyor).
  const { peripheralId } = useLabelPrinter();

  // Önizleme kutusu TUVAL ORANINI izler: mevcut genişliği ölçüp etiket
  // en/boy oranından kutu boyutunu türetir; iframe içeriği (fiziksel mm) bu
  // kutuya birebir ölçeklenir. Böylece 100×250 girince önizleme de uzar/incelir.
  const measureRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(0);
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => setAvailW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ratio = widthMm > 0 && heightMm > 0 ? widthMm / heightMm : 1;
  let boxW = availW || 300;
  let boxH = boxW / ratio;
  if (boxH > PREVIEW_MAX_H) {
    boxH = PREVIEW_MAX_H;
    boxW = boxH * ratio;
  }
  const wPx = widthMm * PX_PER_MM;
  const hPx = heightMm * PX_PER_MM;
  const fitScale = wPx > 0 ? boxW / wPx : 1;

  // Örnek top kalitesi ÜST BİLEŞENDEN gelir (useSampleGrade) — Test Baskısı da
  // AYNI seçimi kullansın diye; ayrı tutulsaydı önizlemede görünen koşullu eleman
  // test baskısında sessizce çıkmazdı.
  const { grades, hasConditions, value: gradeChoice, setValue: setSampleGrade, qualityGrade: grade } = sample;

  // 350ms debounce — her sürükleme adımında backend'e gitmesin.
  const liveKey = JSON.stringify({ kind, widthMm, heightMm, layout, lang, peripheralId, grade });
  const [debouncedKey, setDebouncedKey] = useState(liveKey);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKey(liveKey), 350);
    return () => clearTimeout(t);
  }, [liveKey]);

  // enabled DEBOUNCE EDİLMİŞ yüke bakar (canlıya değil): açılışta tuval bir an
  // boşken canlı state dolar dolmaz sorgu, hâlâ boş-eleman taşıyan debounce
  // anahtarıyla ateşlenip backend'ten "en az 1 eleman" 400'ü (ve interceptor
  // toast'u) üretiyordu. Boş yük hiç istek atmaz.
  const debounced = JSON.parse(debouncedKey) as {
    kind: LabelKind; widthMm: number; heightMm: number; layout: CanvasLayout;
    lang: "active" | RawCodeLang; peripheralId?: string; grade?: string;
  };
  const previewQ = useQuery({
    queryKey: ["label-canvas-preview", debouncedKey],
    queryFn: () =>
      labelTemplateService.canvasPreview({
        kind: debounced.kind,
        widthMm: debounced.widthMm,
        heightMm: debounced.heightMm,
        elements: debounced.layout,
        language: debounced.lang === "active" ? undefined : debounced.lang,
        // Aktif dil için: seçili yazıcının languageOverride'ı (yoksa RASTER_HTML).
        peripheralId: debounced.peripheralId,
        qualityGrade: debounced.grade,
      }),
    enabled: debounced.layout.elements.length > 0,
    staleTime: 0,
    retry: false,
  });
  const p = previewQ.data;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Önizleme görünümü">
          <button type="button" role="tab" aria-selected={view === "visual"} onClick={() => setView("visual")}
            className={cn("flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium",
              view === "visual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Eye className="h-3 w-3" /> Görsel
          </button>
          <button type="button" role="tab" aria-selected={view === "code"} onClick={() => setView("code")}
            className={cn("flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium",
              view === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Code2 className="h-3 w-3" /> Kod
          </button>
        </div>
        <div className="flex items-center gap-1">
          {hasConditions && (
            <Select value={gradeChoice} onValueChange={setSampleGrade}>
              <SelectTrigger className="h-6 w-[150px] text-[10px]" title="Örnek topun kalitesi — koşullu elemanlar buna göre basılır">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {grades.map((g) => (
                  <SelectItem key={g.code} value={g.code} className="text-xs">
                    Örnek: {g.name}
                  </SelectItem>
                ))}
                <SelectItem value={NO_GRADE} className="text-xs">Örnek: kalitesiz top</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={lang} onValueChange={(v) => setLang(v as "active" | RawCodeLang)}>
            <SelectTrigger className="h-6 w-[130px] text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active" className="text-xs">Aktif dil</SelectItem>
              {(Object.keys(rawCodeLangLabels) as RawCodeLang[]).map((l) => (
                <SelectItem key={l} value={l} className="text-xs">{rawCodeLangLabels[l]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {p && (
            <Badge variant="outline" className="text-[10px]" title="Baskıya giden çıktının aynısı">
              {p.language}{p.mode === "text" ? " · ham" : " · önizleme = baskı"}
            </Badge>
          )}
        </div>
      </div>

      <div className="rounded-lg border-2 border-dashed bg-background p-2 shadow-sm">
        <div ref={measureRef} className="w-full">
          {layout.elements.length === 0 ? (
            <div className="py-8 text-center text-xs italic text-muted-foreground">Tuval boş.</div>
          ) : previewQ.isLoading ? (
            <Skeleton className="mx-auto" style={{ width: boxW, height: boxH }} />
          ) : previewQ.isError ? (
            <div className="py-6 text-center text-xs italic text-destructive">
              Önizleme alınamadı: {(previewQ.error as Error).message}
            </div>
          ) : view === "code" || p?.mode === "text" ? (
            <pre className="h-[480px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
              {view === "code" ? p?.native ?? "" : p?.content ?? ""}
            </pre>
          ) : (
            // Kutu = tuval oranı; iframe fiziksel mm boyutunda çizip kutuya ölçeklenir.
            <div
              className="relative mx-auto overflow-hidden rounded border bg-white"
              style={{ width: boxW, height: boxH }}
            >
              <iframe
                title="Kanvas önizleme"
                srcDoc={p?.content ?? ""}
                sandbox="allow-same-origin allow-modals"
                style={{
                  width: wPx,
                  height: hPx,
                  border: 0,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  transform: `scale(${fitScale})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Örnek (mock) veriyle backend'te üretildi — yazıcıya gidenin aynısı, tuval
        oranıyla ({widthMm}×{heightMm} mm). Native dillerde Türkçe ASCII'ye katlanır (Ş→S).
      </p>
    </div>
  );
}
