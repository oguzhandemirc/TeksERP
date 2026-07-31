import { useMemo } from 'react';
import { usePermissions } from './usePermission';
import { useKursunBypassEnabled } from './useFeatureFlags';
import type { MobileScreenKey, MobileScreenMeta } from '../types/permissions';

// =============================================================================
// GÖRÜNÜR EKRANLAR = izinli ekranlar ∖ bayrağı kapalı ekranlar
//
// `usePermissions().allowedScreens` YETKİYİ söyler; bazı ekranlar ayrıca bir
// feature flag'e bağlıdır (yetki var ama düzen o fabrikada kurulu değil). Bu
// ayrımı tek yerde yapıyoruz ki "ekranı kaydeden" (MainNavigator) ile "grid'de
// gösteren" (useModuleOrder → ModuleSelect) aynı listeyi görsün: aksi hâlde
// kartı gizleyip route'u açık bırakmak (ya da tersi) mümkün olur.
//
// ⚠️ NoAccess kapısı (RootNavigator.hasAnyMobileScreen) BİLİNÇLİ olarak HAM
// yetkide kalır: bayrak kapalı diye kullanıcıyı "hiç yetkin yok" ekranına
// atmayız — yetkisi durur, düzen kapalıdır.
// =============================================================================

/** Feature flag'e bağlı ekranlar: anahtar → o an açık mı. */
type FlagGatedScreens = Partial<Record<MobileScreenKey, boolean>>;

export function useVisibleScreens() {
  const { allowedScreens } = usePermissions();
  // Bayrak yüklenene kadar false → ekran gizli (fail-closed); flag gelince belirir.
  const kursunBypassEnabled = useKursunBypassEnabled();

  return useMemo(() => {
    const gated: FlagGatedScreens = { KursunDagitim: kursunBypassEnabled };
    const visibleScreens: MobileScreenMeta[] = allowedScreens.filter(
      (s) => gated[s.key] !== false
    );
    return {
      visibleScreens,
      hasAnyVisibleScreen: visibleScreens.length > 0,
      hasMultipleVisibleScreens: visibleScreens.length > 1,
    };
  }, [allowedScreens, kursunBypassEnabled]);
}
