// =============================================================================
// SEMANTİK KATMAN — İZİN ve MODÜL (R1-SEMCEK; plan §3.1 "İzin")
// =============================================================================
// Her küp/ölçü/boyut izin + modül taşır; denetim DERLEYİCİNİN içindedir (route guard'ı yalnız
// kimlik + "herhangi bir rapor izni" ister). Paylaşım görünürlük verir, veri yetkisi vermez.
// FAIL-CLOSED: tanınmayan modül değeri kapalı sayılır.
// =============================================================================
import { createHash } from "node:crypto";
import { matchesPermission } from "../../../middlewares/rbac.middleware";
import { MODULE_SETTING_KEY_BY_FLAG, systemSettingService } from "../../system-setting.service";
import type { ModuleRef } from "./tipler";

export interface AccessContext {
  userId: string;
  permissions: readonly string[];
  /** Açık modüllerin DB anahtarları (`production.enabled`) — bayrak ∧ lisans tavanı. */
  openModuleKeys: ReadonlySet<string>;
}

export async function loadAccessContext(user: { userId: string; permissions: readonly string[] }): Promise<AccessContext> {
  const open = await systemSettingService.getOpenModuleKeys();
  return { userId: user.userId, permissions: user.permissions, openModuleKeys: new Set(open) };
}

export function isModuleOpen(module: ModuleRef | undefined, ctx: AccessContext): boolean {
  if (module === undefined || module.startsWith("cekirdek:")) return true;
  const key = MODULE_SETTING_KEY_BY_FLAG[module];
  return key !== undefined && ctx.openModuleKeys.has(key);
}

export function canAccess(item: { permission?: string; module?: ModuleRef }, ctx: AccessContext): boolean {
  if (item.permission !== undefined && !matchesPermission(ctx.permissions, item.permission)) return false;
  return isModuleOpen(item.module, ctx);
}

/** Önbellek anahtarı parçası: izin kümesi + açık modüller değişince eski sonuç paylaşılmaz. */
export function accessDigest(ctx: AccessContext): string {
  const body = JSON.stringify([[...ctx.permissions].sort(), [...ctx.openModuleKeys].sort()]);
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}
