import { describe, expect, it, vi } from "vitest";

// Kâğıt boyutu: belgenin `@page { size }` kuralı PDF'e geçer, boyutsuz belge A4'e düşer.
// Ölçüm (gerçek Electron 42, pdfinfo): `preferCSSPageSize` yokken A4/A5 belgeler Letter 612×792 pt
// çıkıyordu. Gerçek `pdf.ipc.ts`, electron sahteleriyle koşar; printToPDF'e giden seçenek ÖLÇÜLÜR.

const h = vi.hoisted(() => ({ printOpts: [] as unknown[] }));

vi.mock("electron", () => {
  class FakeBrowserWindow {
    readonly webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      printToPDF: async (opts: unknown) => {
        h.printOpts.push(opts);
        return new Uint8Array([1]);
      },
    };
    async loadURL(): Promise<void> {}
    destroy(): void {}
  }
  const ses = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
    protocol: { handle: vi.fn() },
  };
  return {
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => ses },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
    shell: { openExternal: vi.fn() },
  };
});
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const pdf = await import("../../electron/ipc/pdf.ipc");

describe("Kâğıt boyutu: belgenin @page boyutu PDF'e geçer", () => {
  it("⭐ tek kaynak seçenek: preferCSSPageSize + boyutsuz belgede A4 yedeği", () => {
    expect(pdf.PDF_PRINT_OPTIONS).toMatchObject({ preferCSSPageSize: true, pageSize: "A4", printBackground: true });
  });

  it("⭐ tekil PDF bu seçenekle basar", async () => {
    h.printOpts.length = 0;
    await pdf.htmlToPdf("<style>@page{size:A5}</style><p>x</p>");
    expect(h.printOpts).toEqual([pdf.PDF_PRINT_OPTIONS]);
    expect(h.printOpts[0]).toMatchObject({ preferCSSPageSize: true });
  });

  it("⭐ toplu PDF her belgeyi aynı seçenekle basar", async () => {
    h.printOpts.length = 0;
    await pdf.htmlsToPdfs(["<p>a</p>", "<p>b</p>"], async () => undefined);
    expect(h.printOpts).toHaveLength(2);
    for (const opts of h.printOpts) expect(opts).toMatchObject({ preferCSSPageSize: true, pageSize: "A4" });
  });
});
