// Menü Düzeni ekranının saf yardımcıları (K19): ekranları menü gruplarına ayırır, hazır set önizlemesini çıkarır.
import type { ScreenEntry } from "@/services/screenCatalogService";
import type { MenuLayoutView, MenuPresetScreen } from "@/services/menuLayoutService";

export interface ScreenGroup {
  id: string;
  title: string;
  screens: ScreenEntry[];
}

/** Masaüstü anahtarının ilk segmenti → menü grubu (kenar menü sırası). */
const DESKTOP_GROUPS: Array<{ id: string; title: string; match: (key: string) => boolean }> = [
  { id: "operations", title: "Operasyon", match: (k) => k.startsWith("operations/") },
  { id: "quality", title: "Kalite Güvence", match: (k) => k === "quality" || k.startsWith("quality/") },
  { id: "cost", title: "Maliyet & Teklif", match: (k) => k === "cost" || k.startsWith("cost/") },
  { id: "finance", title: "Ön Muhasebe", match: (k) => k === "finance" || k.startsWith("finance/") },
  { id: "reports", title: "Raporlar", match: (k) => k.startsWith("reports/") },
  { id: "definitions", title: "Tanımlar & Belgeler", match: (k) => k.startsWith("definitions/") || k === "documents" },
  { id: "system", title: "Sistem", match: (k) => k === "system" || k.startsWith("system/") },
  { id: "access", title: "Yetkilendirme", match: (k) => k === "access" || k.startsWith("access/") },
];

export const MOBILE_GROUP_ID = "mobile";

/** Katalog → gruplar; masaüstü kenar menü sırasıyla, en sonda "Diğer" ve ayrı "Tablet karoları". */
export function groupScreens(screens: readonly ScreenEntry[]): ScreenGroup[] {
  const out: ScreenGroup[] = DESKTOP_GROUPS.map((g) => ({ id: g.id, title: g.title, screens: [] }));
  const other: ScreenGroup = { id: "other", title: "Diğer", screens: [] };
  const mobile: ScreenGroup = { id: MOBILE_GROUP_ID, title: "Tablet karoları", screens: [] };
  for (const s of screens) {
    if (s.app === "mobile") {
      mobile.screens.push(s);
      continue;
    }
    const i = DESKTOP_GROUPS.findIndex((g) => g.match(s.key));
    (i >= 0 ? out[i]! : other).screens.push(s);
  }
  return [...out, other, mobile].filter((g) => g.screens.length > 0);
}

/** Hazır set önizlemesi: listede henüz gizli OLMAYAN ve gizlenebilir her ekran (uygulanınca eklenecekler). */
export function presetPreview(
  preset: MenuLayoutView["presets"][number],
  hidden: ReadonlySet<string>,
  unhideable: ReadonlySet<string>,
): MenuPresetScreen[] {
  return preset.screens.filter((s) => !hidden.has(s.key) && !unhideable.has(s.key));
}

/** İki liste aynı küme mi (kaydet düğmesi değişiklik var mı diye bakar). */
export function sameKeySet(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === new Set(b).size && b.every((k) => a.has(k));
}
