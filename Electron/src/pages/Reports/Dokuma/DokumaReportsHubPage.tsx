import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { ReportHubGrid } from "../_components/ReportHubGrid";
import { dokumaReportTiles, visibleDokumaTiles } from "./tile-config";

export function DokumaReportsHubPage() {
  const devereEnabled = useDevereEnabled();
  return (
    <ReportHubGrid
      title="Dokuma Raporları"
      description="Tezgah randımanı, duruş Pareto'su, vardiya karneleri, levent sonucu ve kapasite — yalnız dokuma modülü açıkken."
      tiles={visibleDokumaTiles(dokumaReportTiles, devereEnabled)}
    />
  );
}
