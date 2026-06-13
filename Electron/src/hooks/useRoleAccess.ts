import { useAuthStore } from "@/store/auth";
import { hasAdminAccess, matchesPermission } from "@/types/auth";

export function useRoleAccess() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? [];
  // isAdmin = ADMIN modülü görünürlüğü (adminOnly nav/tile). Yetki KISAYOLU
  // değildir — Y6 fix: eski "isAdmin ise her permission true" bypass'ı
  // backend'in domain-wildcard semantiğiyle uyuşmuyordu (kısmi admin tüm UI'ı
  // görüp her tıklamada 403 alıyordu). Kontroller artık backend'le birebir
  // matchesPermission üzerinden.
  const isAdmin = hasAdminAccess(permissions);

  return {
    user,
    permissions,
    isAdmin,
    hasPermission: (perm: string) => matchesPermission(permissions, perm),
    hasAnyPermission: (perms: string[]) => perms.some((p) => matchesPermission(permissions, p)),
    hasAllPermissions: (perms: string[]) => perms.every((p) => matchesPermission(permissions, p)),
  };
}
