import { describe, expect, it } from "vitest";
import { durationLabel, hhmmToMinute, minuteToHhmm, weekdaysLabel, windowLabel } from "./types";
import { isShiftDefinitionsVisible } from "./shift-regime";

describe("vardiya tanımı biçim yardımcıları", () => {
  it("dakika ↔ HH:MM gidiş-dönüş", () => {
    expect(minuteToHhmm(480)).toBe("08:00");
    expect(minuteToHhmm(1439)).toBe("23:59");
    expect(hhmmToMinute("08:30")).toBe(510);
    expect(hhmmToMinute("7:05")).toBe(425);
    for (const m of [0, 1, 59, 600, 1439]) expect(hhmmToMinute(minuteToHhmm(m))).toBe(m);
  });
  it("geçersiz saat null (24:00 · 12:60 · boş)", () => {
    expect(hhmmToMinute("24:00")).toBeNull();
    expect(hhmmToMinute("12:60")).toBeNull();
    expect(hhmmToMinute("")).toBeNull();
  });
  it("gece yarısını geçen vardiya ertesi güne biter", () => {
    expect(windowLabel({ startMinute: 23 * 60, durationMinutes: 8 * 60 })).toBe("23:00–07:00 (ertesi gün)");
    expect(windowLabel({ startMinute: 16 * 60, durationMinutes: 8 * 60 })).toBe("16:00–00:00");
  });
  it("süre etiketi", () => {
    expect(durationLabel(510)).toBe("8 sa 30 dk");
    expect(durationLabel(480)).toBe("8 sa");
    expect(durationLabel(45)).toBe("45 dk");
  });
  it("boş dizi ve yedi gün HER GÜN; aksi Pazartesi başlı", () => {
    expect(weekdaysLabel([])).toBe("Her gün");
    expect(weekdaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Her gün");
    expect(weekdaysLabel([0, 1, 6])).toBe("Pzt · Cmt · Paz");
  });
});

describe("Vardiya Tanımları görünürlüğü", () => {
  it("yalnız dokuma ETKİNKEN çizilir (referans fabrikada karo yok)", () => {
    expect(isShiftDefinitionsVisible({ dokumaEnabled: false })).toBe(false);
    expect(isShiftDefinitionsVisible({ dokumaEnabled: true })).toBe(true);
  });
});
