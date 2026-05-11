import type { ReactNode } from "react";
import { useRoleAccess } from "@/hooks/useRoleAccess";

interface Props {
  permission?: string;
  anyOf?: string[];
  allOf?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({ permission, anyOf, allOf, fallback = null, children }: Props) {
  const { hasPermission, hasAnyPermission, hasAllPermissions, isAdmin } = useRoleAccess();

  if (isAdmin) return <>{children}</>;

  if (permission && !hasPermission(permission)) return <>{fallback}</>;
  if (anyOf && !hasAnyPermission(anyOf)) return <>{fallback}</>;
  if (allOf && !hasAllPermissions(allOf)) return <>{fallback}</>;

  return <>{children}</>;
}
