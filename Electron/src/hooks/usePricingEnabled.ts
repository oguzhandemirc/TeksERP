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

export function useKartelaMeasurementEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.kartelaMeasurementEnabled ?? false;
}

export function usePartyCodeAuto(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.partyCodeAuto ?? false;
}

export function useFasonNoteMobileEntry(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.fasonNoteMobileEntry ?? false;
}

export function useDevicePairingRequired(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.devicePairingRequired ?? false;
}

export function useShipmentConfirmationEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.shipmentConfirmationEnabled ?? false;
}

/** Oturum (JWT) ömrü, saat. Yüklenene kadar 8 (backend varsayılanı). */
export function useSessionDurationHours(): number {
  const q = useFeatureFlags();
  return q.data?.data?.sessionDurationHours ?? 8;
}

/** Hareketsizlik zaman aşımı, dakika. Yüklenene kadar 0 (kapalı). */
export function useIdleTimeoutMinutes(): number {
  const q = useFeatureFlags();
  return q.data?.data?.idleTimeoutMinutes ?? 0;
}

/** Saha #20: top adı format şablonu. Yüklenene kadar default. */
export function useRollNameTemplate(): string {
  const q = useFeatureFlags();
  return q.data?.data?.rollNameTemplate?.trim() || "{item} {color} {width}";
}

export const FEATURE_FLAGS_QUERY_KEY = QUERY_KEY;
