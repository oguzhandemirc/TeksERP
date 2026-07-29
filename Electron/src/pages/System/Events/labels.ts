import type { SystemLogCategory } from "@/types/systemLog";

export const categoryLabels: Record<SystemLogCategory, string> = {
  DOMAIN: "Veri Değişikliği",
  AUTH: "Kimlik Doğrulama",
  SYSTEM: "Sistem",
};

export const categoryVariants: Record<
  SystemLogCategory,
  "default" | "secondary" | "destructive" | "outline"
> = {
  DOMAIN: "outline",
  AUTH: "secondary",
  SYSTEM: "default",
};

// AUTH ve SYSTEM altındaki action'lar — Sistem Kayıtları sayfasının filter
// dropdown'ı bunları kullanır. Backend hardcoded, frontend de hardcoded.
export const eventActionLabels: Record<string, string> = {
  // AUTH
  LOGIN_SUCCESS: "Başarılı giriş",
  LOGIN_FAILED: "Başarısız giriş",
  LOGOUT: "Çıkış yapıldı",
  // SYSTEM
  STARTUP: "Sunucu başlatıldı",
  ERROR: "Beklenmeyen hata",
  UNHANDLED_REJECTION: "Yakalanmayan hata (async)",
  UNCAUGHT_EXCEPTION: "Yakalanmayan istisna",
  AUDIT_ARCHIVE: "Log arşivlendi",
  BACKUP_TRIGGER: "Yedekleme başlatıldı",
  BACKUP_DOWNLOAD: "Yedek indirildi",
  PERIPHERAL_TEST: "Cihaz testi",
};

export function eventActionLabel(action: string): string {
  return eventActionLabels[action] ?? action;
}

const ERROR_ACTIONS = new Set([
  "LOGIN_FAILED",
  "ERROR",
  "UNHANDLED_REJECTION",
  "UNCAUGHT_EXCEPTION",
]);

export function eventActionVariant(
  action: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (ERROR_ACTIONS.has(action)) return "destructive";
  if (action === "LOGIN_SUCCESS" || action === "LOGOUT") return "secondary";
  if (action === "STARTUP") return "default";
  return "outline";
}

// Filter'da hangi action'lar hangi kategori altında görünecek — backend'in
// bastığı tüm AUTH/SYSTEM action'larıyla senkron (eksikse ekranda ham İngilizce çıkar).
export const ACTIONS_BY_CATEGORY: Record<"AUTH" | "SYSTEM", string[]> = {
  AUTH: ["LOGIN_SUCCESS", "LOGIN_FAILED", "LOGOUT"],
  SYSTEM: [
    "STARTUP",
    "ERROR",
    "UNHANDLED_REJECTION",
    "UNCAUGHT_EXCEPTION",
    "AUDIT_ARCHIVE",
    "BACKUP_TRIGGER",
    "BACKUP_DOWNLOAD",
    "PERIPHERAL_TEST",
  ],
};
