// Desen Kartları (SY-A3) — bulunabilirlik + modül kapısı + sunucu sayısı. `dokumaEnabled` kapalıyken
// karo, palet satırı ve route kapanır (Adnan Şahin / dokuma kapalı kurulumda menü bayt-aynı).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commandSections } from "@/components/layout/command-entries";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import type { CostPreview } from "@/pages/Cost/shared/cost-types";
import { costPerMeterLabel } from "./tabs/CostTab";
import { buildWeftBody } from "./tabs/WeftSpecEditor";

const ROUTES = readFileSync(resolve(__dirname, "../../routes/content-routes.tsx"), "utf8");
function routePermission(path: string): string | null {
  const i = ROUTES.indexOf(`path: "${path}"`);
  if (i < 0) return null;
  return /requirePermission="([^"]+)"/.exec(ROUTES.slice(i, i + 400))?.[1] ?? null;
}

const off = { dokumaEnabled: false, devereEnabled: true, productionEnabled: true } as OperationsVisibilityContext;
const on = { dokumaEnabled: true, devereEnabled: false, productionEnabled: true } as OperationsVisibilityContext;

describe("Desen Kartları — bulunabilirlik ve modül kapısı", () => {
  const tile = definitionTiles.find((t) => t.key === "weave-designs");

  it("Tanımlar → Üretim karosu var; izni route'larla birebir (warpspec:read)", () => {
    expect(tile?.to).toBe("/definitions/weave-designs");
    expect(tile?.group).toBe("production");
    expect(tile?.permission).toBe("warpspec:read");
    expect(routePermission("definitions/weave-designs")).toBe("warpspec:read");
    expect(routePermission("definitions/weave-designs/:id")).toBe("warpspec:read");
  });

  it("dokumaEnabled kapalı → karo, palet satırı ve route kapalı; açık → hepsi açık", () => {
    expect(tile?.visibleWhen?.(off)).toBe(false);
    expect(tile?.visibleWhen?.(on)).toBe(true);
    expect(isRouteModuleOpen("/definitions/weave-designs", off)).toBe(false);
    expect(isRouteModuleOpen("/definitions/weave-designs/abc", off)).toBe(false);
    expect(isRouteModuleOpen("/definitions/weave-designs", on)).toBe(true);
    const entry = commandSections.flatMap((s) => s.entries).find((e) => e.to === "/definitions/weave-designs");
    expect(entry).toBeDefined();
    expect(entry?.visibleWhen?.(off)).toBe(false);
    expect(entry?.visibleWhen?.(on)).toBe(true);
  });
});

function preview(sonuc: Partial<CostPreview["sonuc"]> | null, eksikler: string[] = []): CostPreview {
  return { sonuc, eksikler } as unknown as CostPreview;
}

describe("Maliyet sekmesi — sayı yalnız sunucudan", () => {
  it("sunum dövizi varsa sunucunun $/m değeri basılır", () => {
    expect(costPerMeterLabel(preview({ sunumDovizi: "USD", standartDovizM: "1.2345", standartTlM: "42.10" }))).toBe("≈ 1,2345 USD/m");
  });
  it("kur yoksa sıfır değil 'kuru yok'; ayar TRY iken TL/m", () => {
    expect(costPerMeterLabel(preview({ sunumDovizi: "USD", standartDovizM: null, standartTlM: "42.10" }))).toBe("USD kuru yok");
    expect(costPerMeterLabel(preview({ standartTlM: "42.1" }))).toBe("≈ 42,10 TL/m");
  });
  it("sonuç yoksa eksik girdi sayısı", () => {
    expect(costPerMeterLabel(preview(null, ["a", "b"]))).toBe("Hesaplanamadı — 2 eksik girdi");
  });
});

describe("Atkı kartı gövdesi", () => {
  const rows = [{ yarnItemId: "y1", picks: "4" }, { yarnItemId: "y2", picks: "1" }];
  it("sıra kodu doluysa adetler gövdeye girmez (sunucu türetir)", () => {
    expect(buildWeftBody(" A4 B1 ", "22,5", "6037", rows)).toEqual({
      sequenceCode: "A4 B1", picksPerCm: "22.5", weftProgramNo: "6037", yarns: [{ yarnItemId: "y1" }, { yarnItemId: "y2" }],
    });
  });
  it("sıra kodu boşsa elle adet (bugünkü davranış)", () => {
    expect(buildWeftBody("", "", "", rows)).toEqual({
      sequenceCode: null, picksPerCm: null, weftProgramNo: null,
      yarns: [{ yarnItemId: "y1", picksInRepeat: 4 }, { yarnItemId: "y2", picksInRepeat: 1 }],
    });
  });
});
