import { createHash, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";
import type { UpdateStatus } from "@shared/ipc-contract";
import { CHANNEL_CODE } from "@shared/channel";
import { ALLOWED_UPDATE_HOST, DEFAULT_UPDATE_FEED_URL, GROUP_FLOW, UPDATE_FEED_OVERRIDE_KEY, groupFeedUrl } from "@shared/update-feed";
import { API_BASE_URL_STORE_KEY, AUTH_TOKEN_STORE_KEY, DOWNLOAD_TOKEN_HEADER } from "@shared/download-token";
import { buildReleaseDoc, signReleaseDoc } from "../../electron/guncelleme/panel-kunye.mjs";
import { withReleaseBlock } from "../../electron/guncelleme/latest-yml.mjs";

/**
 * GRUP AKIŞI (tek ortak paket, TEK-ORTAK-PAKET §3.4 / O6) — gerçek `registerUpdaterIpc`, sahte electron/electron-updater.
 * ⭐ Feed ve künyenin beklenen kanalı kiradaki GÜNCELLEME GRUBUndan (indirme belirteci yanıtı `grup`): grup değişince
 * sonraki denetim yeni gruptan, başka grubun (dinlenme grubu dahil) künyesi KUNYE_KANAL, grup yoksa denetim YOK.
 * Yalnız ortak derlemede koşar; eski kanal yolunun akışı `updater-imza-akisi.test.ts`te (iki kipte).
 */
const h = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...a: unknown[]) => unknown>>();
  return {
    listeners,
    handlers: new Map<string, (...a: unknown[]) => unknown>(),
    store: new Map<string, string>(),
    fetchMock: vi.fn(),
    anchorFile: { anahtarlar: [] as Array<{ kid: string; x: string }> },
    updater: {
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(async () => null),
      downloadUpdate: vi.fn(async () => [] as string[]),
      quitAndInstall: vi.fn(),
      on: (ev: string, fn: (...a: unknown[]) => unknown) => listeners.set(ev, [...(listeners.get(ev) ?? []), fn]),
      logger: null as unknown,
      autoDownload: true,
      autoInstallOnAppQuit: true,
    },
    emit(ev: string, ...a: unknown[]) {
      for (const fn of listeners.get(ev) ?? []) fn(...a);
    },
  };
});
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
vi.mock("../../electron/guncelleme/imza-capasi.json", () => ({ default: h.anchorFile }));

const ANAHTAR = generateKeyPairSync("ed25519");
const KID = "panel-fikstur";
const YENI = "10.0.0";
const AD = `TeksERP-${YENI}-Setup.exe`;
const GOVDE = Buffer.from("imzali kurulum ".repeat(64));
/** Kiranın grubu — dinlenme grubu DEĞİL (gömülü adresle karışmasın). */
const GRUP = "oncu";
const IZINLI = GROUP_FLOW ? groupFeedUrl(GRUP)! : DEFAULT_UPDATE_FEED_URL;
const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJ2IjoxfQ.c2lnbmF0dXJl";
const GIRIS = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
const UYGULAMA = { senderFrame: { url: `${GIRIS}#/ayarlar`, parent: null } };
const izin = (grup: string | null = GRUP) => ({ ok: true, status: 200, json: async () => ({ success: true, data: { belirtec: TOKEN, grup } }) });

function latestYml(kanal: string): string {
  const sha = createHash("sha512").update(GOVDE).digest();
  const yml = `version: ${YENI}\nfiles:\n  - url: ${AD}\n    sha512: ${sha.toString("base64")}\n    size: ${GOVDE.length}\npath: ${AD}\nsha512: ${sha.toString("base64")}\nreleaseDate: '2026-10-01T01:00:00.000Z'\n`;
  const doc = buildReleaseDoc({
    kanal,
    surum: YENI,
    commit: "0efe882d",
    yayinZamani: "2026-10-01T01:00:00.000Z",
    paket: { ad: AD, boyut: GOVDE.length, sha512: sha.toString("hex") },
    capa: [KID],
  });
  return withReleaseBlock(yml, signReleaseDoc({ doc, kid: KID, privateKey: ANAHTAR.privateKey }));
}
const bilgi = (kanal: string) =>
  parseUpdateInfo(latestYml(kanal), "latest.yml", new URL(`${IZINLI}latest.yml`)) as unknown as Record<string, unknown>;
const durum = () => h.handlers.get("updater:status")!(UYGULAMA) as UpdateStatus;
const tik = () => new Promise<void>((r) => setImmediate(r));

