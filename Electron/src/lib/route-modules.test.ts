import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { ROUTE_MODULE, ROUTE_REGIME, isRouteModuleOpen, routeModuleOf } from "./route-modules";
import { resolveMachineStopEnabled } from "@/pages/Operations/MachineStops/stop-regime";

// =============================================================================
// Panel route modül kapısının SAF yarısı. Üç sonda (1e, 2026-09-14): modül
// KAPALI + izin VAR + URL → kapalı · AÇIK → bugünkü route tablosu BİREBİR
// (hiçbir yol kapanmaz, diff 0) · modülü olmayan yol → dokunulmaz.
// NEGATİF SONDA (2026-10-30, D4-A3): `ROUTE_REGIME` satırları silindi → "makine duruşu rejimi" testi kırmızı.
// =============================================================================
const ROUTES_SRC = readFileSync(resolve(__dirname, "../routes/content-routes.tsx"), "utf8");
const ALL_PATHS = [...ROUTES_SRC.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]!).filter((p) => p !== "*");

function ctx(over: Partial<OperationsVisibilityContext> = {}): OperationsVisibilityContext {
  return {
    shipmentConfirmationEnabled: false,
    depoMultiEnabled: true,
    devereEnabled: true,
    dokumaEnabled: true, machineStopEnabled: true, tezgahEnabled: true, kaliteGuvenceEnabled: true, maliyetEnabled: true, gelenBelgeEnabled: true, emanetEnabled: true,
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

// K4P zemin (2026-10-24): kapı manifestoyla (`SCREEN_CATALOG`) önden yazıldı; sayfa/route PANEL·LAB·SERT
// dilimlerinde iner. Route'u henüz olmayan beyanlı satırlar — iki yönlü ölçülür.
const PENDING_ROUTE = new Set<string>();

describe("route-modules — yol → modül aynası", () => {
  it("zemin: route metni okundu, tablo dolu", () => {
    expect(ALL_PATHS.length).toBeGreaterThan(100);
    expect(Object.keys(ROUTE_MODULE).length).toBeGreaterThanOrEqual(25);
  });

  it("⭐ tablodaki her ekranın content-routes'ta bir route'u var (ölü satır yok)", () => {
    const roots = new Set(ALL_PATHS.map((p) => p.split("/").filter((s) => !s.startsWith(":") && s !== "new" && s !== "edit").slice(0, 2).join("/")));
    for (const key of Object.keys(ROUTE_MODULE)) {
      const hasRoute = roots.has(key) || ALL_PATHS.includes(key);
      // Bekleyen satırın route'u doğunca muaf ÖLÜ olur → kırmızı, satır listeden düşer.
      if (PENDING_ROUTE.has(key)) expect(hasRoute, `${key} route'u doğdu — PENDING_ROUTE muafını sil`).toBe(false);
      else expect(hasRoute, `${key} route'u yok`).toBe(true);
    }
    for (const key of PENDING_ROUTE) expect(ROUTE_MODULE[key], `${key} muafı tabloda yok (ölü muaf)`).toBeDefined();
  });

  it("alt yollar ebeveyne katlanır (:id · new · edit · üçüncü segment)", () => {
    expect(routeModuleOf("/operations/work-orders/new")).toBe("productionEnabled");
    expect(routeModuleOf("/operations/work-orders/:id/edit")).toBe("productionEnabled");
    expect(routeModuleOf("/reports/production/wip")).toBe("productionEnabled");
    expect(routeModuleOf("/finance/cari")).toBe("financeEnabled");
    expect(routeModuleOf("/finance")).toBe("financeEnabled");
    expect(routeModuleOf("/quality/inspections/:id")).toBe("kaliteGuvenceEnabled");
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

  // D4-A3: Duruşlar + Vardiya Tanımları route'u rejim alanını okur (dokuma ∨ üretim ∧ uretim.makineDurusTakibi).
  it("⭐ makine duruşu rejimi: dokumasız + ayar açık → duruş ve vardiya yolları AÇIK, öbür dokuma yolları kapalı", () => {
    const flags = { dokumaEnabled: false, productionEnabled: true, machineStopTrackingEnabled: true };
    const hizmet = ctx({ dokumaEnabled: false, machineStopEnabled: resolveMachineStopEnabled(flags) });
    expect(isRouteModuleOpen("/operations/machine-stops", hizmet)).toBe(true);
    expect(isRouteModuleOpen("/definitions/shift-definitions", hizmet)).toBe(true);
    expect(isRouteModuleOpen("/operations/weaving-orders", hizmet)).toBe(false);
    const kapali = ctx({ dokumaEnabled: false, machineStopEnabled: resolveMachineStopEnabled({ ...flags, machineStopTrackingEnabled: false }) });
    expect(isRouteModuleOpen("/operations/machine-stops", kapali)).toBe(false);
    expect(isRouteModuleOpen("/definitions/shift-definitions", kapali)).toBe(false);
  });
  it("rejim tablosu manifesto aynasını bozmaz: rejimli ekran ROUTE_MODULE'da modülüyle (dokuma) kalır", () => {
    for (const key of Object.keys(ROUTE_REGIME)) expect(ROUTE_MODULE[key]).toBe("dokumaEnabled");
  });

  it("referans fabrika (yalnız üretim açık): kapanan yollar tam olarak ticaret/muhasebe/iplik/depo/devere/dokuma/maliyet ekranları", () => {
    const fabrika = ctx({ financeEnabled: false, ticaretEnabled: false, iplikEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false, machineStopEnabled: false, kaliteGuvenceEnabled: false, maliyetEnabled: false });
    const kapanan = new Set(ALL_PATHS.filter((p) => !isRouteModuleOpen(`/${p}`, fabrika)).map((p) => routeModuleOf(`/${p}`)));
    expect([...kapanan].sort()).toEqual(["depoMultiEnabled", "devereEnabled", "dokumaEnabled", "financeEnabled", "iplikEnabled", "kaliteGuvenceEnabled", "maliyetEnabled", "ticaretEnabled"]);
    expect(isRouteModuleOpen("/operations/work-orders", fabrika)).toBe(true);
  });
});
