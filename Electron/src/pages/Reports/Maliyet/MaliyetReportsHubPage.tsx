import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ReportHubGrid } from "../_components/ReportHubGrid";
import { visibleMaliyetTiles } from "./tile-config";

export function MaliyetReportsHubPage() {
  const { hasPermission } = useRoleAccess();
  const flags = useFeatureFlags();
  return (
    <ReportHubGrid
      title="Maliyet Raporları"
      description="İplik ihtiyaç planı ve dokuma maliyet verimliliği — yalnız maliyet modülü açıkken."
      tiles={visibleMaliyetTiles(hasPermission, flags.data?.data?.dokumaEnabled === true)}
    />
  );
}
