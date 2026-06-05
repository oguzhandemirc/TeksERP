import { useQuery } from '@tanstack/react-query';
import { featureFlagService } from '../services/featureFlag.service';

// Feature flag'ler app genelinde tek query — React Query cache'i AsyncStorage'a
// persist edildiği için (App.tsx) son bilinen değer offline'da da uygulanır.
// App.tsx foreground'da bu key'i invalidate eder (admin toggle'ı yansısın).
export const FLAGS_KEY = ['feature-flags'] as const;

export function useFeatureFlags() {
  return useQuery({
    queryKey: FLAGS_KEY,
    queryFn: featureFlagService.get,
    staleTime: 5 * 60 * 1000,
  });
}

/** KK1 ham en girişi açık mı? Yüklenene kadar / hata halinde false (gizli). */
export function useRawWidthEnabled(): boolean {
  return useFeatureFlags().data?.rawWidthEnabled ?? false;
}

/** İade kabulünde personel kaliteyi değiştirebilir mi? Default false (gizli). */
export function useReturnGradingEnabled(): boolean {
  return useFeatureFlags().data?.returnGradingEnabled ?? false;
}

/** Fason Sevk'te operatör boyahane notunu telefondan girebilir mi? Default false (gizli). */
export function useDyehouseNoteMobileEntry(): boolean {
  return useFeatureFlags().data?.dyehouseNoteMobileEntry ?? false;
}

/** Sevk için ayrı "ambar aldı / çıkış" onay adımı zorunlu mu? Default false →
 *  ① ekranında "Hemen Sevk Et" kısayolu görünür. Açıkken çıkış yalnız ②'den onaylanır. */
export function useShipmentConfirmationEnabled(): boolean {
  return useFeatureFlags().data?.shipmentConfirmationEnabled ?? false;
}
