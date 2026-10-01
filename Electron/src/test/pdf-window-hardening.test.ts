import { describe, expect, it, vi } from "vitest";

// =============================================================================
// "PDF KAYDET" PENCERESİ (güvenlik denetimi 2026-10-01, IST-3 YÜKSEK).
// İddia: belge HTML'i (kullanıcı yazımı uzman şablonu dahil) PDF'e çevrilirken
// JS KAPALI, köprüsüz, ağsız, gezinmesiz bir pencerede çizilir ve bu pencere
// işletim sistemine HİÇBİR adres devretmez. Gerçek `pdf.ipc.ts` modülü, electron
// sahteleriyle koşar (pencere seçenekleri ve takılan işleyiciler ÖLÇÜLÜR).
// Negatif sonda (B): düzeltme geri alınınca (eski htmlToPdf) bu dosya kırmızı —
// commit mesajında sayısıyla.
// =============================================================================

type Listener = (...args: unknown[]) => unknown;
interface WindowRecord {
  options: { show?: boolean; webPreferences?: Record<string, unknown> };
  listeners: Map<string, Listener[]>;
  openHandler: Listener | null;
  loaded: string | null;
  destroyed: boolean;
}
interface SessionRecord {
  request: Listener | null;
  check: Listener | null;
  beforeRequest: Listener | null;
}

const h = vi.hoisted(() => ({
  windows: [] as WindowRecord[],
  sessions: new Map<string, SessionRecord>(),
  handlers: new Map<string, Listener>(),
  openExternal: vi.fn(),
  printFails: false,
}));

vi.mock("electron", () => {
  class FakeBrowserWindow {
    static fromWebContents = (): null => null;
    readonly webContents: Record<string, unknown>;
    private readonly rec: WindowRecord;
    constructor(options: WindowRecord["options"]) {
      const rec: WindowRecord = { options, listeners: new Map(), openHandler: null, loaded: null, destroyed: false };
      h.windows.push(rec);
      this.rec = rec;
      this.webContents = {
        on: (event: string, fn: Listener) => rec.listeners.set(event, [...(rec.listeners.get(event) ?? []), fn]),
        setWindowOpenHandler: (fn: Listener) => {
          rec.openHandler = fn;
        },
        printToPDF: async () => {
          if (h.printFails) throw new Error("yazdırılamadı");
          return new Uint8Array([1, 2, 3]);
        },
      };
    }
    async loadURL(url: string): Promise<void> {
      this.rec.loaded = url;
    }
    destroy(): void {
      this.rec.destroyed = true;
    }
  }
  const fromPartition = (name: string) => {
    const rec: SessionRecord = h.sessions.get(name) ?? { request: null, check: null, beforeRequest: null };
    h.sessions.set(name, rec);
    return {
      setPermissionRequestHandler: (fn: Listener) => (rec.request = fn),
      setPermissionCheckHandler: (fn: Listener) => (rec.check = fn),
      webRequest: { onBeforeRequest: (fn: Listener) => (rec.beforeRequest = fn) },
    };
  };
  return {
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition },
    ipcMain: { handle: (ch: string, fn: Listener) => h.handlers.set(ch, fn), on: vi.fn() },
    dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })), showOpenDialog: vi.fn(async () => ({ canceled: true })) },
    shell: { openExternal: h.openExternal },
  };
});
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const pdf = await import("../../electron/ipc/pdf.ipc");
const trusted = await import("../../electron/security/trusted-ipc");

const ENTRY = "file:///Applications/TeksERP.app/Contents/Resources/app.asar/out/renderer/index.html";
const EVIL_HTML = `<meta http-equiv="refresh" content="0;url=file://saldirgan/pay/x.html"><script>location="ms-msdt:/id x"</script><p>Belge</p>`;

async function renderOnce(): Promise<WindowRecord> {
  await pdf.htmlToPdf(EVIL_HTML);
  const rec = h.windows.at(-1);
  if (!rec) throw new Error("pencere açılmadı");
  return rec;
}

const fakeNavEvent = (url: string) => ({ url, isMainFrame: true, preventDefault: vi.fn() });

