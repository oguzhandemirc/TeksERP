import { useQuery } from "@tanstack/react-query";
import { featureFlagService, DEFAULT_COMPANY_NAME } from "@/services/featureFlagService";

const QUERY_KEY = ["feature-flags"];

export function useFeatureFlags() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => featureFlagService.get(),
    staleTime: 5 * 60 * 1000,
  });
}

/** ERP'nin kurulduğu firmanın adı. Yüklenene kadar varsayılana düşer. */
export function useCompanyName(): string {
  const q = useFeatureFlags();
  return q.data?.data?.companyName?.trim() || DEFAULT_COMPANY_NAME;
}

export function usePricingEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.pricingEnabled ?? false;
}

export function useTargetQuantityEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.targetQuantityEnabled ?? false;
}

export function useRawWidthEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.rawWidthEnabled ?? false;
}

export function useReturnGradingEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.returnGradingEnabled ?? false;
}

export function usePartyCodeAuto(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.partyCodeAuto ?? false;
}

export function useDyehouseNoteMobileEntry(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.dyehouseNoteMobileEntry ?? false;
}

export function useDevicePairingRequired(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.devicePairingRequired ?? false;
}

export function useShipmentConfirmationEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.shipmentConfirmationEnabled ?? false;
}

export const FEATURE_FLAGS_QUERY_KEY = QUERY_KEY;
