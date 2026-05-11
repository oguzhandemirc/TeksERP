import { useAuthStore } from "@/store/auth";
import { hasAdminAccess } from "@/types/auth";

export function useRoleAccess() {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permissions ?? [];
  const isAdmin = hasAdminAccess(permissions);

  return {
    user,
    permissions,
    isAdmin,
    hasPermission: (perm: string) => isAdmin || permissions.includes(perm),
    hasAnyPermission: (perms: string[]) => isAdmin || perms.some((p) => permissions.includes(p)),
    hasAllPermissions: (perms: string[]) => isAdmin || perms.every((p) => permissions.includes(p)),
  };
}
