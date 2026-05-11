import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { MOBILE_SCREENS, MobileScreenMeta } from '../types/permissions';

const EMPTY_PERMISSIONS: string[] = [];

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? EMPTY_PERMISSIONS;

  return useMemo(() => {
    const set = new Set(permissions);
    const hasMobileWildcard = set.has('mobile:*');
    const hasAdminWildcard = set.has('admin:*');

    const has = (code: string): boolean => {
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
