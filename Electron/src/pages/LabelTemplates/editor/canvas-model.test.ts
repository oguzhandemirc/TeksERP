// Etiket Stüdyosu — kanvas model yardımcıları birim testleri
import { describe, expect, it } from "vitest";
import {
  applyResize,
  conditionsMutuallyExclusive,
  describeCondition,
  estimateBounds,
  ICON_DEFAULT_MM,
  makeElement,
  makeBarcodePair,
  qrSizeMm,
  snap,
  snapRotation,
  starterLayout,
} from "./canvas-model";
import { alignElements, distributeElements } from "./canvas-align";
import type { Code128Element, FieldElement, IconElement, LabelElement, LineElement, QrElement, TextElement } from "@/types/label-canvas";

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

  it("icon: kare — hMm yok → 8mm varsayılan; dönüş boyutu DEĞİŞTİRMEZ (kare)", () => {
    const el: IconElement = { id: "i", type: "icon", icon: "wash-30", x: 5, y: 5 };
    const b = estimateBounds(el, CANVAS);
    expect(b).toEqual({ x: 5, y: 5, w: ICON_DEFAULT_MM, h: ICON_DEFAULT_MM });
    const rotated = estimateBounds({ ...el, hMm: 12, rot: 90 }, CANVAS);
    expect(rotated.w).toBe(12);
    expect(rotated.h).toBe(12);
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

  it("code128: gömülü kod KAPALI (ayrı öğe olacak)", () => {
    const el = makeElement("code128", { x: 3, y: 3 });
    if (el.type === "code128") expect(el.human).toBe(false);
  });

  it("icon: verilen anahtar + 8mm varsayılan; anahtarsız → wash-30", () => {
    const el = makeElement("icon", { x: 3.24, y: 3 }, { icon: "bleach-no" });
    expect(el.type).toBe("icon");
    expect(el.x).toBe(3);
    if (el.type === "icon") {
      expect(el.icon).toBe("bleach-no");
      expect(el.hMm).toBe(ICON_DEFAULT_MM);
    }
    const def = makeElement("icon", { x: 1, y: 1 });
    if (def.type === "icon") expect(def.icon).toBe("wash-30");
  });
});

