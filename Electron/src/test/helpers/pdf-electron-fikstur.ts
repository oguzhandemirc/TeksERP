import { vi } from "vitest";

// Sahte Electron (pencere/oturum/ipc/diyalog) — pdf-window-hardening + pdf-preview-hardening ortak düzeneği.
// `vi.mock("electron", async () => (await import("./helpers/pdf-electron-fikstur")).electronFake())`.

export type Listener = (...args: unknown[]) => unknown;
export interface WindowRecord {
  options: { show?: boolean; webPreferences?: Record<string, unknown> };
  listeners: Map<string, Listener[]>;
  openHandler: Listener | null;
  loaded: string | null;
  served: string | null;
  destroyed: boolean;
}
export interface SessionRecord {
  request: Listener | null;
  check: Listener | null;
  beforeRequest: Listener | null;
  protocol: { scheme: string; fn: Listener } | null;
  cleared?: number;
}

export const h = {
  windows: [] as WindowRecord[],
  sessions: new Map<string, SessionRecord>(),
  handlers: new Map<string, Listener>(),
  openExternal: vi.fn(),
  printFails: false,
  printHangs: false,
  hangOn: null as string | null,
  printLog: [] as string[],
  aliveAtPrint: [] as number[],
  dialogSave: null as null | ((opts: unknown) => unknown),
  dialogOpen: null as null | (() => unknown),
};

export function electronFake() {
  class FakeBrowserWindow {
    static fromWebContents = (): null => null;
    readonly webContents: Record<string, unknown>;
    private readonly rec: WindowRecord;
    constructor(options: WindowRecord["options"]) {
      const rec: WindowRecord = { options, listeners: new Map(), openHandler: null, loaded: null, served: null, destroyed: false };
      h.windows.push(rec);
      this.rec = rec;
      this.webContents = {
        on: (event: string, fn: Listener) => rec.listeners.set(event, [...(rec.listeners.get(event) ?? []), fn]),
        setWindowOpenHandler: (fn: Listener) => {
          rec.openHandler = fn;
        },
        printToPDF: async () => {
          if (h.printFails) throw new Error("yazdırılamadı");
          if (h.printHangs || (h.hangOn !== null && rec.served === h.hangOn)) return new Promise(() => undefined);
          h.printLog.push(rec.served ?? "");
          h.aliveAtPrint.push(h.windows.filter((w) => !w.destroyed).length);
          return new Uint8Array([1, 2, 3]);
        },
      };
    }
    async loadURL(url: string): Promise<void> {
      this.rec.loaded = url;
      const proto = h.sessions.get("tekserp-pdf")?.protocol;
      if (proto && url.startsWith(`${proto.scheme}:`)) {
        const res = (await proto.fn({ url })) as Response;
        this.rec.served = res.status === 200 ? await res.text() : null;
      }
    }
    destroy(): void {
      this.rec.destroyed = true;
    }
    on(event: string, fn: Listener): void {
      this.rec.listeners.set(`win:${event}`, [...(this.rec.listeners.get(`win:${event}`) ?? []), fn]);
    }
  }
  const fromPartition = (name: string) => {
    const rec: SessionRecord = h.sessions.get(name) ?? { request: null, check: null, beforeRequest: null, protocol: null };
    h.sessions.set(name, rec);
    return {
      setPermissionRequestHandler: (fn: Listener) => (rec.request = fn),
      setPermissionCheckHandler: (fn: Listener) => (rec.check = fn),
      webRequest: { onBeforeRequest: (fn: Listener) => (rec.beforeRequest = fn) },
      protocol: { handle: (scheme: string, fn: Listener) => (rec.protocol = { scheme, fn }) },
      clearCache: async () => void (rec.cleared = (rec.cleared ?? 0) + 1),
      clearStorageData: async () => void (rec.cleared = (rec.cleared ?? 0) + 1),
    };
  };
  return {
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition },
    ipcMain: { handle: (ch: string, fn: Listener) => h.handlers.set(ch, fn), on: vi.fn() },
    dialog: { showSaveDialog: vi.fn(async (...args: unknown[]) => h.dialogSave?.(args.at(-1)) ?? { canceled: true }), showOpenDialog: vi.fn(async () => h.dialogOpen?.() ?? { canceled: true }) },
    shell: { openExternal: h.openExternal },
  };
}
