import { useAuthStore } from "@/store/useAuthStore";
import { useCallback } from "react";

export function useRoleAccess() {
  const user = useAuthStore((s) => s.user);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      return user.permissions.includes(permission);
    },
    [user],
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]): boolean => {
      if (!user) return false;
      return permissions.some((p) => user.permissions.includes(p));
    },
    [user],
  );

  const hasRole = useCallback(
    (role: string): boolean => {
      if (!user) return false;
      return user.roles.includes(role);
    },
    [user],
  );

  const isAdmin = user?.roles.includes("Admin") ?? false;

  return { hasPermission, hasAnyPermission, hasRole, isAdmin, user };
}
