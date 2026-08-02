import { useMemo } from 'react';
import { usePermissions } from './usePermission';
import { useKursunBypassEnabled } from './useFeatureFlags';
import { usePendingKursunAssignmentCount } from './useKursunBypassVisibility';
import type { MobileScreenKey, MobileScreenMeta } from '../types/permissions';

// =============================================================================
// GÖRÜNÜR EKRANLAR = izinli ekranlar ∖ koşulu sağlanmayan ekranlar
//
// `usePermissions().allowedScreens` YETKİYİ söyler; bazı ekranlar ayrıca bir
// düzen koşuluna bağlıdır (yetki var ama düzen o fabrikada kurulu değil). Bu
// ayrımı tek yerde yapıyoruz ki "ekranı kaydeden" (MainNavigator) ile "grid'de
// gösteren" (useModuleOrder → ModuleSelect) aynı listeyi görsün: aksi hâlde
// kartı gizleyip route'u açık bırakmak (ya da tersi) mümkün olur.
//
// ⚠️ Koşul SAF BAYRAK DEĞİL — "işi kaldıysa durur" (2026-08-02): bayrak
// kapatıldığında ekranı tamamen gizlemek, dağıtılmış işi sahada kilitliyordu
// (route açık ama mobilde ekrana ulaşacak kapı yok → iş ne iptal ne bitirilebilir).
// Gerekçe ve sayaç sözleşmesi: `useKursunBypassVisibility.ts`.
//
// ⚠️ NoAccess kapısı (RootNavigator.hasAnyMobileScreen) BİLİNÇLİ olarak HAM
// yetkide kalır: koşul sağlanmadı diye kullanıcıyı "hiç yetkin yok" ekranına
// atmayız — yetkisi durur, düzen kapalıdır.
// =============================================================================

/** Koşula bağlı ekranlar: anahtar → o an gösterilmeli mi. */
type ConditionalScreens = Partial<Record<MobileScreenKey, boolean>>;

export function useVisibleScreens() {
  const { allowedScreens } = usePermissions();
  // Bayrak yüklenene kadar false, sayaç yüklenene kadar 0 → ekran gizli
  // (fail-closed); ikisinden biri "iş var" der demez ekran kendiliğinden belirir.
  const kursunBypassEnabled = useKursunBypassEnabled();
  const pendingKursunAssignments = usePendingKursunAssignmentCount();

  return useMemo(() => {
    const conditional: ConditionalScreens = {
      // Bayrak AÇIK (yeni dağıtım yapılabilir) VEYA ortada bitmemiş dağıtım VAR
      // (saha onu iptal/tamamlayabilmeli). Son iş kapanınca sayaç 0'a düşer ve
      // ekran kendiliğinden kaybolur.
      KursunDagitim: kursunBypassEnabled || pendingKursunAssignments > 0,
    };
    const visibleScreens: MobileScreenMeta[] = allowedScreens.filter(
      (s) => conditional[s.key] !== false
    );
    return {
      visibleScreens,
      hasAnyVisibleScreen: visibleScreens.length > 0,
      hasMultipleVisibleScreens: visibleScreens.length > 1,
    };
  }, [allowedScreens, kursunBypassEnabled, pendingKursunAssignments]);
}