describe("PDF penceresinin seçenekleri", () => {
  it("⭐ JS KAPALI, sandbox + bağlam yalıtımı, Node yok, köprü (preload) YOK", async () => {
    const prefs = (await renderOnce()).options.webPreferences ?? {};
    expect(prefs.javascript).toBe(false);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.nodeIntegrationInSubFrames).toBe(false);
    expect(prefs.webviewTag).toBe(false);
    expect(prefs.plugins).toBe(false);
    expect(prefs.preload).toBeUndefined();
  });

  it("ayrık, bellek içi oturum (persist: değil) ve gizli pencere", async () => {
    const rec = await renderOnce();
    expect(rec.options.show).toBe(false);
    expect(rec.options.webPreferences?.partition).toBe(pdf.PDF_PARTITION);
    expect(String(pdf.PDF_PARTITION).startsWith("persist:")).toBe(false);
  });

  it("belge data: URL olarak yüklenir ve pencere her durumda yok edilir", async () => {
    const ok = await renderOnce();
    expect(ok.loaded?.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    expect(ok.destroyed).toBe(true);
    h.printFails = true;
    await expect(pdf.htmlToPdf("<p>x</p>")).rejects.toThrow("yazdırılamadı");
    h.printFails = false;
    expect(h.windows.at(-1)?.destroyed).toBe(true);
  });
});

describe("PDF penceresinin kapıları", () => {
  it("⭐ gezinme, çerçeve gezinmesi, yönlendirme ve webview: HEPSİ engellenir", async () => {
    const rec = await renderOnce();
    for (const event of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
      const listeners = rec.listeners.get(event) ?? [];
      expect(listeners.length, event).toBeGreaterThan(0);
      const nav = fakeNavEvent("file://saldirgan/pay/x.html");
      for (const fn of listeners) fn(nav);
      expect(nav.preventDefault, event).toHaveBeenCalled();
    }
  });

  it("⭐ yeni pencere RED ve işletim sistemine hiçbir adres DEVREDİLMEZ", async () => {
    const rec = await renderOnce();
    expect(rec.openHandler?.({ url: "ms-msdt:/id PCWDiagnostic" })).toEqual({ action: "deny" });
    for (const fn of rec.listeners.get("will-navigate") ?? []) fn(fakeNavEvent("search-ms:query=x"));
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it("⭐ ağ: yalnız gömülü içerik (data:/blob:/about:); dosya, UNC ve http(s) iptal", async () => {
    await renderOnce();
    const ses = h.sessions.get(pdf.PDF_PARTITION);
    const decide = (url: string): unknown => {
      let answer: unknown;
      ses?.beforeRequest?.({ url }, (r: unknown) => (answer = r));
      return answer;
    };
    expect(decide("data:image/png;base64,AAAA")).toEqual({ cancel: false });
    for (const url of ["file://saldirgan/pay/a.png", "file:///C:/Windows/win.ini", "http://10.0.0.5/logo.png", "https://saldirgan.com/p.gif", "ws://x/"]) {
      expect(decide(url), url).toEqual({ cancel: true });
    }
  });

  it("izinler: istek ve denetim her zaman RED", async () => {
    await renderOnce();
    const ses = h.sessions.get(pdf.PDF_PARTITION);
    const granted = vi.fn();
    ses?.request?.(null, "clipboard-read", granted, { requestingUrl: "data:text/html,x" });
    expect(granted).toHaveBeenCalledWith(false);
    expect(ses?.check?.(null, "notifications", "", {})).toBe(false);
  });
});

describe("PDF IPC uçları gönderen denetimli", () => {
  it("⭐ yabancı belgeden gelen pdf:save reddedilir; uygulama belgesi geçer", async () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const save = h.handlers.get("pdf:save");
    const opts = { html: "<p>x</p>", suggestedName: "irsaliye" };
    const fromShare = { senderFrame: { url: "file://saldirgan/pay/index.html", parent: null }, sender: {} };
    expect(() => save?.(fromShare, opts)).toThrow(trusted.UNTRUSTED_SENDER_ERROR);
    const fromApp = { senderFrame: { url: `${ENTRY}#/belge`, parent: null }, sender: {} };
    await expect(Promise.resolve(save?.(fromApp, opts))).resolves.toEqual({ saved: false });
  });
});
