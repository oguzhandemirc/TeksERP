import { matchesPermission } from "../../middlewares/rbac.middleware";

/**
 * Yetki kademesinin TEK yüklemi: `actor`ün kapsamadığı izin kodları. Hem "başkasına verilen izin ⊆ aktör"
 * kapısı hem "hedef aktörden daha yetkili mi" (kimlik sıfırlama onayı) buradan okur.
 * `admin:*` tam yetki kısayoludur (yetki-izin.md: kısayol KORUNUR) — her kodu kapsar; `["*"]`
 * (süperadmin) `matchesPermission` içinde zaten her kodu geçer.
 */
export function uncoveredCodes(actorPermissions: readonly string[], codes: readonly string[]): string[] {
  if (matchesPermission(actorPermissions, "admin:*")) return [];
  return codes.filter((c) => !matchesPermission(actorPermissions, c));
}
