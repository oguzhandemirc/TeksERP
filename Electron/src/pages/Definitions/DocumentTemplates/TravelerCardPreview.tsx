import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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

  const htmlQuery = useQuery({
    queryKey: ["traveler-sample-html", cfgKey],
    queryFn: () => workOrderService.getTravelerCardSampleHtml(debouncedCfg),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const html = htmlQuery.data ?? null;

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Önizleme — örnek veri (gerçek baskı çıktısı, {config.pageSize})
      </div>
      <div className="h-[70vh]">
        {htmlQuery.isLoading && !html ? (
          <Skeleton className="h-full w-full" />
        ) : html ? (
          <iframe
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
