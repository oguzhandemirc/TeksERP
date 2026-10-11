import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTvWindowHash, parseTvWindowRequest, pickTvDisplay, tvWindowUrl } from "@shared/tv-window";

// =============================================================================
// SALON TV PENCERESİ — dar IPC kanalı. İddia: `tv-window:open` YALNIZ uygulamanın kendi
// belgesini TV yolunda açar (adres renderer'dan alınmaz); keyfi URL/ek alan reddedilir;
// tek pencere (ikinci istek öne getirir); kapanış ana pencereye bildirilir (uygulamayla
// kapanış kullanıcı kapanışı sayılmaz); gönderen denetimi diğer kanallarla aynı geçitten.
// =============================================================================

type Listener = (...args: unknown[]) => unknown;
const h = vi.hoisted(() => {
  const windows: FakeWindow[] = [];
  class FakeWindow {
    opts: Record<string, unknown>;
    loaded: string[] = [];
    handlers = new Map<string, Listener[]>();
    destroyed = false;
    focused = 0;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      windows.push(this);
    }
    loadURL(url: string) {
      this.loaded.push(url);
      return Promise.resolve();
    }
    on(ev: string, fn: Listener) {
      this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
      return this;
    }
    once(ev: string, fn: Listener) {
      return this.on(ev, fn);
    }
    emit(ev: string) {
      for (const fn of this.handlers.get(ev) ?? []) fn({ preventDefault() {} });
    }
    close() {
      this.destroyed = true;
      this.emit("closed");
    }
    isDestroyed = () => this.destroyed;
    isMinimized = () => false;
    isFullScreen = () => false;
    getBounds = () => (this.opts as { x: number; y: number; width: number; height: number });
    setMenuBarVisibility() {}
    restore() {}
    show() {}
    focus() {
      this.focused += 1;
    }
    maximize() {}
    unmaximize() {}
    setFullScreen() {}
    setBounds() {}
  }
  const display = (id: number, x: number) => ({ id, label: `D${id}`, size: { width: 1920, height: 1080 }, workArea: { x, y: 0, width: 1920, height: 1040 } });
  return { windows, FakeWindow, displays: [display(1, 0), display(2, 1920)], handles: new Map<string, Listener>() };
});

