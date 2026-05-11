export interface Permission {
  id: string;
  code: string;
  module: string;
  category: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPermissionGrant {
  id: string;
  userId: string;
  permissionId: string;
  validFrom: string | null;
  validUntil: string | null;
  grantedById: string | null;
  permission: Permission;
  createdAt: string;
  updatedAt: string;
}

export const categoryLabels: Record<string, string> = {
  web: "Masaüstü Yetkileri",
  mobile: "Mobil Yetkileri",
  admin: "Yönetim Yetkileri",
};

export const moduleLabels: Record<string, string> = {
  SALES: "Satış",
  PRODUCTION: "Üretim",
  MASTER_DATA: "Tanım Verileri",
  QUALITY: "Kalite",
  LOGISTICS: "Lojistik",
  SUBCONTRACTOR: "Fason",
  ADMIN: "Yönetim",
  MOBILE: "Mobil Ekranlar",
};

export function isWildcard(code: string): boolean {
  return code.endsWith(":*");
}
