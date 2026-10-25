import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  overlayIconKey,
  parseBildirimNotifyRequest,
  parseBildirimOpenEvent,
  parseBildirimRozetRequest,
} from "@shared/bildirim-notify";

// =============================================================================
// BİLDİRİM — genel OS bildirimi + rozet IPC'si (N3). İddia: yük yalnız beyanlı şekil (dış adres / ek alan
// RED); pencere öndeyken OS bildirimi YOK; tıklama İSTEYEN pencereyi öne getirir, renderer'a yalnız
// `{bildirimId, yol}` gider; rozet 0/5/12 → overlay yok/"5"/"9+" (Windows), macOS/Linux setBadgeCount;
// alarm → flashFrame(true) bir kez, kapanınca false; eski alarm kanalı aynı sunucuyla çalışır.
// =============================================================================

type Listener = (...args: unknown[]) => unknown;
const h = vi.hoisted(() => {
  const shown: FakeNotification[] = [];
  class FakeNotification {
    static supported = true;
    static isSupported = () => FakeNotification.supported;
    opts: Record<string, unknown>;
    handlers = new Map<string, Listener>();
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
    }
    on(ev: string, fn: Listener) {
      this.handlers.set(ev, fn);
      return this;
    }
    show() {
      shown.push(this);
    }
    click() {
      this.handlers.get("click")?.();
    }
  }
  const win = {
    focused: true,
    minimized: false,
    visible: true,
    destroyed: false,
    calls: [] as string[],
    sent: [] as unknown[][],
    overlay: [] as unknown[][],
    flash: [] as boolean[],
    isFocused: () => win.focused,
    isMinimized: () => win.minimized,
    isVisible: () => win.visible,
    isDestroyed: () => win.destroyed,
    restore: () => win.calls.push("restore"),
    show: () => win.calls.push("show"),
    focus: () => win.calls.push("focus"),
    setOverlayIcon: (img: unknown, desc: string) => win.overlay.push([img, desc]),
    flashFrame: (on: boolean) => win.flash.push(on),
    webContents: { send: (...a: unknown[]) => win.sent.push(a) },
  };
  const badge: number[] = [];
  const paths: string[] = [];
  return { shown, FakeNotification, win, badge, paths, handles: new Map<string, Listener>() };
});

