// =============================================================================
// TeksERP - System Setting / core
// =============================================================================
// Ortak okuma çekirdeği: JsonValue → tip çeviricileri.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import { Prisma } from "@prisma/client";


/**
 * SystemSetting.value bir JsonValue. Reader yardımcıları: gelen değer
 * hangi tipte olursa olsun beklenen tipe çevirmeye çalışır (backward
 * compatible — eski string-encoded değerleri de okur).
 */
export function asNumber(value: Prisma.JsonValue | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asBoolean(value: Prisma.JsonValue | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}
