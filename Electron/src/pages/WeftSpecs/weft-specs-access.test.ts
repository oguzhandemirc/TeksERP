// Atkı Kartları (B19) — bulunabilirlik + modül kapısı: Tanımlar → Üretim karosu, komut paleti, route izni karo ile birebir,
// `dokumaEnabled` kapalıyken karo/palet/route kapalı.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commandSections } from "@/components/layout/command-entries";
import { isRouteModuleOpen } from "@/lib/route-modules";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

const ROUTES = readFileSync(resolve(__dirname, "../../routes/content-routes.tsx"), "utf8");
const off = { dokumaEnabled: false, devereEnabled: true, productionEnabled: true } as OperationsVisibilityContext;
const on = { dokumaEnabled: true, devereEnabled: false, productionEnabled: true } as OperationsVisibilityContext;

describe("Atkı Kartları — bulunabilirlik ve modül kapısı", () => {
  const tile = definitionTiles.find((t) => t.key === "weft-specs");

  it("Tanımlar → Üretim karosu, izni route ile birebir (warpspec:read)", () => {
    expect(tile?.to).toBe("/definitions/weft-specs");
    expect(tile?.group).toBe("production");
    expect(tile?.permission).toBe("warpspec:read");
    const i = ROUTES.indexOf('path: "definitions/weft-specs"');
    expect(i).toBeGreaterThan(0);
    expect(/requirePermission="([^"]+)"/.exec(ROUTES.slice(i, i + 400))?.[1]).toBe("warpspec:read");
  });

  it("dokumaEnabled kapalı → karo, palet satırı ve route kapalı; açık → açık", () => {
    expect(tile?.visibleWhen?.(off)).toBe(false);
    expect(tile?.visibleWhen?.(on)).toBe(true);
    expect(isRouteModuleOpen("/definitions/weft-specs", off)).toBe(false);
    expect(isRouteModuleOpen("/definitions/weft-specs", on)).toBe(true);
    const entry = commandSections.flatMap((s) => s.entries).find((e) => e.to === "/definitions/weft-specs");
    expect(entry).toBeDefined();
    expect(entry?.visibleWhen?.(on)).toBe(true);
  });
});
