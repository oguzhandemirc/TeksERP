import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE_URL_STORE_KEY,
  AUTH_TOKEN_STORE_KEY,
  DOWNLOAD_TOKEN_HEADER,
  downloadTokenUrl,
  feedOptions,
  fetchDownloadToken,
} from "@shared/download-token";
import { DEFAULT_UPDATE_FEED_URL, GROUP_FLOW, groupFeedUrl } from "@shared/update-feed";

// İNDİRME BELİRTECİ (3b) — panel her güncelleme denetiminden önce fabrikanın backend'inden belirteç
// alır ve electron-updater'a başlık verir; alınamazsa BAŞLIKSIZ (bugünkü davranış). Main süreç
// işleyicisi gerçek modülüyle, electron/electron-updater sahteleriyle koşar.
const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  fetchMock: vi.fn(),
  store: new Map<string, string>(),
  updater: {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => null),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    logger: null as unknown,
    autoDownload: false,
    autoInstallOnAppQuit: true,
  },
}));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "9.9.9" },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => h.handlers.set(ch, fn), on: vi.fn() },
  net: { fetch: (...a: unknown[]) => h.fetchMock(...a) },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: h.updater } }));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../electron/ipc/secure-store.ipc.js", () => ({
  readSecureValue: (k: string) => h.store.get(k) ?? null,
  writeSecureValue: (k: string, v: string) => h.store.set(k, v),
  deleteSecureValue: (k: string) => h.store.delete(k),
}));

const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJ2IjoxfQ.c2lnbmF0dXJl";
const ok = (belirtec: unknown, grup?: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data: { belirtec, ...(grup === undefined ? {} : { grup }) } }) }) as unknown as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({ success: false }) }) as unknown as Response;

describe("indirme belirteci (saf)", () => {
  it("uç adresi renderer gibi taban + yol; http(s) olmayan taban → null", () => {
    expect(downloadTokenUrl("http://10.0.0.5:4000/")).toBe("http://10.0.0.5:4000/api/license/indirme-belirteci?urun=electron");
    expect(downloadTokenUrl("https://erp.example/fabrika")).toBe("https://erp.example/fabrika/api/license/indirme-belirteci?urun=electron");
    expect(downloadTokenUrl(null)).toBeNull();
    expect(downloadTokenUrl("file:///etc/passwd")).toBeNull();
  });

  it("oturumla alınır; Bearer + yönlendirme yok", async () => {
    const f = vi.fn(async () => ok(TOKEN));
    await expect(fetchDownloadToken({ apiBaseUrl: "http://s:4000", authToken: "jwt", fetchImpl: f })).resolves.toEqual({ belirtec: TOKEN, grup: null });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://s:4000/api/license/indirme-belirteci?urun=electron");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(init.redirect).toBe("error");
  });

  it("oturum/adres yok, 403 K1, 404, biçimsiz yanıt, ağ hatası, zaman aşımı → null (başlıksız denetim)", async () => {
    const f = vi.fn(async () => ok(TOKEN));
    expect(await fetchDownloadToken({ apiBaseUrl: "http://s", authToken: null, fetchImpl: f })).toBeNull();
    expect(await fetchDownloadToken({ apiBaseUrl: null, authToken: "jwt", fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    for (const r of [fail(403), fail(404), ok(42), ok("boşluklu belirteç"), ok(`${"a".repeat(9000)}.b.c`)]) {
      expect(await fetchDownloadToken({ apiBaseUrl: "http://s", authToken: "jwt", fetchImpl: async () => r })).toBeNull();
    }
    expect(await fetchDownloadToken({ apiBaseUrl: "http://s", authToken: "jwt", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } })).toBeNull();
    const asili = (_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("abort"))));
    expect(await fetchDownloadToken({ apiBaseUrl: "http://s", authToken: "jwt", fetchImpl: asili, timeoutMs: 10 })).toBeNull();
  });

  it("⭐ grup (O3) yanıttan: biçimli değer geçer, biçimsiz/eksik → null; grup belirteçsiz izin doğurmaz", async () => {
    const al = (r: Response) => fetchDownloadToken({ apiBaseUrl: "http://s", authToken: "jwt", fetchImpl: async () => r });
    expect(await al(ok(TOKEN, "oncu"))).toEqual({ belirtec: TOKEN, grup: "oncu" });
    for (const kotu of [null, 7, "", "Test", "../genel", "a".repeat(41), "test/electron"]) {
      expect(await al(ok(TOKEN, kotu)), String(kotu)).toEqual({ belirtec: TOKEN, grup: null });
    }
    expect(await al(ok(null, "test"))).toBeNull();
  });

  it("feed seçenekleri: belirteç varsa başlık, yoksa bugünkü gibi başlıksız", () => {
    expect(feedOptions(DEFAULT_UPDATE_FEED_URL, TOKEN)).toEqual({ provider: "generic", url: DEFAULT_UPDATE_FEED_URL, requestHeaders: { [DOWNLOAD_TOKEN_HEADER]: TOKEN } });
    expect(feedOptions(DEFAULT_UPDATE_FEED_URL, null)).toEqual({ provider: "generic", url: DEFAULT_UPDATE_FEED_URL });
    expect(DOWNLOAD_TOKEN_HEADER).toBe("X-TKL-Indirme");
  });

  it("belirteç YALNIZ izinli güncelleme adresine: yabancı ana makine / http / yanlış yol → başlıksız (SIR-5)", () => {
    for (const url of ["https://g/k/electron/", DEFAULT_UPDATE_FEED_URL.replace("https:", "http:"), new URL("/x/", DEFAULT_UPDATE_FEED_URL).toString()]) {
      expect(feedOptions(url, TOKEN), url).toEqual({ provider: "generic", url });
    }
  });

  it("ayna: secure-store anahtarları renderer'ınkiyle aynı", () => {
    const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
    expect(src("secure-token.ts")).toContain(`const TOKEN_KEY = "${AUTH_TOKEN_STORE_KEY}";`);
    expect(src("api-config.ts")).toContain(`const STORE_KEY = "${API_BASE_URL_STORE_KEY}";`);
  });
});