vi.mock("electron", () => ({
  BrowserWindow: h.FakeWindow,
  screen: {
    getAllDisplays: () => h.displays,
    getPrimaryDisplay: () => h.displays[0],
    getDisplayMatching: (b: { x: number }) => h.displays.find((d) => d.workArea.x === b.x) ?? h.displays[0],
  },
  ipcMain: { handle: (ch: string, fn: Listener) => h.handles.set(ch, fn), on: vi.fn() },
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const ENTRY = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
const trusted = await import("../../electron/security/trusted-ipc");
const tv = await import("../../electron/ipc/tv-window.ipc");

const sent: unknown[][] = [];
const main = { isDestroyed: () => false, webContents: { send: (...a: unknown[]) => sent.push(a) } };
trusted.setTrustedAppEntry(ENTRY);
tv.registerTvWindowIpc({ preload: "/p.cjs", icon: "/i.ico", title: "TeksERP", entryArgument: "--x", mainWindow: () => main as never });
const appEvent = { senderFrame: { url: `${ENTRY}#/operations/weaving-floor`, parent: null } };
const open = (req: unknown) => h.handles.get("tv-window:open")!(appEvent, req) as ReturnType<typeof tv.openTvWindow>;

beforeEach(() => {
  for (const w of h.windows) if (!w.destroyed) w.close();
  h.windows.length = 0;
  sent.length = 0;
});

describe("sözleşme (saf)", () => {
  it("⭐ istek yalnız `{ displayId }`: dize/URL/ek alan/ondalık RED", () => {
    expect(parseTvWindowRequest({ displayId: null })).toEqual({ displayId: null });
    expect(parseTvWindowRequest({ displayId: 2 })).toEqual({ displayId: 2 });
    expect(parseTvWindowRequest({})).toEqual({ displayId: null });
    expect(parseTvWindowRequest("https://saldirgan.example/")).toBeNull();
    expect(parseTvWindowRequest({ url: "https://saldirgan.example/" })).toBeNull();
    expect(parseTvWindowRequest({ displayId: 2, url: "file:///etc/passwd" })).toBeNull();
    expect(parseTvWindowRequest({ displayId: "2" })).toBeNull();
    expect(parseTvWindowRequest({ displayId: 1.5 })).toBeNull();
    expect(parseTvWindowRequest([1])).toBeNull();
  });

  it("adres giriş belgesinden: eski hash atılır, sabit TV yolu eklenir", () => {
    expect(tvWindowUrl(`${ENTRY}#/baska?x=1`)).toBe(`${ENTRY}#/tezgah-tv?pencere=ayri`);
    expect(isTvWindowHash("#/tezgah-tv?pencere=ayri")).toBe(true);
    expect(isTvWindowHash("#/tezgah-tv")).toBe(false);
    expect(isTvWindowHash("#/baska?pencere=ayri")).toBe(false);
  });

  it("ekran: istenen varsa o, yoksa birincil olmayan, tek ekranda birincil", () => {
    const ds = [{ id: 1 }, { id: 2 }];
    expect(pickTvDisplay(ds, 1, 1)?.id).toBe(1);
    expect(pickTvDisplay(ds, 1, null)?.id).toBe(2);
    expect(pickTvDisplay(ds, 1, 99)?.id).toBe(2);
    expect(pickTvDisplay([{ id: 1 }], 1, null)?.id).toBe(1);
  });
});

describe("tv-window:open (ana süreç)", () => {
  it("⭐ yalnız uygulama belgesinin TV yolu açılır, ikinci ekranda, aynı preload/sandbox ile", async () => {
    const res = await open({ displayId: null });
    expect(res).toEqual({ ok: true, reused: false, displayId: 2 });
    expect(h.windows).toHaveLength(1);
    const w = h.windows[0]!;
    expect(w.loaded).toEqual([`${ENTRY}#/tezgah-tv?pencere=ayri`]);
    expect(w.opts).toMatchObject({ x: 1920, frame: true });
    expect(w.opts.webPreferences).toMatchObject({ preload: "/p.cjs", additionalArguments: ["--x"], sandbox: true, contextIsolation: true, nodeIntegration: false });
  });

  it("⭐ NEGATİF: keyfi URL ya da ek alan → pencere açılmaz", async () => {
    expect(await open("https://saldirgan.example/")).toMatchObject({ ok: false });
    expect(await open({ displayId: 2, url: "https://saldirgan.example/" })).toMatchObject({ ok: false });
    expect(h.windows).toHaveLength(0);
  });

  it("⭐ tek pencere: ikinci istek yeni pencere açmaz, var olanı öne getirir", async () => {
    await open({ displayId: null });
    const again = await open({ displayId: null });
    expect(again).toMatchObject({ ok: true, reused: true });
    expect(h.windows).toHaveLength(1);
    expect(h.windows[0]!.focused).toBe(1);
  });

  it("kapanış: kullanıcı kapatınca byUser true; uygulamayla kapanınca false; sonra yeniden açılabilir", async () => {
    await open({ displayId: null });
    h.windows[0]!.close();
    expect(sent.at(-1)).toEqual(["tv-window:closed", { byUser: true }]);
    await open({ displayId: null });
    expect(h.windows).toHaveLength(2);
    tv.closeTvWindowWithApp();
    expect(sent.at(-1)).toEqual(["tv-window:closed", { byUser: false }]);
  });

  it("yabancı belge kanalı kullanamaz (gönderen denetimi)", () => {
    const foreign = { senderFrame: { url: "file://saldirgan/pay/index.html", parent: null } };
    expect(() => h.handles.get("tv-window:open")!(foreign, { displayId: null })).toThrow();
    expect(h.windows).toHaveLength(0);
  });
});
