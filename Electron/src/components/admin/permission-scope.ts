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
