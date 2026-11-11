// Bulunabilirlik + kapı: menü satırı bayrağa ve izne bağlı, karo izni route izniyle birebir, izinsiz karo yok.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { navGroups } from "@/components/layout/nav-config";
import { commandSections } from "@/components/layout/command-entries";
import { isRouteModuleOpen } from "@/lib/route-modules";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { costTiles, visibleCostTiles } from "./tile-config";
import { SALES_COST_TILE_KEYS } from "@/pages/Operations/sections";

const ROUTES = readFileSync(resolve(__dirname, "../../routes/content-routes.tsx"), "utf8");
function routePermission(path: string): string | null {
  const i = ROUTES.indexOf(`path: "${path}"`);
  if (i < 0) return null;
  return /requirePermission="([^"]+)"/.exec(ROUTES.slice(i, i + 400))?.[1] ?? null;
}

describe("Maliyet + Satış teklifleri — görünürlük kapıları", () => {
  it("menü satırı maliyetEnabled bayrağına ve maliyet/fiyat listesi okuma izinlerinden birine bağlı; route teklif okuyanı da alır", () => {
    const item = navGroups.flatMap((g) => g.items).find((i) => i.to === "/cost");
    expect(item?.featureFlag).toBe("maliyetEnabled");
    // T5: teklif menüde Satış'ta → yalnız `quote:read` taşıyan Maliyet kökünü görmez (boş hub açmasın).
    expect(item?.permissionAny).toEqual(["cost:read", "price-list:read", "report:yarn-need"]);
    const i = ROUTES.indexOf('path: "cost",');
    expect(ROUTES.slice(i, i + 300)).toContain('requireAnyPermission={["cost:read", "quote:read", "price-list:read", "report:yarn-need"]}');
  });
  it("her karonun izni route'un izniyle birebir", () => {
    for (const t of costTiles) expect([routePermission(t.to.slice(1))]).toEqual(t.permissionAny);
  });
  it("modül kapalı → maliyet route'ları kapanır; palette satırları bayrak yüklemi taşır", () => {
    const off = { maliyetEnabled: false } as OperationsVisibilityContext;
    for (const t of costTiles) expect(isRouteModuleOpen(t.to, off)).toBe(false);
    expect(isRouteModuleOpen("/cost/items/abc", off)).toBe(false);
    // T5: teklif ekranları Satış bölümünde; geri kalanı "Maliyet" başlığında — ikisi de bayrak yüklemi taşır.
    const sec = commandSections.find((s) => s.heading === "Maliyet");
    const sales = commandSections.find((s) => s.heading === "Satış");
    for (const t of costTiles) {
      const home = SALES_COST_TILE_KEYS.includes(t.key) ? sales : sec;
      expect(home?.entries.some((e) => e.to === t.to), t.key).toBe(true);
    }
    for (const e of sec!.entries) expect(e.visibleWhen?.(off)).toBe(false);
    for (const e of sales!.entries.filter((x) => x.to.startsWith("/cost/"))) expect(e.visibleWhen?.(off)).toBe(false);
  });
  it("izin yok → hub'da karo yok; her izin yalnız kendi karolarını açar", () => {
    expect(visibleCostTiles(() => false)).toEqual([]);
    const costOnly = visibleCostTiles((l) => l.includes("cost:read")).map((t) => t.key);
    expect(costOnly).not.toContain("quotes");
    expect(costOnly.length).toBeGreaterThanOrEqual(5);
    // Satış rolü (quote:read, cost:read YOK): maliyet karoları görünmez, teklif görünür.
    expect(visibleCostTiles((l) => l.includes("quote:read")).map((t) => t.key)).toEqual(["quotes"]);
    expect(costOnly).not.toContain("price-lists");
    expect(visibleCostTiles((l) => l.includes("price-list:read")).map((t) => t.key)).toEqual(["price-lists"]);
  });
});
