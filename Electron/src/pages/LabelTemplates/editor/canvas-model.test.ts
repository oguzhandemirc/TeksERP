// Etiket Stüdyosu — kanvas model yardımcıları birim testleri
import { describe, expect, it } from "vitest";
import {
  applyResize,
  estimateBounds,
  makeElement,
  qrSizeMm,
  snap,
  snapRotation,
  starterLayout,
} from "./canvas-model";
import type { Code128Element, FieldElement, LineElement, QrElement, TextElement } from "@/types/label-canvas";

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

describe("applyResize", () => {
  it("line: w/h 0.5mm snap'li serbest boyut", () => {
    const el: LineElement = { id: "l", type: "line", x: 0, y: 0, wMm: 10, hMm: 1 };
    expect(applyResize(el, 40.26, 2.24)).toEqual({ wMm: 40.5, hMm: 2 });
  });

  it("code128: kutu yüksekliğinden okunur-satır payı düşülür + 3-40 clamp", () => {
    const el: Code128Element = { id: "b", type: "code128", x: 0, y: 0, hMm: 9, human: true };
    expect(applyResize(el, 50, 15.5)).toEqual({ hMm: 12 }); // 15.5 - 3.5
    expect(applyResize(el, 50, 100)).toEqual({ hMm: 40 });
  });

  it("qr: hedef kenardan ayrık ölçek (2-15) çözülür", () => {
    const el: QrElement = { id: "q", type: "qr", x: 0, y: 0, scale: 5 };
    const target = qrSizeMm(8);
    expect(applyResize(el, target, target)).toEqual({ scale: 8 });
    expect(applyResize(el, 500, 500)).toEqual({ scale: 15 });
    expect(applyResize(el, 1, 1)).toEqual({ scale: 2 });
  });

  it("metin: hedef yüksekliğe EN YAKIN font kademesi (serbest punto yok)", () => {
    const el: TextElement = { id: "t", type: "text", text: "x", x: 0, y: 0, font: "sm" };
    expect(applyResize(el, 30, 3.1)).toEqual({ font: "xl" });
    expect(applyResize(el, 30, 1.4)).toBeNull(); // zaten sm — değişiklik yok
  });
});

describe("snapRotation", () => {
  it("en yakın 90° adıma oturur ve 0-270 normalize eder", () => {
    expect(snapRotation(10)).toBe(0);
    expect(snapRotation(80)).toBe(90);
    expect(snapRotation(190)).toBe(180);
    expect(snapRotation(-95)).toBe(270);
    expect(snapRotation(350)).toBe(0);
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
