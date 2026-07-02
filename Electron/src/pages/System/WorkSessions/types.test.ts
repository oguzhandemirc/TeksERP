import { describe, expect, it } from "vitest";
import { formatDurationMinutes, placeLabel, sessionDurationMinutes } from "./types";

describe("sessionDurationMinutes", () => {
  it("açık oturumda now'a göre hesaplar", () => {
    const start = new Date("2026-07-02T08:00:00Z").toISOString();
    const now = new Date("2026-07-02T11:25:00Z").getTime();
    expect(sessionDurationMinutes(start, null, now)).toBe(205);
  });
  it("kapalı oturumda endedAt'e göre hesaplar", () => {
    expect(
      sessionDurationMinutes("2026-07-02T08:00:00Z", "2026-07-02T08:45:00Z"),
    ).toBe(45);
  });
  it("negatif farkı 0'a kırpar (saat kayması)", () => {
    const now = new Date("2026-07-02T07:00:00Z").getTime();
    expect(sessionDurationMinutes("2026-07-02T08:00:00Z", null, now)).toBe(0);
  });
  it("geçersiz tarihte 0 döner", () => {
    expect(sessionDurationMinutes("bozuk", null)).toBe(0);
  });
});

describe("formatDurationMinutes", () => {
  it("saat + dakika biçimler", () => {
    expect(formatDurationMinutes(205)).toBe("3 sa 25 dk");
    expect(formatDurationMinutes(45)).toBe("45 dk");
    expect(formatDurationMinutes(0)).toBe("0 dk");
  });
});

describe("placeLabel", () => {
  const station = { id: "s", code: "ST", name: "Tambur", kind: "TAMBUR" };
  it("makineli oturumda istasyon — makine", () => {
    expect(placeLabel({ machine: { id: "m", code: "MAK-1", name: "Makine 1" }, station })).toBe(
      "Tambur — Makine 1",
    );
  });
  it("makinesiz (SHIPPING) oturumda yalnız istasyon", () => {
    expect(placeLabel({ machine: null, station })).toBe("Tambur");
  });
});
