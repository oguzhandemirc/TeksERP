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

/** KK1 ham kumaş girişinde ağırlık (kg) alanı açık mı? Default false; backend ENFORCE eder. */
export function useKk1WeightEntryEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.kk1WeightEntryEnabled ?? false;
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

/** Müşteri şubeleri (sevk noktaları) açık mı. Yüklenene kadar true (default açık). */
export function useCustomerBranchesEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.customerBranchesEnabled ?? true;
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

/** Mutlak oturum tavanı, gün. Yüklenene kadar 30 (default). 0 = süresiz. */
export function useAbsoluteSessionCapDays(): number {
  const q = useFeatureFlags();
  return q.data?.data?.absoluteSessionCapDays ?? 30;
}

/** Hızlı PIN/kart deneme kilidi açık mı. Yüklenene kadar true (default açık). */
export function usePinLockoutEnabled(): boolean {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutEnabled ?? true;
}

/** Hızlı PIN/kart deneme kilidi: izin verilen yanlış deneme. Yüklenene kadar 5. */
export function usePinLockoutAttempts(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutAttempts ?? 5;
}

/** Hızlı PIN/kart deneme kilidi: kısa ceza süresi (sn). Yüklenene kadar 60. */
export function usePinLockoutPenaltySec(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutPenaltySec ?? 60;
}

/** Hızlı PIN/kart deneme kilidi: uzun cezaya geçiş eşiği (tur). Yüklenene kadar 3. */
export function usePinLockoutEscalateAfter(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutEscalateAfter ?? 3;
}

/** Hızlı PIN/kart deneme kilidi: uzun ceza süresi (dk). Yüklenene kadar 15. */
export function usePinLockoutLongPenaltyMin(): number {
  const q = useFeatureFlags();
  return q.data?.data?.pinLockoutLongPenaltyMin ?? 15;
}

/** Aynı tip oturum politikası. Yüklenene/geçersiz değerde kadar 'kick' (default). */
export function useSameTypeSessionPolicy(): SameTypeSessionPolicy {
  const q = useFeatureFlags();
  const v = q.data?.data?.sameTypeSessionPolicy;
  return isSameTypeSessionPolicy(v) ? v : "kick";
}

/** Otomatik gece yedeğinin saati (sunucu yerel saati). Yüklenene kadar 3 (default). */
export function useBackupHour(): number {
  const q = useFeatureFlags();
  return q.data?.data?.backupHour ?? 3;
}

export const FEATURE_FLAGS_QUERY_KEY = QUERY_KEY;
