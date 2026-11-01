// Tarama görüntüleyicisi saf görünüm matematiği: imleç noktasına zoom, sınırlar, döndürme + kutu dönüşümü, sığdır.
import { describe, expect, it } from "vitest";
import {
  boxOnScreen,
  clampPan,
  fitScale,
  fitView,
  focusBox,
  isBoxVisible,
  MAX_REL,
  MIN_MAX_ABS,
  MIN_REL,
  panBy,
  rotateView,
  toScreen,
  viewMatrix,
  wheelFactor,
  zoomAt,
  zoomPercent,
  type Rotation,
  type View,
} from "../scanView";

const nat = { w: 800, h: 400 };
const vp = { w: 400, h: 400 };
const g = { nat, vp };
const ROTS: Rotation[] = [0, 90, 180, 270];
/** Ekran noktasının altındaki görüntü pikseli (toScreen'in tersi; matris tersinden). */
function underCursor(v: View, p: { x: number; y: number }) {
  const [a, b, c, d, e, f] = viewMatrix(v, nat);
  const det = a * d - b * c;
  const x = p.x - e;
  const y = p.y - f;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}

describe("scanView matrisi", () => {
  it("CSS matrisi toScreen ile her yönelimde birebir aynı", () => {
    for (const rot of ROTS) {
      const v: View = { scale: 1.7, tx: 13, ty: -42, rot };
      for (const p of [
        { x: 0, y: 0 },
        { x: 800, y: 400 },
        { x: 123, y: 321 },
      ]) {
        const [a, b, c, d, e, f] = viewMatrix(v, nat);
        const s = toScreen(v, nat, p);
        expect(a * p.x + c * p.y + e).toBeCloseTo(s.x);
        expect(b * p.x + d * p.y + f).toBeCloseTo(s.y);
      }
    }
  });
  it("90° döndürmede görüntü köşeleri döndürülmüş dikdörtgene düşer (sol üst → sağ üst)", () => {
    const v: View = { scale: 1, tx: 0, ty: 0, rot: 90 };
    expect(toScreen(v, nat, { x: 0, y: 0 })).toEqual({ x: 400, y: 0 });
    expect(toScreen(v, nat, { x: 800, y: 400 })).toEqual({ x: 0, y: 800 });
  });
});

describe("sığdır ve sınırlar", () => {
  it("sığdır: geniş görüntü genişliğe oturur, dikeyde ortalanır", () => {
    expect(fitView(nat, vp)).toEqual({ scale: 0.5, tx: 0, ty: 100, rot: 0 });
    expect(zoomPercent(fitView(nat, vp), nat, vp)).toBe(100);
  });
  it("ölçülmemiş görünüm (0×0) → ölçek 1, NaN yok", () => {
    const v = fitView(nat, { w: 0, h: 0 });
    expect(v.scale).toBe(1);
    expect(Number.isFinite(v.tx) && Number.isFinite(v.ty)).toBe(true);
  });
  it("imleç noktasındaki piksel zoomdan sonra aynı yerde kalır", () => {
    const v0 = zoomAt(fitView(nat, vp), 3, { x: 200, y: 200 }, g);
    const at = { x: 150, y: 260 };
    const before = underCursor(v0, at);
    const v1 = zoomAt(v0, 1.8, at, g);
    const after = underCursor(v1, at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(v1.scale).toBeCloseTo(v0.scale * 1.8);
  });
  it("üst ve alt sınır sığdır'a göre kıstırılır", () => {
    const fit = fitView(nat, vp);
    expect(zoomAt(fit, 1e6, { x: 10, y: 10 }, g).scale).toBe(Math.max(fit.scale * MAX_REL, MIN_MAX_ABS));
    const out = zoomAt(fit, 1e-6, { x: 10, y: 10 }, g);
    expect(out.scale).toBe(fit.scale * MIN_REL);
    // küçülen görüntü ortalanır
    expect(out.tx).toBeCloseTo((400 - 800 * out.scale) / 2);
  });
  it("kaydırma görüntüyü görünümden kaçırmaz", () => {
    const z = zoomAt(fitView(nat, vp), 4, { x: 200, y: 200 }, g);
    const far = panBy(z, { x: 1e5, y: -1e5 }, g);
    expect(far.tx).toBe(0);
    expect(far.ty).toBe(400 - 400 * z.scale);
    expect(clampPan(far, nat, vp)).toEqual(far);
  });
});

describe("döndürme ve kutular", () => {
  it("döndür 90° adımla ilerler, yeni yönelime sığar; dört kez → başa döner", () => {
    let v = fitView(nat, vp);
    v = rotateView(v, nat, vp);
    expect(v.rot).toBe(90);
    expect(v.scale).toBe(fitScale(nat, vp, 90));
    for (let i = 0; i < 3; i++) v = rotateView(v, nat, vp);
    expect(v).toEqual(fitView(nat, vp, 0));
  });
  it("kutu döndürmeyle birlikte dönüşür", () => {
    const v: View = { scale: 1, tx: 0, ty: 0, rot: 90 };
    expect(boxOnScreen(v, nat, { x: 0, y: 0, width: 10, height: 20 })).toEqual({
      x: 380,
      y: 0,
      width: 20,
      height: 10,
    });
    const v180: View = { scale: 2, tx: 5, ty: 5, rot: 180 };
    expect(boxOnScreen(v180, nat, { x: 0, y: 0, width: 10, height: 20 })).toEqual({
      x: 5 + 2 * 790,
      y: 5 + 2 * 380,
      width: 20,
      height: 40,
    });
  });
  it("kutuya odak: kutu görünüm ortasına gelir ve görünür; zoom=true büyütür", () => {
    const box = { x: 700, y: 350, width: 80, height: 20 };
    for (const rot of ROTS) {
      const anchor = rot === 180 ? { x: 400, y: 400 } : { x: 0, y: 0 };
      const base = zoomAt(fitView(nat, vp, rot), 6, anchor, g);
      expect(isBoxVisible(base, nat, vp, box)).toBe(false);
      const f = focusBox(base, g, box, false);
      expect(f.scale).toBe(base.scale);
      expect(isBoxVisible(f, nat, vp, box)).toBe(true);
      const z = focusBox(fitView(nat, vp, rot), g, box, true);
      expect(z.scale).toBeGreaterThan(fitScale(nat, vp, rot));
      expect(isBoxVisible(z, nat, vp, box)).toBe(true);
    }
  });
});

describe("tekerlek çarpanı", () => {
  it("yukarı tekerlek yaklaştırır, aşağı uzaklaştırır; ctrl (pinch) daha hassas; satır modu ölçeklenir; aşırı delta kıstırılır", () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-48, 0, false));
    expect(wheelFactor(-1e6, 0, false)).toBe(wheelFactor(-300, 0, false));
  });
});
