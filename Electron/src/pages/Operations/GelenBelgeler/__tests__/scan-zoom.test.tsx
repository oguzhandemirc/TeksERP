// Yakınlaştırılabilir tarama: düğmeler, klavye, tekerlek, çift tık, döndürme, büyük görünüm, sayfa değişiminde sıfırlama, satıra kaydırma.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ZoomableScan } from "../ZoomableScan";
import { ScanViewer } from "../ScanViewer";
import type { DocumentScanInfo } from "../types";

vi.mock("../useScanImage", () => ({
  useScanImage: (id: string | null) => ({
    url: id ? `blob:${id}` : null,
    isPdf: false,
    isLoading: false,
    isError: false,
  }),
}));

// jsdom yerleşim yapmaz: görünüm 400×400, görüntü 800×400 (sığdır ölçeği 0,5).
const saved: (PropertyDescriptor | undefined)[] = [];
const PROPS: [object, string, number][] = [
  [HTMLElement.prototype, "clientWidth", 400],
  [HTMLElement.prototype, "clientHeight", 400],
  [HTMLImageElement.prototype, "naturalWidth", 800],
  [HTMLImageElement.prototype, "naturalHeight", 400],
];
beforeAll(() => {
  for (const [o, k, v] of PROPS) {
    saved.push(Object.getOwnPropertyDescriptor(o, k));
    Object.defineProperty(o, k, { configurable: true, get: () => v });
  }
});
afterAll(() =>
  PROPS.forEach(([o, k], i) => {
    const d = saved[i];
    if (d) Object.defineProperty(o, k, d);
    else delete (o as Record<string, unknown>)[k];
  }),
);

const percent = () => screen.getByTestId("scan-zoom-percent").textContent;
const matrix = () =>
  (screen.getByTestId("scan-transform").style.transform.match(/matrix\((.*)\)/)?.[1] ?? "")
    .split(",")
    .map(Number);
const btn = (name: string) => screen.getByRole("button", { name });
const load = () => fireEvent.load(screen.getByRole("img"));
const renderScan = (props: Partial<React.ComponentProps<typeof ZoomableScan>> = {}) => {
  const r = render(<ZoomableScan url="blob:x" alt="Belge sayfa 1" highlight={null} {...props} />);
  load();
  return r;
};

describe("ZoomableScan", () => {
  it("yüklenince sığdır %100; + / − / Sığdır düğmeleri", () => {
    renderScan();
    expect(percent()).toBe("%100");
    fireEvent.click(btn("Yakınlaştır"));
    expect(percent()).toBe("%125");
    fireEvent.click(btn("Yakınlaştır"));
    fireEvent.click(btn("Uzaklaştır"));
    expect(percent()).toBe("%125");
    fireEvent.click(btn("Sığdır"));
    expect(percent()).toBe("%100");
    for (const l of [
      "Yakınlaştır",
      "Uzaklaştır",
      "Sığdır",
      "Döndür (90°)",
      "Seçili satıra odaklan",
      "Büyük görünüm",
    ])
      expect(btn(l).getAttribute("title")).toBe(l);
  });
  it("klavye: + yaklaştırır, − uzaklaştırır, 0 sığdırır, R döndürür", () => {
    renderScan();
    const vpEl = screen.getByTestId("scan-viewer");
    fireEvent.keyDown(vpEl, { key: "+" });
    fireEvent.keyDown(vpEl, { key: "=" });
    expect(percent()).toBe("%156");
    fireEvent.keyDown(vpEl, { key: "-" });
    expect(percent()).toBe("%125");
    fireEvent.keyDown(vpEl, { key: "0" });
    expect(percent()).toBe("%100");
    fireEvent.keyDown(vpEl, { key: "r" });
    expect(matrix().slice(0, 4)).toEqual([0, 0.5, -0.5, 0]);
  });
  it("tekerlek yaklaştırır (sayfa kaymaz), çift tık yaklaştırır/sığdırır", () => {
    renderScan();
    const vpEl = screen.getByTestId("scan-viewer");
    const ev = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => void vpEl.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(Number(percent()?.slice(1))).toBeGreaterThan(100);
    fireEvent.click(btn("Sığdır"));
    fireEvent.doubleClick(vpEl, { clientX: 100, clientY: 200 });
    expect(percent()).toBe("%250");
    fireEvent.doubleClick(vpEl, { clientX: 100, clientY: 200 });
    expect(percent()).toBe("%100");
  });
});

