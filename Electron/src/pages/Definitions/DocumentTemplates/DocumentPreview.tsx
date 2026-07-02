import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  printedDocumentService,
  type PrintedDocType,
} from "@/services/printedDocumentService";
import type { DocSheetPreview } from "@/components/print/print-helpers";

/** Client belge anahtarı → backend PrintedDocType. */
const DOC_TYPE_BY_KEY: Record<string, PrintedDocType> = {
  shipmentDispatch: "SHIPMENT_DISPATCH",
  fasonSevk: "SUBCONTRACTOR_DISPATCH",
  fasonDirectShip: "SUBCONTRACTOR_DIRECT_SHIP",
  kartelaCeki: "KARTELA_DISPATCH",
};

/**
 * Belge Şablonları canlı önizlemesi — ÖNİZLEME = GERÇEK BASKI (tek kaynak).
 * Gerçek backend renderHtml'i örnek veriyle + DÜZENLENEN taslak config ile çağırır
 * (`sample-html`), sonucu iframe'de gösterir. Eskiden client React sheet'iydi (baskıyla
 * ayrışırdı); artık baskının birebir aynısı. Config değişince debounce'la yeniden çeker.
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

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Önizleme — örnek veri (gerçek baskı çıktısı)
      </div>
      <div className="h-[70vh]">
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
          <iframe
            title="Belge Önizleme"
            srcDoc={html}
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
