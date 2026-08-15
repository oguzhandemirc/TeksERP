// =============================================================================
// Kök navigation ref — NavigationContainer DIŞINDA render edilen ağaçlar için
// =============================================================================
// Portal (AppModal → SimplePortal; ayrıca paper `Portal`) içeriği App.tsx'teki
// kök host katmanına taşır; orası NavigationContainer'ın DIŞINDA kalır → portal
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

/** Modül/istasyon seçimine (Main → ModuleSelect) güvenli dön — gate'ten "istasyon
 *  değiştir" için. useNavigation Portal'da (chip) throw ettiğinden ref üzerinden. */
export function rootNavigateToModuleSelect(): void {
  if (rootNavigationRef.isReady()) {
    // RootStackParamList 'Main'i undefined param'la tanımlar → iç içe (nested)
    // hedefi tiplemez; kontrollü fonksiyon-cast ile Main → ModuleSelect'e git.
    (rootNavigationRef.navigate as (name: 'Main', params: { screen: string }) => void)(
      'Main',
      { screen: 'ModuleSelect' },
    );
  }
}