describe("makeBarcodePair", () => {
  it("iki bağımsız öğe: çubuklar (human:false) + altında ORTALI field(barcode)", () => {
    const [bc, code] = makeBarcodePair({ x: 3, y: 40 });
    expect(bc.type).toBe("code128");
    if (bc.type === "code128") expect(bc.human).toBe(false);
    expect(code.type).toBe("field");
    if (code.type === "field") {
      expect(code.bind).toBe("barcode");
      expect(code.label).toBe("");
    }
    // Kod barkodun ALTINDA (y büyür) ve ortalama için SAĞA kaymış (x ≥ barkod x).
    expect(code.y).toBeGreaterThan(bc.y);
    expect(code.x).toBeGreaterThanOrEqual(bc.x);
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

  it("metin: SERBEST boyut — dikey=hMm (0.5 snap), yatay=genişlik oranı", () => {
    const el: TextElement = { id: "t", type: "text", text: "ÖRNEK YAZI", x: 0, y: 0 };
    // hedef 5.2mm → 5mm; doğal genişlik 10 kr × 5 × 0.6 = 30 → oran değişmez
    expect(applyResize(el, 30, 5.2)).toEqual({ hMm: 5 });
    // yatay iki katına çek → wr 2
    expect(applyResize({ ...el, hMm: 5 }, 60, 5)).toEqual({ wr: 2 });
    // değişiklik yoksa null
    expect(applyResize({ ...el, hMm: 5, wr: 2 }, 60, 5)).toBeNull();
  });

  it("icon: kare boyut — büyük eksen kenar olur, 0.5 snap + 3-50 clamp", () => {
    const el: IconElement = { id: "i", type: "icon", icon: "wash-30", x: 0, y: 0, hMm: 8 };
    expect(applyResize(el, 10.26, 6)).toEqual({ hMm: 10.5 }); // max(w,h) snap'li
    expect(applyResize(el, 1, 1)).toEqual({ hMm: 3 });        // alt clamp
    expect(applyResize(el, 200, 200)).toEqual({ hMm: 50 });   // üst clamp
    expect(applyResize(el, 8, 8)).toBeNull();                 // değişiklik yok
  });

  it("metin: hMm/wr sınır kutusuna birebir yansır", () => {
    const el: TextElement = { id: "t", type: "text", text: "AB", x: 0, y: 0, hMm: 8, wr: 2 };
    const b = estimateBounds(el, CANVAS);
    expect(b.h).toBe(8);
    expect(b.w).toBeCloseTo(2 * 8 * 0.6 * 2);
  });
});

describe("alignElements / distributeElements", () => {
  // Sabit boyutlu çizgiler — estimateBounds tahmini birebir (w=wMm, h=hMm).
  const boxes: LabelElement[] = [
    { id: "a", type: "line", x: 10, y: 10, wMm: 10, hMm: 4 },
    { id: "b", type: "line", x: 30, y: 20, wMm: 20, hMm: 4 },
    { id: "c", type: "line", x: 70, y: 40, wMm: 10, hMm: 4 },
  ];

  it("sola hizala: hepsi seçimin min-x'ine", () => {
    const p = alignElements(boxes, ["a", "b", "c"], "left", CANVAS);
    expect(p["b"]).toEqual({ x: 10 });
    expect(p["c"]).toEqual({ x: 10 });
    expect(p["a"]).toBeUndefined(); // zaten min-x'te — yama yok
  });

  it("sağa hizala: sağ kenarlar seçimin max sağına", () => {
    const p = alignElements(boxes, ["a", "b", "c"], "right", CANVAS);
    expect(p["a"]).toEqual({ x: 70 }); // 80 - 10
    expect(p["b"]).toEqual({ x: 60 }); // 80 - 20
    expect(p["c"]).toBeUndefined();
  });

  it("üste hizala + tek eleman seçiliyse no-op", () => {
    const p = alignElements(boxes, ["a", "b", "c"], "top", CANVAS);
    expect(p["b"]).toEqual({ y: 10 });
    expect(p["c"]).toEqual({ y: 10 });
    expect(alignElements(boxes, ["a"], "left", CANVAS)).toEqual({});
  });

  it("yatay boşluk eşitle: uçlar sabit, aradaki eşit aralığa", () => {
    // span=10..80, toplam w=40, gap=(70-40)/2=15 → b.x = 10+10+15 = 35
    const p = distributeElements(boxes, ["a", "b", "c"], "h", CANVAS);
    expect(p["b"]).toEqual({ x: 35 });
    expect(p["a"]).toBeUndefined();
    expect(p["c"]).toBeUndefined();
  });

  it("boşluk eşitleme <3 elemanda no-op", () => {
    expect(distributeElements(boxes, ["a", "b"], "h", CANVAS)).toEqual({});
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

describe("describeCondition", () => {
  const names: Record<string, string> = { "1.KALITE": "1. Kalite", A1: "A1 (Alt Kalite)" };
  const nameOf = (c: string) => names[c];

  it("kodları ADA çevirir (in / notIn ayrı okunur)", () => {
    expect(describeCondition({ field: "qualityGrade", op: "in", values: ["A1"] }, nameOf))
      .toBe("Yalnız A1 (Alt Kalite) basılır");
    expect(describeCondition({ field: "qualityGrade", op: "notIn", values: ["1.KALITE"] }, nameOf))
      .toBe("1. Kalite DIŞINDA basılır");
  });

  it("katalogda olmayan kodu KODUYLA gösterir (ölü koşul görünür kalsın)", () => {
    expect(describeCondition({ field: "qualityGrade", op: "in", values: ["SILINMIS"] }, nameOf))
      .toBe("Yalnız SILINMIS basılır");
  });
});

describe("conditionsMutuallyExclusive", () => {
  const inC = (...values: string[]) => ({ field: "qualityGrade" as const, op: "in" as const, values });
  const notInC = (...values: string[]) => ({ field: "qualityGrade" as const, op: "notIn" as const, values });

  it("ayrık in kümeleri birlikte basılamaz (çakışma uyarısı bastırılır)", () => {
    expect(conditionsMutuallyExclusive(inC("1.KALITE"), inC("A1"))).toBe(true);
    // Kesişiyorlar: karşılaştırma YEREL-BAĞIMSIZ büyük harfle yapılır (Türkçe kuralı
    // "1.kalite"yi "1.KALİTE" yapıp bu iki kodu YANLIŞLIKLA ayrık gösterirdi).
    expect(conditionsMutuallyExclusive(inC("1.kalite"), inC("1.KALITE"))).toBe(false);
  });

  it("in ⊆ notIn ise dışlarlar", () => {
    expect(conditionsMutuallyExclusive(inC("A1"), notInC("A1"))).toBe(true);
    expect(conditionsMutuallyExclusive(notInC("A1", "FIRE"), inC("A1"))).toBe(true);
    expect(conditionsMutuallyExclusive(inC("A1"), notInC("FIRE"))).toBe(false);
  });

  it("koşulsuz eleman ya da notIn+notIn → dışlama YOK (temkinli)", () => {
    expect(conditionsMutuallyExclusive(undefined, inC("A1"))).toBe(false);
    expect(conditionsMutuallyExclusive(notInC("A1"), notInC("FIRE"))).toBe(false);
  });
});
