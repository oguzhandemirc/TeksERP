import { useQuery } from '@tanstack/react-query';
import { featureFlagService } from '../services/featureFlag.service';
import { useAuthStore } from '../store/authStore';

// Feature flag'ler app genelinde tek query — React Query cache'i AsyncStorage'a
// persist edildiği için (App.tsx) son bilinen değer offline'da da uygulanır.
// App.tsx foreground'da bu key'i invalidate eder (admin toggle'ı yansısın).
export const FLAGS_KEY = ['feature-flags'] as const;

export function useFeatureFlags() {
  // Uç auth'lu: token yokken (login ekranı) istek atma — logout sonrası
  // garanti 401 çifti + sahte "Oturum süresi doldu" toast'ı üretiyordu.
  // Cache'teki son değer disabled'ken de okunur (offline davranış korunur).
  const hasToken = useAuthStore((s) => !!s.token);
  return useQuery({
    queryKey: FLAGS_KEY,
    queryFn: featureFlagService.get,
    staleTime: 5 * 60 * 1000,
    enabled: hasToken,
  });
}

/** KK1 ham en girişi açık mı? Yüklenene kadar / hata halinde false (gizli). */
export function useRawWidthEnabled(): boolean {
  return useFeatureFlags().data?.rawWidthEnabled ?? false;
}

/** KK1 manuel girişte ağırlık (kg) alanı açık mı? Default false (gizli).
 *  Backend de ENFORCE eder — kapalıyken gönderilen kg reddedilir. */
export function useKk1WeightEntryEnabled(): boolean {
  return useFeatureFlags().data?.kk1WeightEntryEnabled ?? false;
}

/** İade kabulünde personel kaliteyi değiştirebilir mi? Default false (gizli). */
export function useReturnGradingEnabled(): boolean {
  return useFeatureFlags().data?.returnGradingEnabled ?? false;
}

/** Kartela kabulünde cm/kg ölçü alanları gösterilsin mi? Default false (yalnız adet). */
export function useKartelaMeasurementEnabled(): boolean {
  return useFeatureFlags().data?.kartelaMeasurementEnabled ?? false;
}

/** Fason Sevk'te operatör fason talimatını telefondan girebilir mi? Default false (gizli). */
export function useFasonNoteMobileEntry(): boolean {
  return useFeatureFlags().data?.fasonNoteMobileEntry ?? false;
}

/** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu? Default false →
 *  ① ekranında "Hemen Sevk Et" kısayolu görünür. Açıkken çıkış yalnız ②'den onaylanır. */
export function useShipmentConfirmationEnabled(): boolean {
  return useFeatureFlags().data?.shipmentConfirmationEnabled ?? false;
}

/** Tambur'da çıkan top metresi kayıtlı metreyi aşabilir mi? Default TRUE (açık →
 *  aşımda operatöre onay diyaloğu gösterilir). Admin kapatırsa aşan giriş engellenir. */
export function useTamburOverQuantityEnabled(): boolean {
  return useFeatureFlags().data?.tamburOverQuantityEnabled ?? true;
}

/** Token süresi dolunca otomatik logout açık mı? Default TRUE (yüklenene kadar da açık). */
export function useAutoLogoutOnExpiry(): boolean {
  return useFeatureFlags().data?.autoLogoutOnExpiry ?? true;
}

/** Mobil hareketsizlik kilidi açık mı? Default TRUE. Kapalıysa ASLA kilitlenme. */
export function useMobileIdleLockEnabled(): boolean {
  return useFeatureFlags().data?.mobileIdleLockEnabled ?? true;
}

/** Kaç dakika hareketsizlikte kilit? Default 10 (1..120). */
export function useMobileIdleLockMinutes(): number {
  return useFeatureFlags().data?.mobileIdleLockMinutes ?? 10;
}

/** Uygulama arka plana geçince anında kilitle? Default TRUE. Idle kilitten bağımsız. */
export function useMobileLockOnBackground(): boolean {
  return useFeatureFlags().data?.mobileLockOnBackground ?? true;
}

/** Mobil baskıda raster GW bitmap gönder? Default FALSE (komut yolu). HC-06'da yavaşsa kapalı. */
export function useMobileRasterEnabled(): boolean {
  return useFeatureFlags().data?.mobileRasterEnabled ?? false;
}
