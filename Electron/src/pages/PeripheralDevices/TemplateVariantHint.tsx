import { useQuery } from "@tanstack/react-query";
import { labelTemplateService } from "@/services/labelTemplateService";

/** mm değerini kısa göster (100 → "100", 100.5 → "100.5"). */
const fmtMm = (n: number) => String(Math.round(n * 10) / 10);

interface Props {
  /** Seçili şablon id'si ("" → hint yok, sorgu da atılmaz). */
  templateId: string;
  /** Cihazın medya boyutu (mm); medya girilmemişse null. */
  media: { widthMm: number; heightMm: number } | null;
}

/**
 * Varyant uyumsuzluk bilgisi — seçili şablonun boyut varyantları lazily çekilir.
 * Cihaz medya boyutuna ±1mm eşleşen varyant yoksa amber uyarı (baskı BLOKLANMAZ,
 * birincil varyant basılır); varyantı hiç olmayan legacy şablonda gri not.
 */
export function TemplateVariantHint({ templateId, media }: Props) {
  const variantsQuery = useQuery({
    queryKey: ["label-template-variants", templateId],
    queryFn: () => labelTemplateService.listVariants(templateId),
    enabled: Boolean(templateId),
  });
  const variants = variantsQuery.data;
  if (!templateId || !variants) return null;

  if (variants.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Şablon eski akış düzeninde basılır (kanvas varyantı yok).
      </p>
    );
  }
  if (!media) return null;

  const hasMatch = variants.some(
    (v) =>
      Math.abs(v.widthMm - media.widthMm) <= 1 &&
      Math.abs(v.heightMm - media.heightMm) <= 1,
  );
  if (hasMatch) return null;

  const primary = variants.find((v) => v.isPrimary) ?? variants[0];
  if (!primary) return null;
  return (
    <p className="text-xs text-amber-600 dark:text-amber-500">
      Bu şablonun {fmtMm(media.widthMm)}×{fmtMm(media.heightMm)} mm için varyantı yok —
      birincil varyant ({fmtMm(primary.widthMm)}×{fmtMm(primary.heightMm)}) basılır. Editörde
      {" “Yeni boyut (kopyala)” "}ile ekleyin.
    </p>
  );
}
