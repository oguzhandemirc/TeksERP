// Menü süreç alt grupları (2026-11-20): her ekran kendi kökünde bir gruba yazılı, ölü yol yok, sıra saha akışı.
import { describe, expect, it } from "vitest";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { operationGroups } from "@/pages/Operations/groups-config";
import { sectionTiles, allSectionTiles, SALES_COST_TILE_KEYS } from "@/pages/Operations/sections";
import { costTiles } from "@/pages/Cost/tile-config";
import { financeTiles } from "@/pages/Finance/tile-config";
import { qualityTiles } from "@/pages/Quality/tile-config";
import { NAV_SUBGROUPS, OTHER_SUBGROUP_KEY, layoutSubgroups } from "./nav-subgroups";

const ctx = (over: Partial<OperationsVisibilityContext> = {}) =>
  ({ dokumaEnabled: true, tezgahEnabled: true, ...over }) as OperationsVisibilityContext;

const HOME: Record<string, { to: string }[]> = {
  ...Object.fromEntries(operationGroups.map((g) => [g.route, sectionTiles(g.key)])),
  "/cost": costTiles.filter((t) => !SALES_COST_TILE_KEYS.includes(t.key)),
  "/finance": financeTiles,
  "/quality": qualityTiles,
};
const POOL = [...allSectionTiles, ...costTiles, ...financeTiles, ...qualityTiles];

describe("nav-subgroups — tanım bütünlüğü", () => {
  it("⭐ her kökün her ekranı tanımlı bir gruba yazılı (Diğer'e düşen yok)", () => {
    for (const [root, home] of Object.entries(HOME)) {
      const groups = layoutSubgroups(root, home, ctx(), POOL);
      expect(groups.find((g) => g.key === OTHER_SUBGROUP_KEY)?.items.map((t) => t.to) ?? [], root).toEqual([]);
      expect(groups.flatMap((g) => g.items).length, root).toBe(new Set(groups.flatMap((g) => g.items.map((t) => t.to))).size);
    }
  });

  it("ölü yol yok: gruplardaki her yol gerçek bir karonun adresi", () => {
    const known = new Set(POOL.map((t) => t.to));
    const dead = Object.entries(NAV_SUBGROUPS).flatMap(([root, defs]) => defs.flatMap((d) => d.paths.filter((p) => !known.has(p)).map((p) => `${root}:${p}`)));
    expect(dead).toEqual([]);
  });

  it("bir kökte bir yol bir kez; çapraz listeleme yalnız başka kökte", () => {
    for (const [root, defs] of Object.entries(NAV_SUBGROUPS)) {
      const paths = defs.flatMap((d) => d.paths);
      expect(paths.length, root).toBe(new Set(paths).size);
    }
    expect(NAV_SUBGROUPS["/warehouse"]!.some((d) => d.paths.includes("/operations/fasondaki-iplik"))).toBe(true);
    expect(NAV_SUBGROUPS["/production"]!.some((d) => d.paths.includes("/operations/fasondaki-iplik"))).toBe(true);
  });
});

describe("nav-subgroups — süreç sırası (kullanıcı kararı)", () => {
  const labels = (root: string, c = ctx()) => layoutSubgroups(root, HOME[root]!, c, POOL).map((g) => g.label);

  it("⭐ Üretim: Devere/Çözgü → Dokuma → Terbiye → Kurşun → Fason", () => {
    expect(labels("/production")[0]).toBe("Devere / Çözgü");
    expect(labels("/production").slice(1, 2)).toEqual(["Dokuma"]);
    expect(labels("/production").slice(-2)).toEqual(["Kurşun", "Fason"]);
    const devere = layoutSubgroups("/production", HOME["/production"]!, ctx(), POOL)[0]!;
    expect(devere.items.map((t) => t.to)).toEqual(["/operations/fason-devere", "/operations/cozgu-hesabi", "/operations/warp-beams", "/operations/fasondaki-iplik"]);
  });

  it("Depo: mal kabul önce, sayım/transfer sonda; Fasondaki İplik İplik grubunda", () => {
    const g = layoutSubgroups("/warehouse", HOME["/warehouse"]!, ctx(), POOL);
    expect(g.map((x) => x.label)).toEqual(["Satın Alma / Mal Kabul", "İplik ve Sarf", "Kumaş ve Paketleme", "Sayım ve Transfer"]);
    expect(g[1]!.items.map((t) => t.to)).toContain("/operations/fasondaki-iplik");
  });

  it("Sevkiyat: çıkış → sonrası; Satış ve Kalite başlıksız tek grup", () => {
    expect(labels("/shipping")).toEqual(["Sevk Çıkışı", "Sevk Sonrası"]);
    expect(labels("/sales")).toEqual([""]);
    expect(labels("/quality")).toEqual([""]);
  });

  it("⭐ dokumasız profil: devere/dokuma karoları süzülünce gruplar düşer; duruşlar 'Makine Takibi' başlığında", () => {
    const home = HOME["/production"]!.filter((t) => !/fason-devere|cozgu-hesabi|warp-beams|fasondaki-iplik|weaving|loom/.test(t.to));
    const g = layoutSubgroups("/production", home, ctx({ dokumaEnabled: false, tezgahEnabled: false }), home);
    expect(g.map((x) => x.label)).not.toContain("Devere / Çözgü");
    expect(g.find((x) => x.key === "dokuma")?.label).toBe("Makine Takibi");
  });

  it("tanımsız kök tek başlıksız grup; boş girdi boş çıktı", () => {
    expect(layoutSubgroups("/yok", [{ to: "/a" }], ctx())).toEqual([{ key: OTHER_SUBGROUP_KEY, label: "", items: [{ to: "/a" }] }]);
    expect(layoutSubgroups("/production", [], ctx())).toEqual([]);
  });

  it("gruba yazılmamış yeni ekran 'Diğer' başlığında sona düşer (menüde kaybolmaz)", () => {
    const g = layoutSubgroups("/shipping", [...HOME["/shipping"]!, { to: "/operations/yeni-ekran" }], ctx());
    expect(g.at(-1)).toEqual({ key: OTHER_SUBGROUP_KEY, label: "Diğer", items: [{ to: "/operations/yeni-ekran" }] });
  });
});
