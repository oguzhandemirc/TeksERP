import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { MOBILE_SCREENS, MobileScreenMeta } from '../types/permissions';

const EMPTY_PERMISSIONS: string[] = [];

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? EMPTY_PERMISSIONS;

  return useMemo(() => {
    const set = new Set(permissions);
    // ⚠️ GLOBAL JOKER — Electron `matchesPermission`ın ve backend
    // `rbac.middleware.matchesPermission`ın mobil ikizi (2026-09-03). Satıcı
    // (süperadmin) hesabı backend'den `["*"]` alır; bu dal olmadan `has()` HER
    // kod için false döner, `allowedScreens` BOŞ kalır ve RootNavigator
    // "yetkin yok" ekranına düşer — yani giriş BAŞARILI görünür, hata yoktur,
    // ekran yoktur. Arıza yetki katmanında değil GÖRÜNÜRLÜK katmanındadır.
    // Backend `*`i zaten kabul ettiği için istemcide daraltmak yalnız sessiz
    // tutarsızlık üretirdi. Saf JS → OTA ile gider, APK gerekmez.
    const hasGlobalWildcard = set.has('*');
    const hasMobileWildcard = set.has('mobile:*');
    const hasAdminWildcard = set.has('admin:*');

    const has = (code: string): boolean => {
      if (hasGlobalWildcard) return true;
      if (set.has(code)) return true;
      if (code.startsWith('mobile:') && hasMobileWildcard) return true;
      if (code.startsWith('admin:') && hasAdminWildcard) return true;
      return false;
    };

    const allowedScreens: MobileScreenMeta[] = MOBILE_SCREENS.filter((s) =>
      has(s.permission)
    );

    return {
      permissions,
      has,
      allowedScreens,
      hasAnyMobileScreen: allowedScreens.length > 0,
      hasMultipleMobileScreens: allowedScreens.length > 1,
    };
  }, [permissions]);
}
