// Etiket Stüdyosu — kanvas model yardımcıları birim testleri
import { describe, expect, it } from "vitest";
import {
  estimateBounds,
  makeElement,
  qrSizeMm,
  snap,
  starterLayout,
} from "./canvas-model";
import type { FieldElement, QrElement } from "@/types/label-canvas";

const CANVAS = { widthMm: 100, heightMm: 60 };

describe("snap", () => {
  it("0.5mm ızgaraya oturur", () => {
    expect(snap(3.24)).toBe(3);
    expect(snap(3.26)).toBe(3.5);
    expect(snap(0)).toBe(0);
  });
});

describe("qrSizeMm", () => {
  it("scale ile büyür ve varsayılan 5 kabul eder", () => {
    expect(qrSizeMm(undefined)).toBeCloseTo(qrSizeMm(5));
    expect(qrSizeMm(6)).toBeGreaterThan(qrSizeMm(4));
  });
});

describe("estimateBounds", () => {
  it("rotasyonda en/boy yer değiştirir", () => {
    const el: FieldElement = { id: "t", type: "field", bind: "itemName", x: 10, y: 10, font: "md" };
    const flat = estimateBounds(el, CANVAS);
    const rotated = estimateBounds({ ...el, rot: 90 }, CANVAS);
    expect(rotated.w).toBeCloseTo(flat.h);
    expect(rotated.h).toBeCloseTo(flat.w);
  });

  it("QR ayak izi kare ve scale'e bağlı", () => {
    const el: QrElement = { id: "q", type: "qr", x: 0, y: 0, scale: 6 };
    const b = estimateBounds(el, CANVAS);
    expect(b.w).toBe(b.h);
    expect(b.w).toBeCloseTo(qrSizeMm(6));
  });
});

describe("makeElement", () => {
  it("konumu snap'ler ve tip varsayılanlarını doldurur", () => {
    const el = makeElement("code128", { x: 3.24, y: 7.76 });
    expect(el.x).toBe(3);
    expect(el.y).toBe(8);
    expect(el.type).toBe("code128");
  });

  it("field elemanı bind/label alır", () => {
    const el = makeElement("field", { x: 1, y: 1 }, { bind: "customerName", label: "Müşteri" });
    expect(el.type).toBe("field");
    if (el.type === "field") {
      expect(el.bind).toBe("customerName");
      expect(el.label).toBe("Müşteri");
    }
  });
});

describe("starterLayout", () => {
  it("taranabilir eleman içerir (QR + Code128) ve tuvale sığar", () => {
    const layout = starterLayout(CANVAS);
    const types = layout.elements.map((e) => e.type);
    expect(types).toContain("qr");
    expect(types).toContain("code128");
    for (const el of layout.elements) {
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeLessThanOrEqual(CANVAS.heightMm);
    }
  });
});
