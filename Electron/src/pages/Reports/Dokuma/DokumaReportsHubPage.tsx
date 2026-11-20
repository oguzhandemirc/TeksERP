import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ReportHubGrid } from "../_components/ReportHubGrid";
import { dokumaReportTiles, visibleDokumaTiles } from "./tile-config";

export function DokumaReportsHubPage() {
  const devereEnabled = useDevereEnabled();
  const { hasPermission } = useRoleAccess();
  // Hub iki izinden biriyle açılır; her karo kendi izniyle (yoksa kategori izni `report:production`) süzülür — açılınca 403 olmasın.
  const tiles = visibleDokumaTiles(dokumaReportTiles, devereEnabled).filter((t) => hasPermission(t.permission ?? "report:production"));
  return (
    <ReportHubGrid
      title="Dokuma Raporları"
      description="Tezgah randımanı, duruş Pareto'su, vardiya karneleri, levent sonucu ve kapasite — yalnız dokuma modülü açıkken."
      tiles={tiles}
    />
  );
}
