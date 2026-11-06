// Ekran kapısı: backend `/api/service-prices` = ticaret + ön muhasebe + hizmet faturası; okuma `item:read`,
// yazma `price:write`. Bayrak yüklenmeden "kapalı" denmez (isLoading); belirsiz bayrak KAPALI (fail-closed).
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { servicePricesBlock } from "./regime";

export function useServicePricesAccess() {
  const flags = useFeatureFlags();
  const { hasPermission } = useRoleAccess();
  const d = flags.data?.data;
  const blocked = servicePricesBlock({
    ticaretEnabled: d?.ticaretEnabled ?? false,
    financeEnabled: d?.financeEnabled ?? false,
    serviceBillingEnabled: d?.financeServiceBillingEnabled ?? false,
    canRead: hasPermission("item:read"),
  });
  return {
    isLoading: flags.isLoading,
    blocked,
    open: !flags.isLoading && blocked === null,
    canWrite: hasPermission("price:write"),
  };
}
