// Etiket Stüdyosu — kanvas lint birim testleri
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasLint } from "./useCanvasLint";
import type { LabelElement } from "@/types/label-canvas";

const CANVAS = { widthMm: 100, heightMm: 60 };

function lint(elements: LabelElement[]) {
  const { result } = renderHook(() => useCanvasLint(elements, CANVAS));
  return result.current;
}

describe("useCanvasLint", () => {
  it("okutulabilir eleman yoksa WARN (error değil — statik etiket kaydedilebilir)", () => {
    const issues = lint([{ id: "t1", type: "text", text: "x", x: 5, y: 5 }]);
    expect(issues.some((i) => i.level === "error")).toBe(false);
    expect(
      issues.some((i) => i.level === "warn" && i.message.includes("Okutulabilir eleman yok")),
    ).toBe(true);
  });

  it("QR varsa taranabilirlik uyarısı yok", () => {
    const issues = lint([{ id: "q", type: "qr", x: 3, y: 3, scale: 5 }]);
    expect(issues.some((i) => i.message.includes("Okutulabilir eleman yok"))).toBe(false);
  });

  it("tuval taşması warn üretir", () => {
    const issues = lint([
      { id: "q", type: "qr", x: 3, y: 3, scale: 5 },
      { id: "ln", type: "line", x: 80, y: 55, wMm: 40, hMm: 10 },
    ]);
    expect(issues.some((i) => i.level === "warn" && i.elementId === "ln")).toBe(true);
  });

  it("üst üste binen elemanlar warn üretir", () => {
    const issues = lint([
      { id: "a", type: "line", x: 10, y: 10, wMm: 20, hMm: 10 },
      { id: "b", type: "line", x: 15, y: 12, wMm: 20, hMm: 10 },
      { id: "q", type: "qr", x: 60, y: 40, scale: 4 },
    ]);
    expect(issues.some((i) => i.level === "warn" && i.message.includes("binme"))).toBe(true);
  });

  it("tam dil kapsamı: hiçbir eleman degrade info'su üretmez (banner dahil — PPLA çerçeveli basar)", () => {
    const issues = lint([
      { id: "q", type: "qr", x: 3, y: 3, scale: 5 },
      { id: "bn", type: "lengthBanner", x: 90, y: 3, wMm: 9, hMm: 50 },
      { id: "ln", type: "line", x: 3, y: 55, wMm: 40, hMm: 1 },
    ]);
    expect(issues.filter((i) => i.level === "info")).toHaveLength(0);
  });

  it("ayrık elemanlarda gereksiz uyarı yok", () => {
    const issues = lint([
      { id: "q", type: "qr", x: 3, y: 3, scale: 4 },
      { id: "t", type: "text", text: "AD", x: 40, y: 40 },
    ]);
    expect(issues.filter((i) => i.level === "warn")).toHaveLength(0);
  });
});

describe("useCanvasLint — koşullu basım", () => {
  const withGrades = (elements: LabelElement[], codes?: string[]) =>
    renderHook(() => useCanvasLint(elements, CANVAS, codes)).result.current;

  const stamp = (id: string, values: string[]): LabelElement => ({
    id, type: "text", text: id, x: 10, y: 10,
    showIf: { field: "qualityGrade", op: "in", values },
  });

  it("katalogda olmayan kalite kodu WARN üretir (ölü koşul = eleman hiç basılmaz)", () => {
    const issues = withGrades([{ id: "q", type: "qr", x: 60, y: 40, scale: 4 }, stamp("d", ["ESKI_KOD"])], ["1.KALITE", "A1"]);
    expect(issues.some((i) => i.level === "warn" && i.elementId === "d" && i.message.includes("ESKI_KOD"))).toBe(true);
  });

  it("katalogdaki kod (harf farkı dahil) uyarı üretmez", () => {
    const issues = withGrades([{ id: "q", type: "qr", x: 60, y: 40, scale: 4 }, stamp("d", ["a1"])], ["1.KALITE", "A1"]);
    expect(issues.some((i) => i.message.includes("katalogda olmayan"))).toBe(false);
  });

  it("katalog yüklenmeden (kod listesi boş) ölü-koşul uyarısı VERİLMEZ", () => {
    const issues = withGrades([{ id: "q", type: "qr", x: 60, y: 40, scale: 4 }, stamp("d", ["ESKI_KOD"])]);
    expect(issues.some((i) => i.message.includes("katalogda olmayan"))).toBe(false);
  });

  it("birbirini dışlayan koşullu elemanlar üst üste binse de uyarı yok", () => {
    const a: LabelElement = { ...stamp("a", ["1.KALITE"]), x: 10, y: 10 };
    const b: LabelElement = { ...stamp("b", ["A1"]), x: 10, y: 10 };
    const issues = withGrades([{ id: "q", type: "qr", x: 60, y: 40, scale: 4 }, a, b], ["1.KALITE", "A1"]);
    expect(issues.some((i) => i.message.includes("binme"))).toBe(false);
  });
});
