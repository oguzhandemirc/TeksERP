// K29 S14b: rotasız seçenek yalnız rota uygulaması "Okutmayla" iken ve belge okutulabiliyorsa (rotasız İE yalnız belgeden
// açılır). Kip kaynağı feature-flags `productionRouteMode`; eski backend alanı göndermez → SIRALI = bugünkü seçici.
import { useFeatureFlags, useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";

export function useScanRouteOption(): boolean {
  const flags = useFeatureFlags();
  const docsOn = useGelenBelgeEnabled();
  const { hasPermission } = useRoleAccess();
  return flags.data?.data?.productionRouteMode === "SCAN" && docsOn && hasPermission("gelen-belge:write");
}
