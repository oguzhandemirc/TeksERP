import { describe, expect, it } from "vitest";
import {
  COLOR_PROPERTY_TYPE, FONT_FAMILIES, HIDDEN_POSITIONS, HIDDEN_PROPERTIES, HIDDEN_UNITS, STYLE_SECTORS, STYLE_UNITS, flattenProperties,
} from "./styleSectors";

const all = flattenProperties();

describe("stil paneli sektörleri", () => {
  it("altı Türkçe sektör, plan sırasıyla", () => {
    expect(STYLE_SECTORS.map((s) => s.name)).toEqual(["Yerleşim", "Tipografi", "Kenarlık", "Arka plan", "Tablo", "Baskı"]);
  });

  it("körlük zemini: özellik ağacı okundu", () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
  });

  it("⭐ gizli özellikler (transform, animasyon, geçiş…) panelde YOK", () => {
    const names = all.map((p) => p.property);
    for (const h of HIDDEN_PROPERTIES) expect(names.filter((n) => n.startsWith(h))).toEqual([]);
  });

  it("⭐ position fixed/sticky seçilemez", () => {
    const pos = all.find((p) => p.property === "position");
    const ids = pos?.options?.map((o) => o.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(["static", "relative", "absolute"]));
    for (const h of HIDDEN_POSITIONS) expect(ids).not.toContain(h);
  });

  it("⭐ birimler yalnız mm/pt/px/% — vh/vw yok", () => {
    for (const p of all.filter((x) => x.type === "number")) {
      for (const u of p.units ?? []) expect(STYLE_UNITS as readonly string[]).toContain(u);
      for (const h of HIDDEN_UNITS) expect(p.units ?? []).not.toContain(h);
    }
  });

  it("Baskı sektörü break-* özelliklerini taşır", () => {
    const print = STYLE_SECTORS.find((s) => s.id === "print")!;
    expect(print.properties.map((p) => p.property)).toEqual(expect.arrayContaining(["break-before", "break-after", "break-inside"]));
  });

  it("renk özellikleri panelin react-colorful seçicisine bağlı", () => {
    const colors = all.filter((p) => /(^|-)color$/.test(p.property));
    expect(colors.length).toBeGreaterThanOrEqual(3);
    for (const c of colors) expect(c.type).toBe(COLOR_PROPERTY_TYPE);
  });

  it("yazı tipleri yalnız yerel/genel aile — her seçenek genel aileyle biter", () => {
    for (const f of FONT_FAMILIES) expect(f.id).toMatch(/(sans-serif|serif|monospace)$/);
    expect(FONT_FAMILIES.some((f) => /url\(|https?:/i.test(f.id))).toBe(false);
  });

  it("her özelliğin etiketi Türkçe yazılmış (boş/özellik adı değil)", () => {
    for (const p of all) {
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.label).not.toBe(p.property);
    }
  });
});
