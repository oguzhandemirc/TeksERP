import type { SystemLogDomainAction } from "@/types/systemLog";

// Backend `tableName` → Türkçe modül adı: TEK KAYNAK `@/lib/audit-labels`
// (Reports/Audit ile paylaşılır — iki harita drift etmesin). Re-export.
export { tableLabel } from "@/lib/audit-labels";

// Aktivite akışında geçmiş-zaman fiil ("... kaydını oluşturdu"). Reports/Audit
// aynı action'ları emir kipiyle ("Oluştur") gösterir — o yüzden action etiketi
// tableName'in aksine ekrana ÖZEL, paylaşılmaz.
export const actionLabels: Record<SystemLogDomainAction, string> = {
  CREATE: "oluşturdu",
  UPDATE: "düzenledi",
  DELETE: "sildi",
};

export const actionVariants: Record<
  SystemLogDomainAction,
  "default" | "secondary" | "destructive"
> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
};

const DOMAIN_ACTIONS: SystemLogDomainAction[] = ["CREATE", "UPDATE", "DELETE"];

function isDomainAction(action: string): action is SystemLogDomainAction {
  return (DOMAIN_ACTIONS as string[]).includes(action);
}

export function actionLabel(action: string): string {
  return isDomainAction(action) ? actionLabels[action] : action;
}

export function actionVariant(
  action: string,
): "default" | "secondary" | "destructive" {
  return isDomainAction(action) ? actionVariants[action] : "secondary";
}
