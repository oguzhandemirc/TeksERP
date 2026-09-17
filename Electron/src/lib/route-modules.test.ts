import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { ROUTE_MODULE, isRouteModuleOpen, routeModuleOf } from "./route-modules";

// =============================================================================
// Panel route modül kapısının SAF yarısı. Üç sonda (1e, 2026-09-14): modül
// KAPALI + izin VAR + URL → kapalı · AÇIK → bugünkü route tablosu BİREBİR
// (hiçbir yol kapanmaz, diff 0) · modülü olmayan yol → dokunulmaz.
// =============================================================================
const ROUTES_SRC = readFileSync(resolve(__dirname, "../routes/content-routes.tsx"), "utf8");
const ALL_PATHS = [...ROUTES_SRC.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== "*");

function ctx(over: Partial<OperationsVisibilityContext> = {}): OperationsVisibilityContext {
  return {
    shipmentConfirmationEnabled: false,
    depoMultiEnabled: true,
    devereEnabled: true,
    dokumaEnabled: true,
    reportsClosedKeys: [],
    isReportOpen: () => true,
    flagsReady: true,
    flagsFailed: false,
    financeEnabled: true,
    productionEnabled: true,
    ticaretEnabled: true,
    iplikEnabled: true,
    ...over,
  };
}

describe("route-modules — yol → modül aynası", () => {
  it("zemin: route metni okundu, tablo dolu", () => {
    expect(ALL_PATHS.length).toBeGreaterThan(100);
    expect(Object.keys(ROUTE_MODULE).length).toBeGreaterThanOrEqual(25);
  });

  it("⭐ tablodaki her ekranın content-routes'ta bir route'u var (ölü satır yok)", () => {
    const roots = new Set(ALL_PATHS.map((p) => p.split("/").filter((s) => !s.startsWith(":") && s !== "new" && s !== "edit").slice(0, 2).join("/")));
    for (const key of Object.keys(ROUTE_MODULE)) {
      expect(roots.has(key) || ALL_PATHS.includes(key), `${key} route'u yok`).toBe(true);
    }
  });

  it("alt yollar ebeveyne katlanır (:id · new · edit · üçüncü segment)", () => {
    expect(routeModuleOf("/operations/work-orders/new")).toBe("productionEnabled");
    expect(routeModuleOf("/operations/work-orders/:id/edit")).toBe("productionEnabled");
    expect(routeModuleOf("/reports/production/wip")).toBe("productionEnabled");
    expect(routeModuleOf("/finance/cari")).toBe("financeEnabled");
    expect(routeModuleOf("/finance")).toBe("financeEnabled");
  });

  it("⭐ modülü olmayan yol dokunulmaz (çekirdek · planlanan · hub · bilinmeyen)", () => {
    for (const p of ["/operations/rolls", "/operations/kartela", "/definitions/items", "/system", "/operations", "/olmayan/yol", "/"]) {
      expect(routeModuleOf(p), p).toBeNull();
      expect(isRouteModuleOpen(p, ctx({ productionEnabled: false, financeEnabled: false, ticaretEnabled: false }))).toBe(true);
    }
  });

  it("⭐ AÇIK: hiçbir route kapanmaz — bugünkü tablo birebir (diff 0)", () => {
    const kapanan = ALL_PATHS.filter((p) => !isRouteModuleOpen(`/${p}`, ctx()));
    expect(kapanan).toEqual([]);
  });

  it("⭐ KAPALI: yalnız o modülün yolları kapanır", () => {
    const c = ctx({ productionEnabled: false });
    expect(isRouteModuleOpen("/operations/work-orders", c)).toBe(false);
    expect(isRouteModuleOpen("/reports/quality/scorecard", c)).toBe(false);
    expect(isRouteModuleOpen("/finance/invoices", c)).toBe(true);
    expect(isRouteModuleOpen("/operations/rolls", c)).toBe(true);
    const d = ctx({ dokumaEnabled: false });
    expect(isRouteModuleOpen("/operations/weaving-orders", d)).toBe(false);
    expect(isRouteModuleOpen("/operations/work-orders", d)).toBe(true);
  });

  it("referans fabrika (yalnız üretim açık): kapanan yollar tam olarak ticaret/muhasebe/iplik/depo/devere/dokuma ekranları", () => {
    const fabrika = ctx({ financeEnabled: false, ticaretEnabled: false, iplikEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false });
    const kapanan = new Set(ALL_PATHS.filter((p) => !isRouteModuleOpen(`/${p}`, fabrika)).map((p) => routeModuleOf(`/${p}`)));
    expect([...kapanan].sort()).toEqual(["depoMultiEnabled", "devereEnabled", "dokumaEnabled", "financeEnabled", "iplikEnabled", "ticaretEnabled"]);
    expect(isRouteModuleOpen("/operations/work-orders", fabrika)).toBe(true);
  });
});
