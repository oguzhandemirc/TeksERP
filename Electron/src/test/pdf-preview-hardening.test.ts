import { describe, expect, it, vi } from "vitest";

// =============================================================================
// BELGE TASARIMCISI PDF ÖNİZLEMESİ (T4): `pdf:preview` çizimi pdf:save ile AYNI kapıdan
// (bayt sınırı, kuyruk, JS'siz köprüsüz gizli pencere) geçer; görüntüleyici ayrı pencerede,
// köprüsüz/Node'suz, ayrık `persist:` oturumunda (bellek içinde eklenti çizmiyor); geçici dosya pencere kapanınca silinir.
// =============================================================================
vi.mock("electron", async () => (await import("./helpers/pdf-electron-fikstur")).electronFake());
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { h } = await import("./helpers/pdf-electron-fikstur");
const pdf = await import("../../electron/ipc/pdf.ipc");
const viewer = await import("../../electron/ipc/pdf-viewer");
const trusted = await import("../../electron/security/trusted-ipc");
const limits = await import("../../shared/pdf-limits");
const ENTRY = "file:///Applications/TeksERP.app/Contents/Resources/app.asar/out/renderer/index.html";
const fromApp = () => ({ senderFrame: { url: `${ENTRY}#/rapor`, parent: null }, sender: {} });
const EVIL_HTML = `<meta http-equiv="refresh" content="0;url=file://saldirgan/pay/x.html"><script>location="ms-msdt:/id x"</script><p>Belge</p>`;
const fakeNavEvent = (url: string) => ({ url, isMainFrame: true, preventDefault: vi.fn() });
const { existsSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");

describe("PDF önizleme (pdf:preview) — aynı çizim kapısı + sertleştirilmiş görüntüleyici", () => {
  it("⭐ 6 MB üstü HTML: pencere açılmaz, pdf:save ile aynı sabit metin", async () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const before = h.windows.length;
    const big = "<p>" + "ğ".repeat(limits.PDF_MAX_HTML_BYTES / 2 + 10) + "</p>";
    const res = (await h.handlers.get("pdf:preview")?.(fromApp(), { html: big, title: "x" })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Belge PDF için çok büyük/);
    expect(h.windows.length).toBe(before);
  });

  it("⭐ yabancı belgeden gelen pdf:preview reddedilir", () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const fromShare = { senderFrame: { url: "file://saldirgan/pay/index.html", parent: null }, sender: {} };
    expect(() => h.handlers.get("pdf:preview")?.(fromShare, { html: "<p>x</p>", title: "x" })).toThrow(trusted.UNTRUSTED_SENDER_ERROR);
  });

  it("⭐ çizim pdf:save'in JS'siz penceresinde; görüntüleyici köprüsüz, Node'suz, ayrık oturumda; baytlar döner", async () => {
    pdf.registerPdfIpc();
    trusted.setTrustedAppEntry(ENTRY);
    const before = h.windows.length;
    const res = (await h.handlers.get("pdf:preview")?.(fromApp(), { html: EVIL_HTML, title: "Önizleme" })) as { ok: boolean; bytes: Uint8Array; viewer: boolean };
    expect(res.ok).toBe(true);
    expect([...res.bytes]).toEqual([1, 2, 3]);
    expect(res.viewer).toBe(true);
    const [draw, view] = h.windows.slice(before);
    expect(draw!.options).toEqual(pdf.PDF_WINDOW_OPTIONS);
    expect(draw!.destroyed).toBe(true);
    const wp = view!.options.webPreferences!;
    expect(wp.preload).toBeUndefined();
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.nodeIntegrationInSubFrames).toBe(false);
    expect(wp.sandbox).toBe(true);
    expect(wp.contextIsolation).toBe(true);
    expect(wp.webviewTag).toBe(false);
    expect(wp.plugins).toBe(true);
    expect(wp.partition).toBe(viewer.PDF_VIEWER_PARTITION);
    // Bellek içi oturumda PDF eklentisi çizmiyor → persist: ZORUNLU; ana/çizim oturumundan ayrı.
    expect(String(wp.partition).startsWith("persist:")).toBe(true);
    expect(wp.partition).not.toBe(pdf.PDF_PARTITION);
    expect(view!.loaded).toMatch(/^file:\/\/.*tekserp-onizleme-[0-9a-f-]+\.pdf$/);
    // Gezinme / yeni pencere: engelli; yalnız görüntüleyici eklenti çerçevesi geçer.
    const nav = fakeNavEvent("https://saldirgan.example/x");
    for (const fn of view!.listeners.get("will-navigate") ?? []) fn(nav);
    expect(nav.preventDefault).toHaveBeenCalled();
    const frameBad = fakeNavEvent("file:///etc/passwd");
    const frameOk = fakeNavEvent("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html");
    for (const fn of view!.listeners.get("will-frame-navigate") ?? []) {
      fn(frameBad);
      fn(frameOk);
    }
    expect(frameBad.preventDefault).toHaveBeenCalled();
    expect(frameOk.preventDefault).not.toHaveBeenCalled();
    expect(view!.openHandler?.()).toEqual({ action: "deny" });
    // Ağ: yalnız kendi geçici dosyası + görüntüleyici kaynakları.
    const ses = h.sessions.get(viewer.PDF_VIEWER_PARTITION)!;
    const ask = (url: string) => {
      let r: unknown;
      ses.beforeRequest?.({ url }, (x: unknown) => (r = x));
      return r;
    };
    expect(ask(view!.loaded!)).toEqual({ cancel: false });
    expect(ask("https://saldirgan.example/a.png")).toEqual({ cancel: true });
    expect(ask("file:///Users/kurban/belge.pdf")).toEqual({ cancel: true });
    // Pencere kapanınca geçici dosya silinir ve izin listesinden düşer.
    const file = fileURLToPath(view!.loaded!);
    expect(existsSync(file)).toBe(true);
    for (const fn of view!.listeners.get("win:closed") ?? []) fn();
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(file)).toBe(false);
    expect(ses.cleared).toBe(2);
    expect(ask(view!.loaded!)).toEqual({ cancel: true });
  });
});
