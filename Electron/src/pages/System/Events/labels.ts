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
  LOGIN_SUCCESS: "Başarılı giriş",
  LOGIN_FAILED: "Başarısız giriş",
  STARTUP: "Sunucu başlatıldı",
  ERROR: "Beklenmeyen hata",
};

export function eventActionLabel(action: string): string {
  return eventActionLabels[action] ?? action;
}

export function eventActionVariant(
  action: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (action === "LOGIN_FAILED" || action === "ERROR") return "destructive";
  if (action === "LOGIN_SUCCESS") return "secondary";
  if (action === "STARTUP") return "default";
  return "outline";
}

// Filter'da hangi action'lar hangi kategori altında görünecek.
export const ACTIONS_BY_CATEGORY: Record<"AUTH" | "SYSTEM", string[]> = {
  AUTH: ["LOGIN_SUCCESS", "LOGIN_FAILED"],
  SYSTEM: ["STARTUP", "ERROR"],
};
