// =============================================================================
// Bağımsız şablon baskısı — seçili varyantın küçük WYSIWYG önizlemesi.
// Backend RASTER_HTML render'ı sandbox'lı iframe'e basılır (CanvasPreview'in
// hafif hali: dil seçici/kod görünümü yok, sabit kutu, tuval oranı korunur).
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RawCodeLang,
  labelTemplateService,
  type LabelKind,
  type LabelTemplateVariant,
} from "@/services/labelTemplateService";

/** CSS mm → px (ekran 96dpi) — backend HTML fiziksel mm basar. */
const PX_PER_MM = 96 / 25.4;
const BOX_W = 300;
const MAX_H = 190;

export function TemplatePrintPreview({
  kind,
  variant,
}: {
  kind: LabelKind;
  variant: LabelTemplateVariant;
}) {
  const empty = variant.elements.elements.length === 0;
  const previewQ = useQuery({
    queryKey: ["template-print-preview", variant.id, variant.updatedAt, kind],
    queryFn: () =>
      labelTemplateService.canvasPreview({
        kind,
        widthMm: variant.widthMm,
        heightMm: variant.heightMm,
        elements: variant.elements,
        language: RawCodeLang.RASTER_HTML,
      }),
    enabled: !empty,
    staleTime: 60_000,
    retry: false,
  });

  if (empty) {
    return (
      <p className="rounded-md border border-dashed p-3 text-center text-xs italic text-muted-foreground">
        Bu varyantın tuvali boş — basılacak eleman yok.
      </p>
    );
  }

  const ratio = variant.widthMm > 0 && variant.heightMm > 0 ? variant.widthMm / variant.heightMm : 1;
  let boxW = BOX_W;
  let boxH = boxW / ratio;
  if (boxH > MAX_H) {
    boxH = MAX_H;
    boxW = boxH * ratio;
  }
  const wPx = variant.widthMm * PX_PER_MM;
  const hPx = variant.heightMm * PX_PER_MM;
  const fitScale = wPx > 0 ? boxW / wPx : 1;

  return (
    <div className="space-y-1">
      {previewQ.isLoading ? (
        <Skeleton className="mx-auto" style={{ width: boxW, height: boxH }} />
      ) : previewQ.isError ? (
        <p className="py-3 text-center text-xs italic text-destructive">
          Önizleme alınamadı: {(previewQ.error as Error).message}
        </p>
      ) : (
        <div
          className="relative mx-auto overflow-hidden rounded border bg-white"
          style={{ width: boxW, height: boxH }}
        >
          <iframe
            title="Şablon baskı önizleme"
            srcDoc={previewQ.data?.content ?? ""}
            sandbox="allow-same-origin"
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
      <p className="text-center text-[10px] text-muted-foreground">
        Örnek veriyle önizleme — {variant.widthMm}×{variant.heightMm} mm.
      </p>
    </div>
  );
}
