import { useQuery } from "@tanstack/react-query";
import { featureFlagService } from "@/services/featureFlagService";

const QUERY_KEY = ["feature-flags"];

export function useFeatureFlags() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => featureFlagService.get(),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePricingEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.pricingEnabled ?? false;
}

export const FEATURE_FLAGS_QUERY_KEY = QUERY_KEY;
