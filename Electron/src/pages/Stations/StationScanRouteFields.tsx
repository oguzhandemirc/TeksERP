import type { UseFormReturn } from "react-hook-form";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { StationFormValues } from "./schema";
import { TERIM } from "@/lib/terim";

/**
 * K29: okutmayla rota anahtarları. Yalnız "Rota uygulaması: Okutmayla" iken çizilir;
 * SIRALI'da form birebir eskidir (değerler gizli alanda korunur).
 */
export function StationScanRouteFields({ form }: { form: UseFormReturn<StationFormValues> }) {
  const scanRoute = useFeatureFlags().data?.data?.productionRouteMode === "SCAN";
  if (!scanRoute) return null;
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="station-scan-add-allowed" {...form.register("scanAddAllowed")} /> Okutunca adım eklenebilir
      </label>
      <p className="-mt-1 pl-6 text-xs text-muted-foreground">
        Kumaşın belgesi/kartı burada okutulunca {TERIM.terbiyeIsEmri.cekimKucuk.bulunma} bu istasyonun adımı yoksa eklenir; öndeki bekleyen adımlar &quot;Atlandı&quot; olur.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="station-scan-not-skippable" {...form.register("scanNotSkippable")} /> Atlanamaz
      </label>
      <p className="-mt-1 pl-6 text-xs text-muted-foreground">
        Bu istasyonun bekleyen adımı varken kumaş ileri bir istasyonda okutulursa tablet engeller.
      </p>
    </>
  );
}
