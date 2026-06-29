import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { LabelKind, TemplateField } from "@/services/labelTemplateService";
import {
  labelKindLabels,
  labelTemplateService,
} from "@/services/labelTemplateService";

interface Props {
  kind: LabelKind;
  fields: TemplateField[];
}

/**
 * Şablon önizleme — backend `/api/labels/preview/html` endpoint'inden tam
 * HTML çeker ve iframe içinde gösterir. Mobil etiketle birebir aynı render →
 * "Electron'da ile mobildeki etiket farklı" sorunu yapısal olarak çözüldü.
 */
export function LabelPreview({ kind, fields }: Props) {
  const visibleCount = fields.filter((f) => f.isVisible).length;

  const query = useQuery({
    // fields değiştikçe key değişir, otomatik refetch.
    queryKey: ["label-preview", kind, JSON.stringify(fields)],
    queryFn: () => labelTemplateService.previewHtml(kind, fields),
    enabled: visibleCount > 0,
    staleTime: 0,
  });

  // Native (PPLA/ZPL) metin-zone önizlemesi — Bluetooth/termal yazıcı çıktısı.
  const nativeQuery = useQuery({
    queryKey: ["label-preview-native", kind, JSON.stringify(fields)],
    queryFn: () => labelTemplateService.previewNativeText(kind, fields),
    enabled: visibleCount > 0,
    staleTime: 0,
  });
  const sizeClass: Record<string, string> = { sm: "text-[10px]", md: "text-xs", lg: "text-sm", xl: "text-base" };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Canlı Önizleme
        </div>
        <Badge variant="muted" className="text-[10px]">
          {labelKindLabels[kind]}
        </Badge>
      </div>

      <div className="rounded-lg border-2 border-dashed bg-background p-2 shadow-sm">
        {visibleCount === 0 ? (
          <div className="py-8 text-center text-xs italic text-muted-foreground">
            Görünür alan yok. Soldan alan ekle ya da "Görünür" kutusunu işaretle.
          </div>
        ) : query.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : query.isError ? (
          <div className="py-8 text-center text-xs italic text-destructive">
            Önizleme alınamadı: {(query.error as Error).message}
          </div>
        ) : (
          <iframe
            title="Etiket önizleme"
            srcDoc={query.data ?? ""}
            sandbox=""
            className="h-[640px] w-full rounded border bg-white"
          />
        )}
      </div>

      {/* Native (PPLA/ZPL) metin-zone önizlemesi — Bluetooth/termal yazıcı */}
      {visibleCount > 0 && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Native (PPLA/ZPL) metin alanı
            </div>
            <Badge variant="muted" className="text-[9px]">Termal/BT</Badge>
          </div>
          {nativeQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : nativeQuery.isError ? (
            <div className="text-[10px] italic text-destructive">Alınamadı</div>
          ) : (
            <div className="space-y-0.5 font-mono">
              {(nativeQuery.data?.lines ?? []).map((ln, i) => (
                <div key={i} className={`${sizeClass[ln.size] ?? "text-xs"} ${ln.bold ? "font-bold" : ""}`}>
                  {ln.text}
                </div>
              ))}
              {(nativeQuery.data?.lines.length ?? 0) === 0 && (
                <div className="text-[10px] italic text-muted-foreground">Metin satırı yok</div>
              )}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Sıra/görünür/ad/bold/boyut bu cihazlarda aynen uygulanır (barkod/QR sol sabit kolonda).
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Önizleme örnek (mock) veri ile oluşturuldu — mobil etiket ile aynı
        render mantığı kullanılır. Kaydedilmemiş değişiklikler anlık yansır.
      </p>
    </div>
  );
}
