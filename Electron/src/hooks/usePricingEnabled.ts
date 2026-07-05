import { useQuery } from "@tanstack/react-query";
import { featureFlagService, DEFAULT_COMPANY_NAME } from "@/services/featureFlagService";
import type { SameTypeSessionPolicy } from "@/types/auth";
import { isSameTypeSessionPolicy } from "@/lib/session-auth";

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

/** Etkin mobil giriş yöntemleri (auth.loginMethods.enabled). Yüklenene dek yalnız liste. */
export function useEnabledLoginMethods(): ("list" | "pin" | "card")[] {
  const q = useFeatureFlags();
  const enabled = q.data?.data?.loginMethods?.enabled;
  return Array.isArray(enabled) && enabled.length > 0 ? enabled : ["list"];
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

/** Oturum (JWT) ömrü, DAKİKA. Yeni key yoksa saat*60'a düşer, o da yoksa 480 (8 saat). */
export function useSessionDurationMinutes(): number {
  const q = useFeatureFlags();
  const f = q.data?.data;
  if (f?.sessionDurationMinutes != null) return f.sessionDurationMinutes;
  if (f?.sessionDurationHours != null) return f.sessionDurationHours * 60;
  return 480;
}

/** Oturum (JWT) ömrü, saat. Yüklenene kadar 8 (backend varsayılanı). Geriye uyum. */
export function useSessionDurationHours(): number {
  const q = useFeatureFlags();
  return q.data?.data?.sessionDurationHours ?? 8;
}

/** Hareketsizlik zaman aşımı, dakika. Yüklenene kadar 0 (kapalı). */
export function useIdleTimeoutMinutes(): number {
  const q = useFeatureFlags();
  return q.data?.data?.idleTimeoutMinutes ?? 0;
}

/** Çalışma oturumu (saha) idle zaman aşımı, dakika. Yüklenene kadar 20 (yeni default). */
export function useWorkSessionIdleTimeoutMinutes(): number {
  const q = useFeatureFlags();
  return q.data?.data?.workSessionIdleTimeoutMinutes ?? 20;
}

/** Token süresi dolunca otomatik çıkış açık mı. Yüklenene kadar true (default açık). */
export function useAutoLogoutOnExpiry(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.autoLogoutOnExpiry ?? true;
}

/** Mobil hareketsizlik kilidi açık mı. Yüklenene kadar true (default açık). */
export function useMobileIdleLockEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.mobileIdleLockEnabled ?? true;
}

/** Mobil hareketsizlik kilidi süresi, dakika. Yüklenene kadar 10 (default). */
export function useMobileIdleLockMinutes(): number {
  const q = useFeatureFlags();
  return q.data?.data?.mobileIdleLockMinutes ?? 10;
}

/** Aynı tip oturum politikası. Yüklenene/geçersiz değerde kadar 'kick' (default). */
export function useSameTypeSessionPolicy(): SameTypeSessionPolicy {
  const q = useFeatureFlags();
  const v = q.data?.data?.sameTypeSessionPolicy;
  return isSameTypeSessionPolicy(v) ? v : "kick";
}

/** Saha #20: top adı format şablonu. Yüklenene kadar default. */
export function useRollNameTemplate(): string {
  const q = useFeatureFlags();
  return q.data?.data?.rollNameTemplate?.trim() || "{item} {color} {width}";
}

export const FEATURE_FLAGS_QUERY_KEY = QUERY_KEY;
