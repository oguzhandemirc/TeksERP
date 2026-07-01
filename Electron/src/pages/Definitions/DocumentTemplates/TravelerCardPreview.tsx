import { useMemo, useRef } from "react";
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
export function TravelerCardPreview({ config }: { config: TravelerCardConfig }) {
  const debouncedCfg = useDebouncedValue(config, 300);
  const cfgKey = useMemo(() => JSON.stringify(debouncedCfg), [debouncedCfg]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const htmlQuery = useQuery({
    queryKey: ["traveler-sample-html", cfgKey],
    queryFn: () => workOrderService.getTravelerCardSampleHtml(debouncedCfg),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  // Test baskısı — iframe'i (örnek kart) OS yazdırma diyaloğuna gönder. Baskıda
  // @media print + @page geçerli → gri zemin/gölge yok, gerçek A4/A5 + kenar payı.
  const testPrint = () => iframeRef.current?.contentWindow?.print();

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Önizleme — örnek veri (gerçek baskı çıktısı, {config.pageSize})
        </span>
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
