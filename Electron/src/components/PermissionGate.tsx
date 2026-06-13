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
  // Y6 fix: isAdmin bypass'ı kaldırıldı — hasPermission artık backend'le aynı
  // wildcard semantiğini kullanıyor (admin:* yalnız admin:... kodlarını kapsar);
  // kısmi admin, yetkisi olmayan modülün butonlarını artık GÖRMEZ.
  const { hasPermission, hasAnyPermission, hasAllPermissions } = useRoleAccess();

  if (permission && !hasPermission(permission)) return <>{fallback}</>;
  if (anyOf && !hasAnyPermission(anyOf)) return <>{fallback}</>;
  if (allOf && !hasAllPermissions(allOf)) return <>{fallback}</>;

  return <>{children}</>;
}
