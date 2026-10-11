import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loomAlarmPath,
  parseLoomAlarmNotifyRequest,
  parseLoomAlarmOpenEvent,
  shouldShowOsNotification,
} from "@shared/loom-alarm-notify";

// =============================================================================
// TEZGAH ALARMI — OS bildirimi IPC'si. İddia: istek yalnız `{ alarmId: uuid, title, body }`
// (adres/ek alan RED); bildirim yalnız pencere arkadayken/simge durumundayken çıkar; tıklama
// İSTEYEN pencereyi öne getirir ve renderer'a YALNIZ alarm kimliği gider; gönderen denetimi
// diğer kanallarla aynı geçitten (`handleTrusted`).
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
    isFocused: () => win.focused,
    isMinimized: () => win.minimized,
    isVisible: () => win.visible,
    isDestroyed: () => win.destroyed,
    restore: () => win.calls.push("restore"),
    show: () => win.calls.push("show"),
    focus: () => win.calls.push("focus"),
    webContents: { send: (...a: unknown[]) => win.sent.push(a) },
  };
  return { shown, FakeNotification, win, handles: new Map<string, Listener>() };
});

vi.mock("electron", () => ({
  Notification: h.FakeNotification,
  BrowserWindow: { fromWebContents: () => h.win },
  ipcMain: { handle: (ch: string, fn: Listener) => h.handles.set(ch, fn), on: vi.fn() },
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const ENTRY = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
const trusted = await import("../../electron/security/trusted-ipc");
const ipc = await import("../../electron/ipc/loom-alarm-notify.ipc");
trusted.setTrustedAppEntry(ENTRY);
ipc.registerLoomAlarmNotifyIpc();

const ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";
const REQ = { alarmId: ID, title: "Yeni tezgah alarmı: TZ-12 · İp atlama", body: "Hol A · 23 dk duruyor (hedef 10 dk)" };
const appEvent = { senderFrame: { url: `${ENTRY}#/x`, parent: null }, sender: {} };
const notify = (req: unknown, ev: unknown = appEvent) => h.handles.get("loom-alarm:notify")!(ev, req) as ReturnType<typeof ipc.showLoomAlarmNotification>;

beforeEach(() => {
  h.shown.length = 0;
  Object.assign(h.win, { focused: false, minimized: false, visible: true, destroyed: false });
  h.win.calls.length = 0;
  h.win.sent.length = 0;
  h.FakeNotification.supported = true;
});

describe("sözleşme (saf)", () => {
  it("geçerli istek geçer", () => {
    expect(parseLoomAlarmNotifyRequest(REQ)).toEqual(REQ);
  });

  it("⭐ NEGATİF: adres alanı, ek alan, uuid olmayan kimlik, boş/uzun metin → RED", () => {
    expect(parseLoomAlarmNotifyRequest({ ...REQ, url: "https://saldirgan.example/" })).toBeNull();
    expect(parseLoomAlarmNotifyRequest({ ...REQ, path: "/system/users" })).toBeNull();
    expect(parseLoomAlarmNotifyRequest({ ...REQ, alarmId: "https://saldirgan.example/" })).toBeNull();
    expect(parseLoomAlarmNotifyRequest({ ...REQ, alarmId: `${ID}/../../system` })).toBeNull();
    expect(parseLoomAlarmNotifyRequest({ alarmId: ID, title: REQ.title })).toBeNull();
    expect(parseLoomAlarmNotifyRequest({ ...REQ, title: "  " })).toBeNull();
    expect(parseLoomAlarmNotifyRequest({ ...REQ, body: "x".repeat(301) })).toBeNull();
    expect(parseLoomAlarmNotifyRequest("https://saldirgan.example/")).toBeNull();
    expect(parseLoomAlarmNotifyRequest([REQ])).toBeNull();
  });

  it("⭐ açma olayı yalnız `{ alarmId: uuid }`; yol yalnız doğrulanmış kimlikten", () => {
    expect(parseLoomAlarmOpenEvent({ alarmId: ID })).toBe(ID);
    expect(parseLoomAlarmOpenEvent({ alarmId: ID, url: "https://x" })).toBeNull();
    expect(parseLoomAlarmOpenEvent({ alarmId: "../system" })).toBeNull();
    expect(parseLoomAlarmOpenEvent(ID)).toBeNull();
    expect(loomAlarmPath(ID)).toBe(`/operations/loom-alarms/${ID}`);
    expect(loomAlarmPath("https://saldirgan.example/")).toBeNull();
  });

  it("bildirim yalnız pencere arkadayken / simge durumundayken / gizliyken", () => {
    expect(shouldShowOsNotification({ focused: true, minimized: false, visible: true })).toBe(false);
    expect(shouldShowOsNotification({ focused: false, minimized: false, visible: true })).toBe(true);
    expect(shouldShowOsNotification({ focused: true, minimized: true, visible: true })).toBe(true);
    expect(shouldShowOsNotification({ focused: true, minimized: false, visible: false })).toBe(true);
  });
});

describe("loom-alarm:notify (ana süreç)", () => {
  it("⭐ pencere öndeyken bildirim çıkmaz", () => {
    h.win.focused = true;
    expect(notify(REQ)).toEqual({ shown: false, reason: "focused" });
    expect(h.shown).toHaveLength(0);
  });

  it("⭐ pencere arkadayken sessiz bildirim; tıklayınca pencere öne gelir, renderer'a YALNIZ kimlik gider", () => {
    h.win.minimized = true;
    expect(notify(REQ)).toEqual({ shown: true });
    expect(h.shown).toHaveLength(1);
    const n = h.shown[0]!;
    expect(n.opts).toEqual({ title: REQ.title, body: REQ.body, silent: true });
    n.click();
    expect(h.win.calls).toEqual(["restore", "show", "focus"]);
    expect(h.win.sent).toEqual([["loom-alarm:open", { alarmId: ID }]]);
  });

  it("⭐ NEGATİF: keyfi URL'li istek → bildirim yok, renderer'a hiçbir şey gitmez", () => {
    expect(notify({ ...REQ, url: "https://saldirgan.example/" })).toEqual({ shown: false, reason: "invalid" });
    expect(notify({ alarmId: "https://saldirgan.example/", title: "a", body: "b" })).toEqual({ shown: false, reason: "invalid" });
    expect(h.shown).toHaveLength(0);
    expect(h.win.sent).toHaveLength(0);
  });

  it("işletim sistemi bildirimi desteklemiyorsa sessizce geçer", () => {
    h.FakeNotification.supported = false;
    expect(notify(REQ)).toEqual({ shown: false, reason: "unsupported" });
  });

  it("⭐ yabancı belgeden gelen istek gönderen geçidinde düşer", () => {
    const foreign = { senderFrame: { url: "https://saldirgan.example/", parent: null }, sender: {} };
    expect(() => notify(REQ, foreign)).toThrow(trusted.UNTRUSTED_SENDER_ERROR);
    expect(h.shown).toHaveLength(0);
  });
});
