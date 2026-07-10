// =============================================================================
// Kök navigation ref — NavigationContainer DIŞINDA render edilen ağaçlar için
// =============================================================================
// react-native-paper Portal'ı (AppModal dahil) içeriği PaperProvider'daki
// PortalHost'a taşır; orası NavigationContainer'ın DIŞINDA kalır → portal
// içinde useNavigation() "Couldn't find a navigation object" fırlatır.
// Portal'lanan bileşenler (örn. chip modalındaki PlaceConfirmView) navigasyonu
// bu ref üzerinden yapar. isReady() kontrolü şart: container mount olmadan
// çağrı sessizce yutulur (crash yerine no-op).
// =============================================================================

import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();

/** Kök stack'e güvenli navigate — container hazır değilse no-op. */
export function rootNavigate(name: keyof RootStackParamList): void {
  if (rootNavigationRef.isReady()) {
    rootNavigationRef.navigate(name as never);
  }
}
