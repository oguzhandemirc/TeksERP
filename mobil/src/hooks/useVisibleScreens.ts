import { useMemo } from 'react';
import { usePermissions } from './usePermission';
import type { MobileScreenKey, MobileScreenMeta } from '../types/permissions';

// =============================================================================
// GÖRÜNÜR EKRANLAR = izinli ekranlar ∖ koşulu sağlanmayan ekranlar
//
// `usePermissions().allowedScreens` YETKİYİ söyler; bazı ekranlar ayrıca bir
// düzen koşuluna bağlanabilir (yetki var ama düzen o fabrikada kurulu değil). Bu
// ayrımı tek yerde yapıyoruz ki "ekranı kaydeden" (MainNavigator) ile "grid'de
// gösteren" (useModuleOrder → ModuleSelect) aynı listeyi görsün: aksi hâlde
// kartı gizleyip route'u açık bırakmak (ya da tersi) mümkün olur.
//
// ⚠️ ŞU AN KOŞULLU EKRAN YOK (2026-08-05). Tek koşullu ekran Kurşun Dağıtım'dı
// (`kursunBypassEnabled || pendingKursunAssignments > 0`); Electron tarafında
// Kurşun Sırası + Kurşun Dağıtım "Kurşun Planlama"da birleşip bayraktan
// bağımsızlaşınca mobil ikizi de aynı hizaya çekildi. Gerekçe: ekran artık yalnız
// "yeni dağıtım" yapmıyor — bekleyen kuyruğu da gösteriyor, yani bayrak kapalıyken
// de anlamlı. Ayrıca karo `mobile:kursun-dagitim` ile zaten dar bir izne bağlı;
// izni olmayan kimse görmüyor.
//
// Mekanizma BİLİNÇLİ olarak DURUYOR (tip + filtre): yeni bir düzen-koşullu ekran
// çıkarsa tek satırla eklenir ve iki tüketici de otomatik hizalanır. Silinseydi
// bir sonraki sefer koşul yine iki yere kopyalanırdı.
//
// ⚠️ NoAccess kapısı (RootNavigator.hasAnyMobileScreen) BİLİNÇLİ olarak HAM
// yetkide kalır: koşul sağlanmadı diye kullanıcıyı "hiç yetkin yok" ekranına
// atmayız — yetkisi durur, düzen kapalıdır.
// =============================================================================

/** Koşula bağlı ekranlar: anahtar → o an gösterilmeli mi. */
type ConditionalScreens = Partial<Record<MobileScreenKey, boolean>>;

export function useVisibleScreens() {
  const { allowedScreens } = usePermissions();

  return useMemo(() => {
    const conditional: ConditionalScreens = {};
    const visibleScreens: MobileScreenMeta[] = allowedScreens.filter(
      (s) => conditional[s.key] !== false
    );
    return {
      visibleScreens,
      hasAnyVisibleScreen: visibleScreens.length > 0,
      hasMultipleVisibleScreens: visibleScreens.length > 1,
    };
  }, [allowedScreens]);
}
