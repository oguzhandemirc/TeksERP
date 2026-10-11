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
import type { AlarmTarget } from '../lib/loomAlarm/deepLink';

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

/** Bildirime dokunma (derin bağlantı): Main → Uyarılar / alarm sayfası. Container hazır değilse
 *  (soğuk açılış) kısa aralıklarla birkaç kez yeniden dener; sonra vazgeçer (uydurulmuş yol yok). */
export function rootNavigateToAlarm(target: AlarmTarget, tries = 10): void {
  if (!rootNavigationRef.isReady()) {
    if (tries > 0) setTimeout(() => rootNavigateToAlarm(target, tries - 1), 300);
    return;
  }
  const nav = rootNavigationRef.navigate as (name: 'Main', params: { screen: string; params?: object }) => void;
  if (target.screen === 'UyariDetay') nav('Main', { screen: 'UyariDetay', params: { alarmId: target.alarmId } });
  else nav('Main', { screen: 'Uyarilar' });
}
