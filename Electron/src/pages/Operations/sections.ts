// =============================================================================
// MENÜ BÖLÜMLERİ (T5, 2026-11-11) — Satış · Üretim · Depo · Sevkiyat
// =============================================================================
// Her bölümün karo listesi TEK yerden: menü alt listesi, bölüm (kart) sayfası, eski birleşik
// `/operations` sayfası ve komut paleti bunu okur. Karo nesneleri KOPYALANMAZ: Operasyon karoları
// aynen, Satış'a eklenen Teklifler karosu Maliyet karolarından anahtarla alınır (adres `/cost/quotes`
// kalır; ekran kataloğundaki modül mirası Maliyet menü satırından gelmeye devam eder).
// =============================================================================
import { operationsTiles, type OperationsTile, type OperationsVisibilityContext } from "./tile-config";
import { operationGroups, type OperationGroupKey } from "./groups-config";
import { costTiles } from "@/pages/Cost/tile-config";
import { regimePredicate } from "@/lib/regime-predicate";
import { isRouteModuleOpen } from "@/lib/route-modules";

/** Maliyet karolarından Satış bölümüne giren anahtarlar — Maliyet sayfası bunları çizmez. */
export const SALES_COST_TILE_KEYS: readonly string[] = ["quotes"];

/** Teklif ekranı kapısı: menüdeki Maliyet satırı ve komut paletiyle aynı iki koşul (modül + yol modülü). */
export function isQuoteTileVisible(ctx: OperationsVisibilityContext): boolean {
  return regimePredicate("maliyetEnabled")(ctx) && isRouteModuleOpen("/cost/quotes", ctx);
}

const salesCostTiles: OperationsTile[] = costTiles
  .filter((t) => SALES_COST_TILE_KEYS.includes(t.key))
  .map((t) => ({
    key: t.key,
    title: t.title,
    description: t.description,
    icon: t.icon,
    to: t.to,
    group: "planning" as const,
    permissionAny: t.permissionAny,
    visibleWhen: isQuoteTileVisible,
  }));

/** Bölümün karoları, hub sırasıyla. */
export function sectionTiles(group: OperationGroupKey): OperationsTile[] {
  const own = operationsTiles.filter((t) => t.group === group);
  return group === "planning" ? [...own, ...salesCostTiles] : own;
}

/** Bütün bölümlerin karoları (bölüm sırasıyla) — eski birleşik sayfa ve "kart kaybolmadı" ölçüsü. */
export const allSectionTiles: OperationsTile[] = operationGroups.flatMap((g) => sectionTiles(g.key));

/** Bölüm sayfası adresinden bölüm anahtarı. */
export function sectionByRoute(route: string): OperationGroupKey | null {
  return operationGroups.find((g) => g.route === route)?.key ?? null;
}
