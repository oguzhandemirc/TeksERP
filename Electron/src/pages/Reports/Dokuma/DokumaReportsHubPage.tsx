import { ReportHubGrid } from "../_components/ReportHubGrid";
import { dokumaReportTiles } from "./tile-config";

export function DokumaReportsHubPage() {
  return (
    <ReportHubGrid
      title="Dokuma Raporları"
      description="Tezgah randımanı, duruş Pareto'su ve vardiya karneleri — yalnız dokuma modülü açıkken."
      tiles={dokumaReportTiles}
    />
  );
}