describe("ZoomableScan döndürme, büyük görünüm, satıra kaydırma", () => {
  it("Döndür (90°) görüntü ve vurguyu aynı kapta döndürür", () => {
    renderScan({ highlight: { x: 10, y: 10, width: 100, height: 20 } });
    const box = screen.getByTestId("scan-highlight");
    expect(screen.getByTestId("scan-transform").contains(box)).toBe(true);
    fireEvent.click(btn("Döndür (90°)"));
    const [a, b, c, d] = matrix();
    expect([a, b, c, d]).toEqual([0, 0.5, -0.5, 0]);
    // Döndürülmüş 400×800 görüntü 400×400 görünüme sığar.
    expect(percent()).toBe("%100");
  });
  it("Büyük görünüm tam ekran kabı açar; Escape kapatır", () => {
    renderScan();
    fireEvent.click(btn("Büyük görünüm"));
    expect(screen.getByTestId("scan-zoom-root").dataset.fullscreen).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("scan-zoom-root").dataset.fullscreen).toBe("false");
  });
  it("yakınlaşılmışken başka satır seçilince kutu görünüme kaydırılır; sığdır'da görünüm oynamaz", () => {
    const far = { x: 700, y: 350, width: 80, height: 20 };
    const r = renderScan({ highlight: { x: 0, y: 0, width: 10, height: 10 }, selectionKey: "a" });
    const fitM = matrix();
    r.rerender(<ZoomableScan url="blob:x" alt="Belge sayfa 1" highlight={far} selectionKey="b" />);
    expect(matrix()).toEqual(fitM);
    for (let i = 0; i < 6; i++) fireEvent.keyDown(screen.getByTestId("scan-viewer"), { key: "+" });
    fireEvent.keyDown(screen.getByTestId("scan-viewer"), { key: "ArrowLeft" });
    r.rerender(
      <ZoomableScan
        url="blob:x"
        alt="Belge sayfa 1"
        highlight={{ x: 0, y: 0, width: 10, height: 10 }}
        selectionKey="c"
      />,
    );
    r.rerender(<ZoomableScan url="blob:x" alt="Belge sayfa 1" highlight={far} selectionKey="d" />);
    const [s = NaN, , , , e = NaN, f = NaN] = matrix();
    expect(far.x * s + e).toBeGreaterThanOrEqual(0);
    expect((far.x + far.width) * s + e).toBeLessThanOrEqual(400);
    expect(far.y * s + f).toBeGreaterThanOrEqual(0);
    expect((far.y + far.height) * s + f).toBeLessThanOrEqual(400);
  });
});

describe("ScanViewer sayfa değişimi", () => {
  const scan = (id: string, pageNo: number): DocumentScanInfo => ({
    id,
    noteId: "n1",
    pageNo,
    regionNo: null,
    mimeType: "image/jpeg",
    sizeBytes: 1,
    status: "READ",
    attempts: 1,
  });
  it("başka sayfaya geçince görünüm sığdır'a döner", () => {
    render(<ScanViewer scans={[scan("s1", 1), scan("s2", 2)]} highlight={null} />);
    load();
    fireEvent.click(btn("Yakınlaştır"));
    fireEvent.click(btn("Döndür (90°)"));
    fireEvent.click(btn("Yakınlaştır"));
    expect(percent()).toBe("%125");
    fireEvent.click(btn("Sayfa 2"));
    load();
    expect(percent()).toBe("%100");
    expect(matrix().slice(0, 4)).toEqual([0.5, 0, 0, 0.5]);
  });
});
