export interface JwtPayload {
  userId: string;
  username: string;
  permissions: string[];
  /** Oturum registry kimliği (backend `jwt.sign {jwtid}` ile eklenir). Eski
   *  token'larda olmayabilir — opsiyonel. Backend middleware bu jti'yi Session
   *  tablosunda arar; iptal edilmişse sonraki istek 401 alır. */
  jti?: string;
  /** Token sona erme (saniye, epoch). Otomatik-logout zamanlaması bunu kullanır. */
  exp?: number;
  /** Token üretim zamanı (saniye, epoch). */
  iat?: number;
}

/** Giriş yapan istemcinin türü — same-type oturum politikası bununla ayrışır. */
export type ClientType = "electron" | "mobile";

/** Aynı hesabın aynı tip cihazda ikinci oturumuna karşı politika (backend enforce).
 *  kick = eskiyi düşür, notify = kullanıcıya sor, off = sınırsız çoklu oturum. */
export type SameTypeSessionPolicy = "kick" | "notify" | "off";

export interface LoginRequest {
  username: string;
  password: string;
  /** İstemci türü — Electron her zaman 'electron' gönderir (default 'mobile'). */
  clientType?: ClientType;
  /** 'notify' politikasında aynı hesap başka yerde açıkken kullanıcı onayı verince
   *  true ile tekrar çağrılır; backend iki oturumu da açık tutar. */
  confirmKick?: boolean;
}

/** 409 SESSION_EXISTS yanıtındaki mevcut oturum bilgisi (backend `details`). */
export interface ExistingSessionInfo {
  deviceType: ClientType;
  createdAt: string;
  deviceId: string | null;
}

/** Backend 409 conflict `details.code` değeri — aynı hesap başka yerde açık. */
export const SESSION_EXISTS_CODE = "SESSION_EXISTS" as const;

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
