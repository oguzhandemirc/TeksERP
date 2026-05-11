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

export function hasAdminAccess(permissions: string[]): boolean {
  return ADMIN_PERMISSION_LIST.some((p) => permissions.includes(p));
}

export function canEnterApp(permissions: string[]): boolean {
  return permissions.length > 0;
}
