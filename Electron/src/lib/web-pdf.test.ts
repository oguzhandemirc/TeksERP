import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ⭐ WEBDE PDF = YAZDIR (bulut web paneli K3): aynı belge HTML'i boğazdan (`printTracked`, PDF türü) ile yazdırma
 * penceresinde açılır; "Hedef: PDF olarak kaydet" ipucu oturumda BİR KEZ. Electron'da main
 * süreçteki `pdf.save` yolu aynen.
 */
// Boğaz (`printTracked`) sahtelenir: web yolunun basılan HTML'i ve PDF türü ölçülür.
const printHtmlString = vi.hoisted(() => vi.fn());
vi.mock("@/lib/print", () => ({
  printTracked: (o: { html?: string; outputKind?: string }) => {
    printHtmlString(o.html, o.outputKind);
    return Promise.resolve({ status: "BELIRSIZ", proceed: true, printJob: {} });
  },
  trackPdfSave: (_s: unknown, run: () => Promise<unknown>) => run(),
}));
const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const cols = [{ label: "Ad", value: (r: { ad: string }) => r.ad }];
const rows = [{ ad: "Top-1" }];

async function load(electron: boolean) {
  vi.resetModules();
  vi.doMock("@/lib/runtime-env", () => ({ IS_ELECTRON: electron }));
  return {
    listExport: await import("@/lib/list-export"),
    webPdf: await import("@/lib/web-pdf"),
  };
}

beforeEach(() => {
  printHtmlString.mockClear();
  Object.values(toast).forEach((f) => f.mockClear());
});
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
});

describe("liste PDF — web", () => {
  it("⭐ exportRowsToPdf yazdırma penceresini açar (aynı liste HTML'i); ipucu yalnız bir kez", async () => {
    const { listExport } = await load(false);
    expect(await listExport.exportRowsToPdf(cols, rows, "Toplar")).toBe(true);
    expect(await listExport.exportRowsToPdf(cols, rows, "Toplar")).toBe(true);
    expect(printHtmlString).toHaveBeenCalledTimes(2);
    expect(String(printHtmlString.mock.calls[0]?.[0])).toContain("Top-1");
    expect(printHtmlString.mock.calls[0]?.[1]).toBe("PDF");
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(String(toast.info.mock.calls[0]?.[0])).toMatch(/PDF olarak kaydet/);
  });

  it("çoklu belge TEK baskı işinde açılır", async () => {
    const { webPdf } = await load(false);
    const res = webPdf.printDocsAsPdfOutcome(["<html><body>A</body></html>", "<html><body>B</body></html>"], { kind: "BELGE" });
    expect(res).toMatchObject({ ok: true, count: 2, printed: true });
    expect(printHtmlString).toHaveBeenCalledTimes(1);
  });
});

describe("liste PDF — Electron", () => {
  it("main süreç pdf.save'e gider, yazdırma penceresi AÇILMAZ", async () => {
    const save = vi.fn(async () => ({ saved: true }));
    (window as unknown as { api: unknown }).api = { pdf: { save } };
    const { listExport } = await load(true);
    expect(await listExport.exportRowsToPdf(cols, rows, "Toplar")).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(printHtmlString).not.toHaveBeenCalled();
  });

  it("Electron'da PDF köprüsü yoksa (eski preload) bugünkü gibi false — web dalına düşmez", async () => {
    const { listExport } = await load(true);
    expect(await listExport.exportRowsToPdf(cols, rows, "Toplar")).toBe(false);
    expect(printHtmlString).not.toHaveBeenCalled();
  });
});
