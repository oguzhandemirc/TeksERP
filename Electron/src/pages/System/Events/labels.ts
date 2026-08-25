import { EVENT_ACTION_LABELS } from "@/lib/audit-labels";
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

// AUTH ve SYSTEM olay adları — TEK KAYNAK `@/lib/audit-labels`.
// (Denetim Raporları ekranı da aynı haritadan besleniyor; ayrı yazıldıklarında
// biri 11, diğeri 8 olay biliyordu ve backend 27 olay basıyordu.)
export { EVENT_ACTION_LABELS as eventActionLabels, eventActionLabel } from "@/lib/audit-labels";

// Kırmızı rozet alan olaylar. ⚠️ Sözlüğe yeni bir `*_FAILED` eklenirse buraya
// da yaz — aksi halde başarısızlık başarıyla aynı renkte görünür.
const ERROR_ACTIONS = new Set([
  "LOGIN_FAILED",
  "LOGIN_CONFLICT",
  "ERROR",
  "UNHANDLED_REJECTION",
  "UNCAUGHT_EXCEPTION",
  "BACKUP_FAILED",
  "DB_COPY_FAILED",
  "PERMISSION_CATALOG_RECONCILE_FAILED",
]);

export function eventActionVariant(
  action: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (ERROR_ACTIONS.has(action)) return "destructive";
  if (action === "LOGIN_SUCCESS" || action === "LOGOUT") return "secondary";
  if (action === "STARTUP") return "default";
  return "outline";
}

// Filtre açılırında hangi olay hangi kategori altında görünecek.
// ⚠️ Liste ELLE TUTULMAZ: sözlükten türer, yani sözlüğe eklenen her yeni olay
// filtrede de kendiliğinden belirir. Eski hâli elle yazılmıştı ve backend 27
// olay basarken filtre 11'ini gösteriyordu.
const AUTH_ACTIONS = new Set(["LOGIN_SUCCESS", "LOGIN_FAILED", "LOGIN_CONFLICT", "LOGOUT"]);

export const ACTIONS_BY_CATEGORY: Record<"AUTH" | "SYSTEM", string[]> = {
  AUTH: Object.keys(EVENT_ACTION_LABELS).filter((a) => AUTH_ACTIONS.has(a)),
  SYSTEM: Object.keys(EVENT_ACTION_LABELS).filter((a) => !AUTH_ACTIONS.has(a)),
};
