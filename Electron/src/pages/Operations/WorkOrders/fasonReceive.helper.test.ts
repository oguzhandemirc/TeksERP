import { describe, expect, it } from "vitest";
import {
  defaultPieces,
  hasMeterDiff,
  meterDiff,
  piecesTotal,
  round2,
} from "./fasonReceive.helper";

describe("defaultPieces — SINGLE (varsayılan: dikili tek parça)", () => {
  it("giden topların toplam metresiyle tek parça üretir", () => {
    expect(defaultPieces([100, 20.5, 30], "SINGLE")).toEqual([150.5]);
  });

  it("yüzer-nokta gürültüsünü yuvarlar (0.1 + 0.2 → 0.3)", () => {
    expect(defaultPieces([0.1, 0.2], "SINGLE")).toEqual([0.3]);
  });

  it("pozitif olmayan metrajları toplama katmaz", () => {
    expect(defaultPieces([100, 0, -5], "SINGLE")).toEqual([100]);
  });
});

describe("defaultPieces — PER_ROLL (istisna: adet adet geldi)", () => {
  it("giden her top için kendi sevk metresiyle parça üretir", () => {
    expect(defaultPieces([100, 20.5, 30], "PER_ROLL")).toEqual([100, 20.5, 30]);
  });

  it("pozitif olmayan metrajı 0'a sabitler (operatör girer)", () => {
    expect(defaultPieces([100, -5], "PER_ROLL")).toEqual([100, 0]);
  });

  it("iki yönlü geçiş: PER_ROLL toplamı SINGLE parçasına eşittir", () => {
    const qtys = [40, 60, 33.3];
    expect(piecesTotal(defaultPieces(qtys, "PER_ROLL"))).toBe(
      defaultPieces(qtys, "SINGLE")[0],
    );
  });
});

describe("piecesTotal / meterDiff / hasMeterDiff", () => {
  it("piecesTotal pozitif olmayanları saymaz", () => {
    expect(piecesTotal([10, 0, -3, 2.5])).toBe(12.5);
  });

  it("SINGLE varsayılanında fark yoktur", () => {
    const sent = [120.3, 79.7];
    const pieces = defaultPieces(sent, "SINGLE");
    expect(meterDiff(sent, pieces)).toBe(0);
    expect(hasMeterDiff(sent, pieces)).toBe(false);
  });

  it("dönen eksikse fark negatif, fazlaysa pozitif", () => {
    expect(meterDiff([100], [90])).toBe(-10);
    expect(meterDiff([100], [110.5])).toBe(10.5);
  });

  it("0.01 m ve altı fark, fark sayılmaz (yüzer-nokta toleransı)", () => {
    expect(hasMeterDiff([100], [100.01])).toBe(false);
    expect(hasMeterDiff([100], [100.02])).toBe(true);
  });

  it("round2 iki haneye yuvarlar", () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(0.30000000000000004)).toBe(0.3);
  });
});
