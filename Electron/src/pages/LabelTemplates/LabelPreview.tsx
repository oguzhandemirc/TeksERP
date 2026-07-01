import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { LabelKind, TemplateField } from "@/services/labelTemplateService";
import { labelKindLabels, labelTemplateService } from "@/services/labelTemplateService";
import { PRINTER_LANGUAGE_LABELS, type PrinterLanguage } from "@/services/featureFlagService";

interface Props {
  kind: LabelKind;
  fields: TemplateField[];
}

/**
 * Şablon canlı önizleme — AKTİF YAZICI DİLİNDE (WYSIWYG). PPLB gibi native dilde
 * gerçek komutları görsele çevirir (baskıyla birebir); HTML dilinde HTML; çizici
 * olmayan native → ham komut metni. Test ekranı + Kod editörüyle tutarlı: hepsi
 * baskıya giden çıktının aynısını gösterir.
 */
export function LabelPreview({ kind, fields }: Props) {
  const visibleCount = fields.filter((f) => f.isVisible).length;

  const previewQ = useQuery({
    queryKey: ["label-preview-active", kind, JSON.stringify(fields)],
    queryFn: () => labelTemplateService.fieldsPreview(kind, fields),
    enabled: visibleCount > 0,
    staleTime: 0,
  });
  const p = previewQ.data;
  const langLabel = p ? (PRINTER_LANGUAGE_LABELS[p.language as PrinterLanguage] ?? p.language) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Canlı Önizleme
        </div>
        <div className="flex items-center gap-1">
          {langLabel && (
            <Badge variant="outline" className="text-[10px]" title="Baskıya giden çıktının aynısı">
              Aktif dil: {langLabel}
              {p?.mode === "text" ? " · ham komut" : " · önizleme = baskı"}
            </Badge>
          )}
          <Badge variant="muted" className="text-[10px]">
            {labelKindLabels[kind]}
          </Badge>
        </div>
      </div>

      <div className="rounded-lg border-2 border-dashed bg-background p-2 shadow-sm">
        {visibleCount === 0 ? (
          <div className="py-8 text-center text-xs italic text-muted-foreground">
            Görünür alan yok. Soldan alan ekle ya da "Görünür" kutusunu işaretle.
          </div>
        ) : previewQ.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : previewQ.isError ? (
          <div className="py-8 text-center text-xs italic text-destructive">
            Önizleme alınamadı: {(previewQ.error as Error).message}
          </div>
        ) : p?.mode === "text" ? (
          <pre className="h-[640px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
            {p.content}
          </pre>
        ) : (
          <iframe
            title="Etiket önizleme"
            srcDoc={p?.content ?? ""}
            sandbox="allow-same-origin allow-modals"
            className="h-[640px] w-full rounded border bg-white"
          />
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Önizleme örnek (mock) veriyle, <strong>aktif yazıcı dilinde</strong> oluşturuldu —
        yazıcıya giden çıktının aynısı. Kaydedilmemiş değişiklikler anlık yansır.
      </p>
    </div>
  );
}
