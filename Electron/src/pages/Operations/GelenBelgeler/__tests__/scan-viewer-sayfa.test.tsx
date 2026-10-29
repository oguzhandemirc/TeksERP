// Görüntüleyici seçili satırın sayfasına geçer, vurguyu yalnız o sayfaya çizer (E4b scanId).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScanViewer } from "../ScanViewer";
import type { DocumentScanInfo } from "../types";

vi.mock("../useScanImage", () => ({
  useScanImage: (id: string | null) => ({ url: id ? `blob:${id}` : null, isPdf: false, isLoading: false, isError: false }),
}));

const scan = (id: string, pageNo: number): DocumentScanInfo => ({ id, noteId: "n1", pageNo, regionNo: null, mimeType: "image/jpeg", sizeBytes: 1, status: "READ", attempts: 1 });
const scans = [scan("s1", 1), scan("s2", 2)];
const rect = { x: 1, y: 1, width: 2, height: 2 };
const shownPage = () => screen.getByRole("img").getAttribute("alt");
const loadImg = () => fireEvent.load(screen.getByRole("img"));

describe("ScanViewer sayfa ve vurgu", () => {
  it("highlightScanId=s2 → 2. sayfa görünür ve vurgu orada", () => {
    render(<ScanViewer scans={scans} highlight={rect} highlightScanId="s2" selectionKey="a" />);
    expect(shownPage()).toBe("Belge sayfa 2");
    loadImg();
    expect(screen.queryByTestId("scan-highlight")).not.toBeNull();
  });
  it("elle 1. sayfaya dönülünce vurgu 1. sayfaya çizilmez", () => {
    render(<ScanViewer scans={scans} highlight={rect} highlightScanId="s2" selectionKey="a" />);
    fireEvent.click(screen.getByRole("button", { name: "Sayfa 1" }));
    expect(shownPage()).toBe("Belge sayfa 1");
    loadImg();
    expect(screen.queryByTestId("scan-highlight")).toBeNull();
  });
  it("aynı sayfadaki başka satır seçilince satırın sayfasına geri dönülür", () => {
    const r = render(<ScanViewer scans={scans} highlight={rect} highlightScanId="s2" selectionKey="a" />);
    fireEvent.click(screen.getByRole("button", { name: "Sayfa 1" }));
    r.rerender(<ScanViewer scans={scans} highlight={rect} highlightScanId="s2" selectionKey="b" />);
    expect(shownPage()).toBe("Belge sayfa 2");
  });
  it("belgede olmayan tarama kimliği → vurgu seçili sayfaya (kaybolmaz)", () => {
    render(<ScanViewer scans={scans} highlight={rect} highlightScanId="yok" selectionKey="a" />);
    expect(shownPage()).toBe("Belge sayfa 1");
    loadImg();
    expect(screen.queryByTestId("scan-highlight")).not.toBeNull();
  });
  it("yoklama tazelemesi (aynı sayfalar, yeni dizi) elle seçilen sayfayı ezmez", () => {
    const r = render(<ScanViewer scans={scans} highlight={rect} highlightScanId="s2" selectionKey="a" />);
    fireEvent.click(screen.getByRole("button", { name: "Sayfa 1" }));
    r.rerender(<ScanViewer scans={scans.map((s) => ({ ...s }))} highlight={rect} highlightScanId="s2" selectionKey="a" />);
    expect(shownPage()).toBe("Belge sayfa 1");
  });
  it("vurgu yalnız görüntü boyutu bilinince çizilir (yüzde konum)", () => {
    render(<ScanViewer scans={scans} highlight={rect} highlightScanId="s2" selectionKey="a" />);
    expect(screen.queryByTestId("scan-highlight")).toBeNull();
    const img = screen.getByRole("img");
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    Object.defineProperty(img, "naturalHeight", { value: 50 });
    fireEvent.load(img);
    const box = screen.getByTestId("scan-highlight");
    expect(box.style.left).toBe("1%");
    expect(box.style.top).toBe("2%");
    expect(box.style.width).toBe("2%");
    expect(box.style.height).toBe("4%");
  });
});
