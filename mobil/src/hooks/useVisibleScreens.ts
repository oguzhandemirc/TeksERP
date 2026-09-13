import { useMemo } from 'react';
import { usePermissions } from './usePermission';
import { useFeatureFlags } from './useFeatureFlags';
import { conditionalScreens } from '../constants/screenModules';
import type { MobileScreenMeta } from '../types/permissions';

// =============================================================================
// GÖRÜNÜR EKRANLAR = izinli ekranlar ∖ modülü KAPALI ekranlar
//
// `usePermissions().allowedScreens` YETKİYİ söyler; modül anahtarı (`production.enabled`
// …) DÜZENİ söyler — yetki var ama modül o fabrikada kapalıysa ekran çizilmez.
// Ayrım tek yerde yapılır ki "ekranı kaydeden" (MainNavigator) ile "grid'de
// gösteren" (useModuleOrder → ModuleSelect) aynı listeyi görsün: aksi hâlde
// kartı gizleyip route'u açık bırakmak (ya da tersi) mümkün olur.
//
// 2026-09-14'e dek koşul kümesi BOŞTU (mekanizma bilerek duruyordu): tablette
// modül kapısı yoktu, kapalı modülün kartı çiziliyor ve backend 403
// `MODULE_DISABLED` basıyordu. Koşul artık `constants/screenModules.ts`ten
// (kataloğun `modul` aynası) dolar; kapalı modülde kart yok ⇒ istek yok.
// Varsayılan yön alan başına backend'le aynı (üretim AÇIK) — bayrak yüklenene
// dek liste bugünkünün birebir aynısıdır.
//
// ⚠️ NoAccess kapısı (RootNavigator.hasAnyMobileScreen) BİLİNÇLİ olarak HAM
// yetkide kalır: modül kapalı diye kullanıcıyı "hiç yetkin yok" ekranına
// atmayız — yetkisi durur, düzen kapalıdır.
// =============================================================================

export function useVisibleScreens() {
  const { allowedScreens } = usePermissions();
  const flags = useFeatureFlags().data;

  return useMemo(() => {
    const conditional = conditionalScreens(flags);
    const visibleScreens: MobileScreenMeta[] = allowedScreens.filter(
      (s) => conditional[s.key] !== false
    );
    return {
      visibleScreens,
      hasAnyVisibleScreen: visibleScreens.length > 0,
      hasMultipleVisibleScreens: visibleScreens.length > 1,
    };
  }, [allowedScreens, flags]);
}
