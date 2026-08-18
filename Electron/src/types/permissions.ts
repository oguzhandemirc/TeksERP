export interface Permission {
  id: string;
  code: string;
  module: string;
  category: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  /** Bu yetkiyi taşıyan kullanıcı sayısı. Yalnız yetki kataloğu ucunda döner
   *  (kullanıcı/şablon gridleri bu alanı taşımaz) → opsiyonel. */
  userCount?: number;
  /** Bu yetkiyi içeren şablon (rol) sayısı. */
  templateCount?: number;
  /**
   * Bu yetkiyi içeren AKTİF rollerin adları — "normalde kime verilir" ipucu.
   *
   * ⚠️ ÖNERİ, KISIT DEĞİL: rolde geçmeyen bir yetki de pekâlâ verilebilir
   * (saha personelinin bir kısmı kilit rolde ve rol dışı yetki taşıyor —
   * 2026-08-19 kullanıcı kararı). Liste TÜRETİLMİŞTİR: rol kataloğu değişince
   * kendiliğinden güncellenir, elle bakılacak ikinci bir eşleme doğmaz.
   */
  roleNames?: string[];
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
  KARTELA: "Kartela",
  REPORTS: "Raporlar",
  ADMIN: "Yönetim",
  MOBILE: "Mobil Ekranlar",
};

export function isWildcard(code: string): boolean {
  return code.endsWith(":*");
}
