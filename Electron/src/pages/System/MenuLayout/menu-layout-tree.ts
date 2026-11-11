// Menü Düzeni ekranının saf yardımcıları (K19): ekranları menü gruplarına ayırır, hazır set önizlemesini çıkarır.
import type { ScreenEntry } from "@/services/screenCatalogService";
import type { MenuLayoutView, MenuPresetScreen } from "@/services/menuLayoutService";
import { allSectionTiles } from "@/pages/Operations/sections";
import { operationGroups } from "@/pages/Operations/groups-config";
import { definitionTiles } from "@/pages/Definitions/tile-config";

export interface ScreenGroup {
  id: string;
  title: string;
  screens: ScreenEntry[];
}

/** Karo adresi → menü kökü (T5 bölümleri + Tanımlar). Ekran adresi `/operations/...` kaldığı için kök yoldan
 *  değil KARODAN çözülür: `operations/gelen-belgeler/sablonlar` Tanımlar › Gelen Belge Kurulumu, `cost/quotes` Satış. */
const TILE_ROOTS: Array<{ path: string; root: string }> = [
  ...allSectionTiles.map((t) => ({ path: t.to, root: t.group })),
  ...definitionTiles.map((t) => ({ path: t.to, root: "definitions" })),
].map((x) => ({ path: x.path.replace(/^\//, "").split("?")[0]!, root: x.root }));

/** En uzun eşleşen karo adresinin kökü (tam eşit ya da alt adres); yoksa null. */
export function tileRootOf(key: string): string | null {
  let best: { path: string; root: string } | null = null;
  for (const t of TILE_ROOTS) {
    if ((key === t.path || key.startsWith(`${t.path}/`)) && (!best || t.path.length > best.path.length)) best = t;
  }
  return best?.root ?? null;
}

/** Masaüstü ekranı → menü grubu (kenar menü sırası). */
const DESKTOP_GROUPS: Array<{ id: string; title: string; match: (key: string) => boolean }> = [
  ...operationGroups.map((g) => ({ id: g.key, title: g.title, match: (k: string) => tileRootOf(k) === g.key })),
  { id: "quality", title: "Kalite Güvence", match: (k) => k === "quality" || k.startsWith("quality/") },
  { id: "cost", title: "Maliyet", match: (k) => k === "cost" || k.startsWith("cost/") },
  { id: "finance", title: "Ön Muhasebe", match: (k) => k === "finance" || k.startsWith("finance/") },
  { id: "reports", title: "Raporlar", match: (k) => k.startsWith("reports/") },
  { id: "definitions", title: "Tanımlar & Belgeler", match: (k) => k.startsWith("definitions/") || k === "documents" || tileRootOf(k) === "definitions" },
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
