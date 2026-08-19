// =============================================================================
// Yetki ekranı kapsamı (MOBİL / MASAÜSTÜ sekmesi) — saf yardımcılar
// =============================================================================
// Bileşenden AYRI dosya: kural render'sız sınanabilmeli. Bileşen içinde kalsaydı
// test ya DOM kurardı ya da kuralın KOPYASINI sınardı (kopya sonda, ifade
// değişince sessizce eskir).
// =============================================================================
import type { Permission } from "@/types/permissions";

/** İki sekme: saha (mobil) ↔ büro (masaüstü). */
export type PermScope = "mobile" | "desktop";

/**
 * ⚠️ VARSAYILAN MASAÜSTÜ (whitelist değil): yalnız `mobile` mobil sayılır,
 * geri kalan HER ŞEY masaüstüne düşer. Böylece ileride eklenen bir kategori
 * sekmelerin arasından düşüp EKRANDAN KAYBOLMAZ — kaybolan yetki, yanlış
 * yerde görünen yetkiden çok daha sessiz bir arızadır.
 */
export const scopeOf = (p: Pick<Permission, "category">): PermScope =>
  p.category === "mobile" ? "mobile" : "desktop";

export const SCOPE_LABEL: Record<PermScope, string> = {
  mobile: "Mobil (saha)",
  desktop: "Masaüstü (büro)",
};

export interface ScopeStat {
  total: number;
  hits: number;
  selected: number;
}

/** Sekme başına toplam / arama isabeti / seçili sayıları. */
export function splitScopeStats(
  permissions: Permission[],
  value: string[],
  matches: (p: Permission) => boolean,
): Record<PermScope, ScopeStat> {
  const stat: Record<PermScope, ScopeStat> = {
    mobile: { total: 0, hits: 0, selected: 0 },
    desktop: { total: 0, hits: 0, selected: 0 },
  };
  const chosen = new Set(value);
  for (const p of permissions) {
    const sc = scopeOf(p);
    stat[sc].total += 1;
    if (matches(p)) stat[sc].hits += 1;
    if (chosen.has(p.id)) stat[sc].selected += 1;
  }
  return stat;
}

/**
 * Bir yetki, SEÇİLİ bir wildcard tarafından zaten kapsanıyor mu?
 *
 * `mobile:*` ile "19 mobil yetkiyi tek tek işaretlemek" AYNI ŞEY DEĞİLDİR:
 * wildcard GELECEKTE eklenecek ekranları da kapsar, tekil seçim kapsamaz. Panel
 * bu farkı gizlemez — yalnız "bunu ayrıca işaretlemenin bir etkisi yok" der.
 *
 * Eşleşme ön ek bazlı: `mobile:*` → `mobile:` ile başlayan her kod. Wildcard'ın
 * KENDİSİ kapsanan sayılmaz (kendini soluklaştırmasın).
 */
export function buildWildcardCover(
  permissions: Permission[],
  selectedIds: string[],
): (p: Permission) => boolean {
  const chosen = new Set(selectedIds);
  const prefixes = permissions
    .filter((p) => chosen.has(p.id) && p.code.endsWith(":*"))
    .map((p) => p.code.slice(0, -1)); // "mobile:*" → "mobile:"
  if (prefixes.length === 0) return () => false;
  return (p: Permission) =>
    !p.code.endsWith(":*") && prefixes.some((pre) => p.code.startsWith(pre));
}
