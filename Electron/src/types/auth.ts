export interface JwtPayload {
  userId: string;
  username: string;
  permissions: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: JwtPayload;
  };
  message: string;
}

export const ADMIN_PERMISSIONS = {
  USERS: "admin:users",
  SETTINGS: "admin:settings",
  WILDCARD: "admin:*",
} as const;

export const ADMIN_PERMISSION_LIST = Object.values(ADMIN_PERMISSIONS);

/**
 * Y6 fix: backend `matchesPermission` (rbac.middleware.ts) ile BİREBİR aynı
 * semantik — global "*", exact kod, tek-seviyeli domain wildcard ("admin:*" →
 * yalnız "admin:..." kodları). Frontend'in eski "isAdmin ise her şey serbest"
 * kısayolu backend'le uyuşmuyordu: sadece admin:users verilen kullanıcı tüm
 * UI'ı görüp her tıklamada 403 yiyordu.
 */
export function matchesPermission(
  userPermissions: readonly string[],
  required: string,
): boolean {
  if (userPermissions.includes("*")) return true;
  if (userPermissions.includes(required)) return true;
  const colon = required.indexOf(":");
  if (colon > 0) {
    const domainWildcard = `${required.slice(0, colon)}:*`;
    if (userPermissions.includes(domainWildcard)) return true;
  }
  return false;
}

/** ADMIN modülü görünürlüğü için (nav/adminOnly öğeler) — yetki bypass'ı DEĞİL. */
export function hasAdminAccess(permissions: string[]): boolean {
  return ADMIN_PERMISSION_LIST.some((p) => permissions.includes(p));
}

export function canEnterApp(permissions: string[]): boolean {
  return permissions.length > 0;
}
