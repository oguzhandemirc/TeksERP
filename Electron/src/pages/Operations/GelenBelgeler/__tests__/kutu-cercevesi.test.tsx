// K28 KÜÇÜK fotoğraf: OCR kutuları okuma çerçevesinde (2600) kalır, bayt küçülür → görüntü çerçeveye gerilir, kutu/dokunma kaymaz.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ZoomableScan } from "../ZoomableScan";
import { ScanViewer } from "../ScanViewer";
import { CellCrop } from "../CellCrop";
import { scanRectFrame, wordsRectFrame } from "../photoRetention";
import type { DocumentScanInfo } from "../types";

vi.mock("../useScanImage", () => ({
  useScanImage: (id: string | null) => ({ url: id ? `blob:${id}` : null, isPdf: false, isLoading: false, isError: false }),
}));

// Görünüm 400×400; KÜÇÜK bayt 800×400, okuma çerçevesi 1600×800 (oran 2).
const saved: (PropertyDescriptor | undefined)[] = [];
const PROPS: [object, string, number][] = [
  [HTMLElement.prototype, "clientWidth", 400],
  [HTMLElement.prototype, "clientHeight", 400],
  [HTMLImageElement.prototype, "naturalWidth", 800],
  [HTMLImageElement.prototype, "naturalHeight", 400],
];
// jsdom'da PointerEvent yok: clientX/pointerId taşıyan ince bir MouseEvent türevi.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}
const hadPointer = "PointerEvent" in window;
beforeAll(() => {
  if (!hadPointer) (window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
  for (const [o, k, v] of PROPS) {
    saved.push(Object.getOwnPropertyDescriptor(o, k));
    Object.defineProperty(o, k, { configurable: true, get: () => v });
  }
});
afterAll(() => {
  if (!hadPointer) delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
  PROPS.forEach(([o, k], i) => {
    const d = saved[i];
    if (d) Object.defineProperty(o, k, d);
    else delete (o as Record<string, unknown>)[k];
  });
});

const FRAME = { w: 1600, h: 800 };
const box = { x: 800, y: 0, width: 400, height: 200 };
const load = () => fireEvent.load(screen.getByRole("img"));
const tapAt = (x: number, y: number) => {
  const vp = screen.getByTestId("scan-viewer");
  fireEvent.pointerDown(vp, { pointerId: 1, button: 0, clientX: x, clientY: y, pointerType: "mouse" });
  fireEvent.pointerUp(vp, { pointerId: 1, button: 0, clientX: x, clientY: y, pointerType: "mouse" });
};

describe("ZoomableScan kutu çerçevesi", () => {
  it("frame verilince vurgu çerçeveye göre yerleşir, görüntü çerçeveye gerilir", () => {
    render(<ZoomableScan url="blob:x" alt="a" highlight={box} frame={FRAME} />);
    load();
    const hl = screen.getByTestId("scan-highlight");
    expect(hl.style.left).toBe("50%");
    expect(hl.style.width).toBe("25%");
    expect(screen.getByTestId("scan-transform").style.width).toBe("1600px");
    expect(screen.getByRole("img").style.width).toBe("1600px");
  });
  it("frame yok → bugünkü davranış (fotoğraf pikseli)", () => {
    render(<ZoomableScan url="blob:x" alt="a" highlight={box} />);
    load();
    expect(screen.getByTestId("scan-highlight").style.left).toBe("100%");
    expect(screen.getByTestId("scan-transform").style.width).toBe("800px");
  });
  it("dokunma noktası çerçeve koordinatında döner (tanıtma doğru kelimeyi seçer)", () => {
    const onTap = vi.fn();
    render(<ZoomableScan url="blob:x" alt="a" highlight={null} frame={FRAME} onTap={onTap} />);
    load();
    tapAt(200, 200);
    expect(onTap).toHaveBeenCalledTimes(1);
    const p = onTap.mock.calls[0]![0] as { x: number; y: number };
    expect(Math.round(p.x)).toBe(800);
    expect(Math.round(p.y)).toBe(400);
  });
});

describe("ScanViewer / CellCrop çerçeveyi taramadan alır", () => {
  const scan: DocumentScanInfo = {
    id: "s1", noteId: "n1", pageNo: 1, regionNo: null, mimeType: "image/jpeg", sizeBytes: 1, status: "READ", attempts: 1,
    contentState: "REDUCED", rectFrameWidth: 1600, rectFrameHeight: 800,
  };
  it("KÜÇÜK taramanın rectFrame'i vurguyu ölçekler", () => {
    render(<ScanViewer scans={[scan]} highlight={box} highlightScanId="s1" />);
    load();
    expect(screen.getByTestId("scan-highlight").style.left).toBe("50%");
  });
  it("hücre kırpığı görüntüyü çerçeve boyutuna gerer", () => {
    render(<CellCrop scanId="s1" rect={{ x: 100, y: 100, width: 80, height: 20 }} frame={FRAME} />);
    const img = screen.getByRole("img");
    const s = Math.min(4, 320 / (80 + 24));
    expect(parseFloat(img.style.width)).toBeCloseTo(1600 * s);
    expect(parseFloat(img.style.height)).toBeCloseTo(800 * s);
  });
  it("yardımcılar: eksik çerçeve null; yan dönük kelime çerçevesi takas", () => {
    expect(scanRectFrame({ rectFrameWidth: null, rectFrameHeight: 800 })).toBeNull();
    expect(scanRectFrame(undefined)).toBeNull();
    expect(wordsRectFrame({ imageWidth: 2600, imageHeight: 1733, rotation: 90 })).toEqual({ w: 1733, h: 2600 });
    expect(wordsRectFrame({ imageWidth: 2600, imageHeight: 1733, rotation: 0 })).toEqual({ w: 2600, h: 1733 });
  });
});