describe("updater.ipc — her denetimde belirteç", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.store.clear();
    h.fetchMock.mockReset();
    h.updater.setFeedURL.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("oturum varken denetim başlıklı (ortak: kiradaki grubun adresine), belirteç alınamayınca eski kanal başlıksız, ortak denetimsiz", async () => {
    const { registerUpdaterIpc } = await import("../../electron/ipc/updater.ipc");
    const { setTrustedAppEntry } = await import("../../electron/security/trusted-ipc");
    const giris = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
    setTrustedAppEntry(giris);
    const uygulama = { senderFrame: { url: giris, parent: null } };
    h.store.set(API_BASE_URL_STORE_KEY, "http://10.0.0.5:4000");
    h.store.set(AUTH_TOKEN_STORE_KEY, "jwt");
    h.fetchMock.mockResolvedValue(ok(TOKEN, "genel"));
    registerUpdaterIpc();
    const check = () => h.handlers.get("updater:check")!(uygulama);
    await check();
    const son = () => h.updater.setFeedURL.mock.calls.at(-1)?.[0] as { url: string; requestHeaders?: Record<string, string> };
    expect(son().requestHeaders).toEqual({ [DOWNLOAD_TOKEN_HEADER]: TOKEN });
    expect(son().url).toBe(GROUP_FLOW ? groupFeedUrl("genel") : DEFAULT_UPDATE_FEED_URL);
    expect(h.fetchMock).toHaveBeenCalledWith("http://10.0.0.5:4000/api/license/indirme-belirteci?urun=electron", expect.anything());

    h.fetchMock.mockResolvedValue(fail(403));
    const once = h.updater.setFeedURL.mock.calls.length;
    await check();
    if (GROUP_FLOW) expect(h.updater.setFeedURL.mock.calls.length, "grup yok → feed kurulmaz").toBe(once);
    else expect(son().requestHeaders).toBeUndefined();
  });
});
