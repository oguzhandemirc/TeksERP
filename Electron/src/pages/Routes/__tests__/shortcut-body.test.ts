// Rota formu iş emri kısayolu (K6): eski backend alanı tanımıyorsa (detayda yok) yalnız işaretlenince gövdeye girer.
import { describe, expect, it } from "vitest";
import { shortcutBody } from "../RouteShortcutFields";

describe("shortcutBody", () => {
  it("sunucu alanı tanıyorsa her zaman gider (işaret kaldırma dahil)", () => {
    expect(shortcutBody({ isWorkOrderShortcut: false, shortcutOrder: 3, shortcutKnown: true })).toEqual({ isWorkOrderShortcut: false, shortcutOrder: 3 });
  });
  it("eski backend + işaretsiz → gövdeye girmez; işaretliyse gider, bozuk sıra 0", () => {
    expect(shortcutBody({ isWorkOrderShortcut: false, shortcutOrder: 0, shortcutKnown: false })).toEqual({});
    expect(shortcutBody({ isWorkOrderShortcut: true, shortcutOrder: Number.NaN, shortcutKnown: false })).toEqual({ isWorkOrderShortcut: true, shortcutOrder: 0 });
  });
});
