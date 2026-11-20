import { describe, expect, it, vi } from "vitest";
import { exportPng } from "./render";
import type { Snapshot } from "./model";

/** Çağrıları kaydeden sahte 2B bağlam + tuval (jsdom tuval çizmez). */
function fakeDocument(contextAvailable = true) {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => calls.push({ name: prop, args });
    },
    set: (target, prop: string, value) => {
      target[prop] = value;
      return true;
    },
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => (contextAvailable ? ctx : null)),
    toDataURL: vi.fn(() => "data:image/png;base64,UE5HREFUQQ=="),
  };
  const doc = { createElement: vi.fn(() => canvas) } as unknown as Document;
  return { doc, canvas, calls };
}

const image = {} as CanvasImageSource;
const empty: Snapshot = { shapes: [], crop: null };

describe("PNG çıktısı", () => {
  it("düz base64 döner (data: öneki yok) ve PNG ister", () => {
    const f = fakeDocument();
    const out = exportPng({ image, width: 1280, height: 720, snapshot: empty }, f.doc);
    expect(out).toEqual({ base64: "UE5HREFUQQ==", width: 1280, height: 720 });
    expect(f.canvas.toDataURL).toHaveBeenCalledWith("image/png");
  });

  it("uzun kenar 1920 px'e küçültülür", () => {
    const f = fakeDocument();
    const out = exportPng({ image, width: 3840, height: 2400, snapshot: empty }, f.doc);
    expect(out?.width).toBe(1920);
    expect(out?.height).toBe(1200);
    expect(f.calls.find((c) => c.name === "scale")?.args).toEqual([0.5, 0.5]);
  });

  it("kırpma alanı kesilir: tuval kırpma boyutunda, görüntü kırpma köşesine kaydırılır", () => {
    const f = fakeDocument();
    const snapshot: Snapshot = { shapes: [], crop: { x: 100, y: 50, w: 400, h: 300 } };
    const out = exportPng({ image, width: 1280, height: 720, snapshot }, f.doc);
    expect(out).toMatchObject({ width: 400, height: 300 });
    expect(f.calls.find((c) => c.name === "translate")?.args).toEqual([-100, -50]);
  });

  it("karartma kutusu DOLU dikdörtgen olarak çizilir (altındaki veri çıktıya sızmaz)", () => {
    const f = fakeDocument();
    const snapshot: Snapshot = {
      shapes: [{ kind: "redact", from: { x: 10, y: 10 }, to: { x: 60, y: 30 }, color: "#ef4444", width: 3 }],
      crop: null,
    };
    exportPng({ image, width: 200, height: 100, snapshot }, f.doc);
    const names = f.calls.map((c) => c.name);
    expect(names.indexOf("drawImage")).toBeLessThan(names.indexOf("fillRect"));
    expect(f.calls.find((c) => c.name === "fillRect")?.args).toEqual([10, 10, 50, 20]);
  });

  it("tuval bağlamı yoksa null", () => {
    const f = fakeDocument(false);
    expect(exportPng({ image, width: 10, height: 10, snapshot: empty }, f.doc)).toBeNull();
  });
});
