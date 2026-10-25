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
  served: string | null;
  destroyed: boolean;
}
interface SessionRecord {
  request: Listener | null;
  check: Listener | null;
  beforeRequest: Listener | null;
  protocol: { scheme: string; fn: Listener } | null;
}

const h = vi.hoisted(() => ({
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
}));

vi.mock("electron", () => {
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
  }
  const fromPartition = (name: string) => {
    const rec: SessionRecord = h.sessions.get(name) ?? { request: null, check: null, beforeRequest: null, protocol: null };
    h.sessions.set(name, rec);
    return {
      setPermissionRequestHandler: (fn: Listener) => (rec.request = fn),
      setPermissionCheckHandler: (fn: Listener) => (rec.check = fn),
      webRequest: { onBeforeRequest: (fn: Listener) => (rec.beforeRequest = fn) },
      protocol: { handle: (scheme: string, fn: Listener) => (rec.protocol = { scheme, fn }) },
    };
  };
  return {
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition },
    ipcMain: { handle: (ch: string, fn: Listener) => h.handlers.set(ch, fn), on: vi.fn() },
    dialog: { showSaveDialog: vi.fn(async (...args: unknown[]) => h.dialogSave?.(args.at(-1)) ?? { canceled: true }), showOpenDialog: vi.fn(async () => h.dialogOpen?.() ?? { canceled: true }) },
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

  it("⭐ belge data: URL DEĞİL bellekteki şemadan yüklenir, iş bitince bellekten düşer, pencere her durumda yok edilir", async () => {
    const ok = await renderOnce();
    expect(ok.loaded?.startsWith(`${pdf.PDF_DOC_SCHEME}://doc/`)).toBe(true);
    expect(ok.loaded).not.toContain("<");
    expect(ok.served).toBe(EVIL_HTML);
    const proto = h.sessions.get(pdf.PDF_PARTITION)?.protocol;
    expect(((await proto?.fn({ url: ok.loaded })) as Response).status).toBe(404);
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
    expect(decide(`${pdf.PDF_DOC_SCHEME}://doc/0f0e`)).toEqual({ cancel: false });
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

// =============================================================================
// PERF-2 B2: bayt kapısı diyalogdan ÖNCE, hata metni URL/HTML taşımaz, tek kuyruk,
// 60 s zaman aşımı. Negatif sonda: eski htmlToPdf (data: URL, kapısız) → kırmızı.
// =============================================================================
const limits = await import("../../shared/pdf-limits");
const fromApp = () => ({ senderFrame: { url: `${ENTRY}#/rapor`, parent: null }, sender: {} });

describe("PDF boyut kapısı, hata metni, kuyruk ve zaman aşımı", () => {
  it("⭐ 6 MB üstü HTML: kaydet diyaloğu AÇILMAZ, pencere açılmaz, sabit Türkçe metin döner", async () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const asked = vi.fn(() => ({ canceled: false, filePath: "/tmp/x.pdf" }));
    h.dialogSave = asked;
    const before = h.windows.length;
    const big = "<p>" + "ğ".repeat(limits.PDF_MAX_HTML_BYTES / 2 + 10) + "</p>";
    const res = (await h.handlers.get("pdf:save")?.(fromApp(), { html: big, suggestedName: "r" })) as { saved: boolean; error: string };
    h.dialogSave = null;
    expect(res.saved).toBe(false);
    expect(res.error).toMatch(/^Belge PDF için çok büyük \(\d[\d.]* KB\) — PDF yerine Excel indirin\.$/);
    expect(asked).not.toHaveBeenCalled();
    expect(h.windows.length).toBe(before);
    await expect(pdf.htmlToPdf(big)).rejects.toBeInstanceOf(pdf.PdfUserError);
  });

  it("⭐ toplu kayıtta tek büyük belge: klasör sorulmadan reddedilir", async () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const big = "x".repeat(limits.PDF_MAX_HTML_BYTES + 1);
    const res = (await h.handlers.get("pdf:saveBatch")?.(fromApp(), { items: [{ name: "a", html: "<p>a</p>" }, { name: "b", html: big }] })) as { saved: boolean; error: string };
    expect(res).toEqual({ saved: false, error: limits.pdfTooLargeMessage(limits.PDF_MAX_HTML_BYTES + 1) });
  });

  it("⭐ Chromium hatası (URL'li) kullanıcıya YALNIZ sabit metin + kod olarak gider", () => {
    const raw = new Error(`ERR_INVALID_URL (-300) loading 'data:text/html;charset=utf-8,${"%3Ctd%3E".repeat(5000)}'`);
    const msg = pdf.pdfErrorMessage(raw, "PDF oluşturulamadı");
    expect(msg).toBe("PDF oluşturulamadı (ERR_INVALID_URL)");
    expect(pdf.pdfErrorMessage(new Error("<table> içinde bir şey"), "PDF oluşturulamadı")).toBe("PDF oluşturulamadı");
    expect(pdf.pdfErrorMessage(new pdf.PdfUserError("Belge çok büyük"), "x")).toBe("Belge çok büyük");
  });

  it("⭐ tek kuyruk: eşzamanlı istekler SIRAYLA çizilir, bir hata kuyruğu kilitlemez", async () => {
    h.printLog.length = 0;
    h.aliveAtPrint.length = 0;
    const a = pdf.htmlToPdf("<p>A</p>");
    const b = pdf.htmlToPdf("x".repeat(limits.PDF_MAX_HTML_BYTES + 1));
    const c = pdf.htmlToPdf("<p>C</p>");
    await expect(b).rejects.toBeInstanceOf(pdf.PdfUserError);
    await Promise.all([a, c]);
    expect(h.printLog).toEqual(["<p>A</p>", "<p>C</p>"]);
    // Sıranın kanıtı: her çizim anında yalnız KENDİ penceresi açık.
    expect(h.aliveAtPrint).toEqual([1, 1]);
  });

  it("⭐ 60 s zaman aşımı: takılan çizim pencereyi yok eder, sabit metin, sonraki iş yürür", async () => {
    vi.useFakeTimers();
    try {
      h.printHangs = true;
      const stuck = pdf.htmlToPdf("<p>takılır</p>");
      const next = pdf.htmlToPdf("<p>sonra</p>");
      const caught = stuck.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(300);
      h.printHangs = false;
      await vi.advanceTimersByTimeAsync(limits.PDF_TIMEOUT_MS);
      const err = await caught;
      expect(err).toBeInstanceOf(pdf.PdfUserError);
      expect((err as Error).message).toBe(limits.PDF_TIMEOUT_MESSAGE);
      expect(h.windows.find((w) => w.served === "<p>takılır</p>")?.destroyed).toBe(true);
      await vi.advanceTimersByTimeAsync(300);
      await expect(next).resolves.toBeInstanceOf(Uint8Array);
    } finally {
      vi.useRealTimers();
    }
  });
});

// =============================================================================
// PERF-2 B8: toplu PDF TEK pencere, belge başına zaman aşımı, ilerleme olayı.
// Negatif sonda: belge başına pencere açan eski döngü → "tek pencere" kırmızı.
// =============================================================================
const { mkdtemp, readdir } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const progress = await import("../../shared/pdf-progress");

function batchSender() {
  const sent: Array<[string, unknown]> = [];
  return { sent, event: { senderFrame: { url: `${ENTRY}#/is-emri`, parent: null }, sender: { send: (ch: string, p: unknown) => sent.push([ch, p]), isDestroyed: () => false } } };
}

describe("Toplu PDF: tek pencere, ilerleme, zaman aşımı", () => {
  it("⭐ N belge TEK pencerede sırayla çizilir, her biri ayrı dosya, ilerleme n/N, pencere sonunda yok edilir", async () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const dir = await mkdtemp(`${tmpdir()}/pdf-b8-`);
    h.dialogOpen = () => ({ canceled: false, filePaths: [dir] });
    h.printLog.length = 0;
    const before = h.windows.length;
    const { sent, event } = batchSender();
    const items = [{ name: "A", html: "<p>A</p>" }, { name: "A", html: "<p>B</p>" }, { name: "C", html: "<p>C</p>" }];
    const res = await h.handlers.get("pdf:saveBatch")?.(event, { items });
    h.dialogOpen = null;
    expect(res).toEqual({ saved: true, dir, count: 3 });
    expect(h.windows.length - before).toBe(1);
    expect(h.windows.at(-1)?.destroyed).toBe(true);
    expect(h.printLog).toEqual(["<p>A</p>", "<p>B</p>", "<p>C</p>"]);
    expect((await readdir(dir)).sort()).toEqual(["A (2).pdf", "A.pdf", "C.pdf"]);
    expect(sent).toEqual([1, 2, 3].map((done) => [progress.PDF_BATCH_PROGRESS_CHANNEL, { done, total: 3 }]));
  });

  it("⭐ takılan belge: 60 s sonra sabit metin, pencere yok edilir, sonraki belge çizilmez, kuyruk yürür", async () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const dir = await mkdtemp(`${tmpdir()}/pdf-b8-`);
    h.dialogOpen = () => ({ canceled: false, filePaths: [dir] });
    h.printLog.length = 0;
    const { sent, event } = batchSender();
    const items = [{ name: "a", html: "<p>a</p>" }, { name: "b", html: "<p>b</p>" }, { name: "c", html: "<p>c</p>" }];
    h.hangOn = "<p>b</p>";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const run = Promise.resolve(h.handlers.get("pdf:saveBatch")?.(event, { items }));
      // a'nın yazımı gerçek G/Ç: tur sayısıyla beklenirse yükte döngü tükenir, saat b kurulmadan ilerler, test asılır.
      for (const t0 = Date.now(); h.windows.at(-1)?.served !== "<p>b</p>"; await new Promise((r) => setImmediate(r))) {
        if (Date.now() - t0 > 4_000) throw new Error("b belgesi 4 sn içinde pencereye yüklenmedi");
      }
      await vi.advanceTimersByTimeAsync(limits.PDF_TIMEOUT_MS + 300);
      expect(await run).toEqual({ saved: false, error: limits.PDF_TIMEOUT_MESSAGE });
      expect(h.windows.at(-1)?.destroyed).toBe(true);
      expect(h.printLog).toEqual(["<p>a</p>"]);
      expect(sent).toEqual([[progress.PDF_BATCH_PROGRESS_CHANNEL, { done: 1, total: 3 }]]);
      const next = pdf.htmlToPdf("<p>sonra</p>");
      await vi.advanceTimersByTimeAsync(300);
      await expect(next).resolves.toBeInstanceOf(Uint8Array);
    } finally {
      h.hangOn = null;
      h.dialogOpen = null;
      vi.useRealTimers();
    }
    expect(await readdir(dir)).toEqual(["a.pdf"]);
  });

});