vi.mock("electron", () => ({
  Notification: h.FakeNotification,
  BrowserWindow: { fromWebContents: () => h.win },
  ipcMain: { handle: (ch: string, fn: Listener) => h.handles.set(ch, fn), on: vi.fn() },
  app: { setBadgeCount: (n: number) => h.badge.push(n) },
  nativeImage: {
    createFromPath: (p: string) => {
      h.paths.push(p);
      return { isEmpty: () => false, path: p };
    },
  },
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const ENTRY = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
const trusted = await import("../../electron/security/trusted-ipc");
const ipc = await import("../../electron/ipc/bildirim-notify.ipc");
const loom = await import("../../electron/ipc/loom-alarm-notify.ipc");
trusted.setTrustedAppEntry(ENTRY);
ipc.registerBildirimNotifyIpc({ overlayDir: "/res/overlay" });
loom.registerLoomAlarmNotifyIpc();

const ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";
const REQ = {
  kind: "siparis.patron-siparisi",
  baslik: "Patron siparişi geldi",
  govde: "Ali Tekstil · 3 kalem",
  yol: "/operations/orders?focus=o1",
  klass: "BILDIRIM",
  bildirimId: ID,
};
const appEvent = { senderFrame: { url: `${ENTRY}#/x`, parent: null }, sender: {} };
const notify = (req: unknown, ev: unknown = appEvent) => h.handles.get("bildirim:notify")!(ev, req);
const rozet = (req: unknown) => h.handles.get("bildirim:rozet")!(appEvent, req);

beforeEach(() => {
  h.shown.length = 0;
  Object.assign(h.win, { focused: false, minimized: false, visible: true, destroyed: false });
  for (const a of [h.win.calls, h.win.sent, h.win.overlay, h.win.flash, h.badge, h.paths]) a.length = 0;
  h.FakeNotification.supported = true;
});

describe("sözleşme", () => {
  it("yalnız beyanlı şekil geçer; govde isteğe bağlı", () => {
    expect(parseBildirimNotifyRequest(REQ)).toEqual(REQ);
    const { govde: _g, ...govdesiz } = REQ;
    expect(parseBildirimNotifyRequest(govdesiz)).toEqual(govdesiz);
  });
  it.each([
    ["ek alan", { ...REQ, url: "https://x" }],
    ["dış adres", { ...REQ, yol: "https://saldirgan.example/" }],
    ["protokol-göreli", { ...REQ, yol: "//saldirgan.example/x" }],
    ["üst dizin", { ...REQ, yol: "/a/../../etc" }],
    ["ters eğik", { ...REQ, yol: "/\\saldirgan" }],
    ["javascript:", { ...REQ, yol: "javascript:alert(1)" }],
    ["uuid olmayan kimlik", { ...REQ, bildirimId: "1" }],
    ["bilinmeyen sınıf", { ...REQ, klass: "ETKINLIK" }],
    ["boş başlık", { ...REQ, baslik: "  " }],
    ["uzun gövde", { ...REQ, govde: "x".repeat(301) }],
    ["bozuk tür", { ...REQ, kind: "Siparis/../x" }],
  ])("RED: %s", (_ad, raw) => {
    expect(parseBildirimNotifyRequest(raw)).toBeNull();
  });
  it("açma olayı ve rozet isteği sıkı doğrulanır", () => {
    expect(parseBildirimOpenEvent({ bildirimId: ID, yol: "/notifications" })).toEqual({ bildirimId: ID, yol: "/notifications" });
    expect(parseBildirimOpenEvent({ bildirimId: ID, yol: "https://x" })).toBeNull();
    expect(parseBildirimRozetRequest({ okunmamis: 3, alarm: false })).toEqual({ okunmamis: 3, alarm: false });
    expect(parseBildirimRozetRequest({ okunmamis: -1, alarm: false })).toBeNull();
    expect(parseBildirimRozetRequest({ okunmamis: 1.5, alarm: false })).toBeNull();
    expect(parseBildirimRozetRequest({ okunmamis: 1, alarm: "evet" })).toBeNull();
  });
  it("overlay anahtarı: 0 → yok, 5 → '5', 12 → '9+'", () => {
    expect([overlayIconKey(0), overlayIconKey(5), overlayIconKey(9), overlayIconKey(12)]).toEqual([null, "5", "9", "9+"]);
  });
});

describe("OS bildirimi", () => {
  it("pencere öndeyken gösterilmez (renderer tost gösterir)", () => {
    h.win.focused = true;
    expect(notify(REQ)).toEqual({ shown: false, reason: "focused" });
    expect(h.shown).toHaveLength(0);
  });
  it("arkadayken sessiz bildirim; tıklama pencereyi öne getirir ve yalnız {bildirimId, yol} yollar", () => {
    h.win.minimized = true;
    expect(notify(REQ)).toEqual({ shown: true });
    expect(h.shown[0]!.opts).toEqual({ title: REQ.baslik, body: REQ.govde, silent: true });
    h.shown[0]!.click();
    expect(h.win.calls).toEqual(["restore", "show", "focus"]);
    expect(h.win.sent).toEqual([["bildirim:open", { bildirimId: ID, yol: REQ.yol }]]);
  });
  it("geçersiz istek → invalid, desteklenmiyor → unsupported", () => {
    expect(notify({ ...REQ, yol: "https://x" })).toEqual({ shown: false, reason: "invalid" });
    h.FakeNotification.supported = false;
    expect(notify(REQ)).toEqual({ shown: false, reason: "unsupported" });
  });
  it("yabancı belge kanalı çağıramaz (handleTrusted)", () => {
    const foreign = { senderFrame: { url: "https://saldirgan.example/", parent: null }, sender: {} };
    expect(() => notify(REQ, foreign)).toThrow(trusted.UNTRUSTED_SENDER_ERROR);
  });
  it("eski alarm kanalı aynı sunucuyla çalışır: yalnız alarm kimliği döner", () => {
    h.win.focused = false;
    const r = h.handles.get("loom-alarm:notify")!(appEvent, { alarmId: ID, title: "Yeni tezgah alarmı", body: "Hol A" });
    expect(r).toEqual({ shown: true });
    h.shown[0]!.click();
    expect(h.win.sent).toEqual([["loom-alarm:open", { alarmId: ID }]]);
  });
});

describe("rozet", () => {
  it("Windows: 0/5/12 → overlay yok / 5.png / 9plus.png + açıklama", () => {
    for (const n of [5, 12, 0]) ipc.applyBildirimBadge({ sender: {} } as never, { okunmamis: n, alarm: false }, "win32");
    expect(h.win.overlay.map(([img, d]) => [(img as { path?: string } | null)?.path ?? null, d])).toEqual([
      ["/res/overlay/5.png", "5 okunmamış bildirim"],
      ["/res/overlay/9plus.png", "12 okunmamış bildirim"],
      [null, ""],
    ]);
    expect(h.badge).toEqual([]);
  });
  it("macOS/Linux: setBadgeCount, overlay yok", () => {
    ipc.applyBildirimBadge({ sender: {} } as never, { okunmamis: 7, alarm: false }, "darwin");
    ipc.applyBildirimBadge({ sender: {} } as never, { okunmamis: 0, alarm: false }, "linux");
    expect(h.badge).toEqual([7, 0]);
    expect(h.win.overlay).toEqual([]);
  });
  it("alarm → flashFrame(true) bir kez; alarm kapanınca false", () => {
    expect(rozet({ okunmamis: 2, alarm: true })).toBe(true);
    rozet({ okunmamis: 3, alarm: true });
    rozet({ okunmamis: 3, alarm: false });
    rozet({ okunmamis: 1, alarm: false });
    expect(h.win.flash).toEqual([true, false]);
  });
  it("bozuk istek reddedilir, hiçbir şey çağrılmaz", () => {
    expect(rozet({ okunmamis: "5", alarm: false })).toBe(false);
    expect(h.badge).toEqual([]);
    expect(h.win.overlay).toEqual([]);
  });
});