async function kur({ grup = GRUP as string | null } = {}) {
  vi.resetModules();
  for (const m of [h.handlers, h.listeners, h.store]) m.clear();
  h.store.set(API_BASE_URL_STORE_KEY, "http://10.0.0.5:4000");
  h.store.set(AUTH_TOKEN_STORE_KEY, "jwt");
  h.fetchMock.mockReset().mockResolvedValue(izin(grup));
  for (const f of [h.updater.setFeedURL, h.updater.checkForUpdates, h.updater.downloadUpdate]) f.mockClear();
  const m = await import("../../electron/ipc/updater.ipc");
  (await import("../../electron/security/trusted-ipc")).setTrustedAppEntry(GIRIS);
  m.registerUpdaterIpc();
  await tik();
  await tik();
}

beforeAll(() => {
  h.anchorFile.anahtarlar.push({ kid: KID, x: ANAHTAR.publicKey.export({ format: "jwk" }).x as string });
});
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] }));
afterEach(() => vi.useRealTimers());

describe.skipIf(!GROUP_FLOW)("⭐ grup akışı (ortak paket) — feed ve künye kanalı kiradaki gruptan", () => {
  const sonFeed = () => h.updater.setFeedURL.mock.calls.at(-1)?.[0] as { url: string; requestHeaders?: Record<string, string> };
  const kontrol = () => h.handlers.get("updater:check")!(UYGULAMA) as Promise<UpdateStatus>;

  it("feed = kiradaki grubun adresi (dinlenme grubu değil), başlık yalnız indirme ana makinesine", async () => {
    await kur();
    await kontrol();
    expect(sonFeed()).toEqual({ provider: "generic", url: groupFeedUrl(GRUP), requestHeaders: { [DOWNLOAD_TOKEN_HEADER]: TOKEN } });
    expect(sonFeed().url).not.toBe(DEFAULT_UPDATE_FEED_URL);
    expect(new URL(sonFeed().url).host).toBe(ALLOWED_UPDATE_HOST);
    expect(durum()).toMatchObject({ grup: GRUP, feedUrl: groupFeedUrl(GRUP), feedUrlOverridden: false });
    expect(h.updater.checkForUpdates).toHaveBeenCalled();
  });

  it("⭐ grup değişince SONRAKİ denetim yeni gruptan; eski grubun künyesi artık KUNYE_KANAL", async () => {
    await kur();
    await kontrol();
    h.fetchMock.mockResolvedValue(izin("genel"));
    await kontrol();
    expect(sonFeed().url).toBe(groupFeedUrl("genel"));
    expect(durum().grup).toBe("genel");
    h.emit("update-available", bilgi(GRUP));
    expect(durum().imzaReddi?.kod).toBe("KUNYE_KANAL");
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
    h.emit("update-available", bilgi("genel"));
    expect(durum().state).toBe("available");
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("⭐ grup yok (kira grubu değil · belirteç yok · oturum yok) → denetim YOK, durum metni; sızan künye de kabul edilmez", async () => {
    for (const hazirlik of [
      () => h.fetchMock.mockResolvedValue(izin(null)),
      () => h.fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }),
      () => h.store.delete(AUTH_TOKEN_STORE_KEY),
    ]) {
      await kur({ grup: null });
      hazirlik();
      h.updater.setFeedURL.mockClear();
      const s = await kontrol();
      expect(h.updater.setFeedURL).not.toHaveBeenCalled();
      expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
      expect(s).toMatchObject({ state: "idle", grup: null, feedUrl: "" });
      h.emit("update-available", bilgi(GRUP));
      expect(durum().imzaReddi?.kod).toBe("KUNYE_KANAL");
      expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
    }
  });

  it("dinlenme grubunun künyesi kiradaki grup başkaysa kurulmaz (gömülü adres grup değildir)", async () => {
    await kur();
    // Ortakta CHANNEL_CODE dinlenme grubudur (gömülü taban); kira `GRUP` der.
    expect(CHANNEL_CODE).not.toBe(GRUP);
    h.emit("update-available", bilgi(CHANNEL_CODE));
    expect(durum().imzaReddi?.kod).toBe("KUNYE_KANAL");
  });

  it("ezme yalnız kiradaki grubun yolundaysa uygulanır; tanınmayan grup ve eski kök yazılmaz", async () => {
    await kur();
    const ezme = (u: string | null) => h.handlers.get("updater:set-feed-url")!(UYGULAMA, u) as Promise<UpdateStatus>;
    for (const kotu of [`https://${ALLOWED_UPDATE_HOST}/adnansahin/electron/`, "https://guncelleme.etkiliyazilim.com/oncu/electron/"]) {
      await expect(ezme(kotu), kotu).rejects.toThrow();
    }
    h.store.set(UPDATE_FEED_OVERRIDE_KEY, groupFeedUrl("genel")!);
    await kontrol();
    expect(sonFeed().url).toBe(groupFeedUrl(GRUP));
    expect(durum().feedUrlOverridden).toBe(false);
    await ezme(IZINLI.slice(0, -1));
    expect(sonFeed().url).toBe(IZINLI);
    expect(durum().feedUrlOverridden).toBe(true);
  });
});
