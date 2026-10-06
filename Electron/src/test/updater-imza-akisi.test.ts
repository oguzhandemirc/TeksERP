import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";
import type { UpdateStatus } from "@shared/ipc-contract";
import { UPDATE_FEED_OVERRIDE_KEY, groupFeedUrl } from "@shared/update-feed";
import { API_BASE_URL_STORE_KEY, AUTH_TOKEN_STORE_KEY, DOWNLOAD_TOKEN_HEADER } from "@shared/download-token";
import { buildReleaseDoc, signReleaseDoc } from "../../electron/guncelleme/panel-kunye.mjs";
import { withReleaseBlock } from "../../electron/guncelleme/latest-yml.mjs";

/**
 * GÜNCELLEME AKIŞI — İMZALI KÜNYE (gerçek `registerUpdaterIpc`, sahte electron/electron-updater).
 *
 * ⭐ İDDİA 1 (yönetici şartı): `autoDownload=false` İÇ AYRINTIDIR. Künye doğrulanınca indirme KENDİLİĞİNDEN
 * başlar ve kullanıcının gördüğü akış bugünküyle aynıdır: checking → available ("Yeni sürüm indiriliyor…") →
 * downloading → ready (geri sayım → kur). Elle "Şimdi kontrol et" de aynı yoldan geçer.
 * ⭐ İDDİA 2: doğrulama düşerse TR uyarı (`error` + `imzaReddi`) ve kurulum YOK — indirme hiç başlamaz, inmiş
 * dosya künyeyle eşleşmezse silinir, kurulum anında dosya değişmişse `quitAndInstall` çağrılmaz.
 * ⭐ İDDİA 3: güncelleme adresi ezmesi yalnız https + kanal kaydının ana makinesi + `/<kanal>/electron/`;
 * kural YAZARKEN ve OKURKEN ana süreçte; indirme belirteci yalnız izinli adrese.
 * İDDİA 4: kanallar gönderen denetimli tek geçitten (`handleTrusted`/`onTrusted`); yabancı belge işleyiciye ulaşamaz.
 * Grup akışının kendi iddiaları: `updater-grup-akisi.test.ts`.
 */
const h = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...a: unknown[]) => unknown>>();
  return {
    listeners,
    handlers: new Map<string, (...a: unknown[]) => unknown>(),
    onHandlers: new Map<string, (...a: unknown[]) => unknown>(),
    sent: [] as UpdateStatus[],
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
      installerPath: null as string | null,
    },
    emit(ev: string, ...a: unknown[]) {
      for (const fn of listeners.get(ev) ?? []) fn(...a);
    },
  };
});
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "9.9.9" },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_c: string, s: UpdateStatus) => h.sent.push(s) } }],
  },
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => h.handlers.set(ch, fn),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => h.onHandlers.set(ch, fn),
  },
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
const GOVDE = Buffer.from("imzali kurulum ".repeat(4096));
const DIZIN = mkdtempSync(join(tmpdir(), "updater-imza-"));
const DOSYA = join(DIZIN, AD);
/** Ortak pakette kiranın grubu (dinlenme grubu DEĞİL olsun diye `oncu`: gömülü adresle karışmasın). */
const GRUP = "oncu";
const IZINLI = groupFeedUrl(GRUP)!;
/** Künyenin taşıması gereken kanal: kiradaki grup. */
const BEKLENEN = GRUP;
const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJ2IjoxfQ.c2lnbmF0dXJl";
const izin = (grup: string | null = GRUP) => ({ ok: true, status: 200, json: async () => ({ success: true, data: { belirtec: TOKEN, grup } }) });
const GIRIS = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
/** Uygulama belgesinin ana çerçevesinden gelen IPC olayı (gönderen denetimi geçer). */
const UYGULAMA = { senderFrame: { url: `${GIRIS}#/ayarlar`, parent: null } };
const YABANCI = { senderFrame: { url: "file://saldirgan/pay/index.html", parent: null } };

function latestYml({ imza = true, kanal = BEKLENEN, kid = KID } = {}): string {
  const sha = createHash("sha512").update(GOVDE).digest();
  const yml = `version: ${YENI}\nfiles:\n  - url: ${AD}\n    sha512: ${sha.toString("base64")}\n    size: ${GOVDE.length}\npath: ${AD}\nsha512: ${sha.toString("base64")}\nreleaseDate: '2026-10-01T01:00:00.000Z'\n`;
  if (!imza) return yml;
  const doc = buildReleaseDoc({
    kanal,
    surum: YENI,
    commit: "0efe882d",
    yayinZamani: "2026-10-01T01:00:00.000Z",
    paket: { ad: AD, boyut: GOVDE.length, sha512: sha.toString("hex") },
    capa: [KID],
  });
  return withReleaseBlock(yml, signReleaseDoc({ doc, kid, privateKey: ANAHTAR.privateKey }));
}
/** electron-updater'ın `update-available`a verdiği nesne — kendi ayrıştırıcısından. */
const bilgi = (yml = latestYml()) => parseUpdateInfo(yml, "latest.yml", new URL(`${IZINLI}latest.yml`)) as unknown as Record<string, unknown>;

const durum = () => h.handlers.get("updater:status")!(UYGULAMA) as UpdateStatus;
/** Yayınlanan durumların sırası (ardışık tekrarlar tek) — kullanıcının gördüğü akış. */
const akis = () => h.sent.map((s) => s.state).filter((s, i, a) => i === 0 || a[i - 1] !== s);
const tik = () => new Promise<void>((r) => setImmediate(r));

/**
 * Gerçek `registerUpdaterIpc`. Oturum + belirteç kiradaki grubu (`GRUP`) taşır; açılıştaki feed kurulumu bitene dek beklenir (künyenin kanalı oradan gelir).
 */
async function kur({ grup = GRUP as string | null } = {}) {
  vi.resetModules();
  for (const m of [h.handlers, h.onHandlers, h.listeners, h.store]) m.clear();
  h.sent.length = 0;
  h.updater.installerPath = null;
  h.updater.autoDownload = true;
  h.fetchMock.mockReset().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
  h.store.set(API_BASE_URL_STORE_KEY, "http://10.0.0.5:4000");
  h.store.set(AUTH_TOKEN_STORE_KEY, "jwt");
  h.fetchMock.mockResolvedValue(izin(grup));
  for (const f of [h.updater.setFeedURL, h.updater.checkForUpdates, h.updater.downloadUpdate, h.updater.quitAndInstall]) f.mockClear();
  const m = await import("../../electron/ipc/updater.ipc");
  const guvenilir = await import("../../electron/security/trusted-ipc");
  guvenilir.setTrustedAppEntry(GIRIS);
  m.registerUpdaterIpc();
  // Açılıştaki `applyFeedUrl` (belirteç isteği + feed) mikro görevlerde biter.
  await tik();
  await tik();
  return guvenilir;
}

/** Geçerli künye → indirildi → ready. */
async function hazirla() {
  writeFileSync(DOSYA, GOVDE);
  h.emit("checking-for-update");
  h.emit("update-available", bilgi());
  h.emit("download-progress", { percent: 42.4 });
  h.updater.installerPath = DOSYA;
  h.emit("update-downloaded", { ...bilgi(), downloadedFile: DOSYA });
  await vi.waitFor(() => expect(durum().state).toBe("ready"));
}

beforeAll(() => {
  h.anchorFile.anahtarlar.push({ kid: KID, x: ANAHTAR.publicKey.export({ format: "jwk" }).x as string });
});
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] }));
afterEach(() => vi.useRealTimers());
afterAll(() => rmSync(DIZIN, { recursive: true, force: true }));

describe("imzalı künye — görünen akış bugünküyle aynı", () => {
  it("künye doğrulanınca indirme KENDİLİĞİNDEN başlar: checking → available → downloading → ready → kur", async () => {
    await kur();
    expect(h.updater.autoDownload, "iç ayrıntı: indirme künyeden sonra").toBe(false);
    await hazirla();
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(akis()).toEqual(["idle", "checking", "available", "downloading", "ready"]);
    expect(durum()).toMatchObject({ newVersion: YENI, percent: 100, imzaReddi: null });
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true));
  });

  it("elle 'Şimdi kontrol et' (updater:check) aynı yoldan: kullanıcı ikinci bir şey yapmadan indirme başlar", async () => {
    await kur();
    h.updater.checkForUpdates.mockImplementationOnce(async () => {
      h.emit("checking-for-update");
      h.emit("update-available", bilgi());
      return null;
    });
    await h.handlers.get("updater:check")!(UYGULAMA);
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(durum().state).toBe("available");
  });
});

describe("imzalı künye — doğrulama düşerse TR uyarı + kurulum YOK", () => {
  const reddedildi = (kod: string) => {
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(durum().state).toBe("error");
    expect(durum().imzaReddi?.kod).toBe(kod);
    expect(durum().error).toMatch(/kurulmadı/);
  };

  it("imzasız latest.yml (bugünkü yayın) → indirme yok, KUNYE_YOK; electron-updater yine de 'indi' derse kurulum yok", async () => {
    await kur();
    h.emit("update-available", bilgi(latestYml({ imza: false })));
    reddedildi("KUNYE_YOK");
    writeFileSync(DOSYA, GOVDE);
    h.updater.installerPath = DOSYA;
    h.emit("update-downloaded", { ...bilgi(latestYml({ imza: false })), downloadedFile: DOSYA });
    await tik();
    expect(durum().state).toBe("error");
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await tik();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("başka kanalın künyesi → KUNYE_KANAL · çapada olmayan anahtar → JWS_KID", async () => {
    await kur();
    const baska = "genel";
    h.emit("update-available", bilgi(latestYml({ kanal: baska })));
    reddedildi("KUNYE_KANAL");
    await kur();
    h.emit("update-available", bilgi(latestYml({ kid: "panel-yabanci" })));
    reddedildi("JWS_KID");
  });

  it("inen dosya künyeyle eşleşmiyor → ready OLMAZ, dosya silinir, DOSYA_OZETI", async () => {
    await kur();
    h.emit("update-available", bilgi());
    writeFileSync(DOSYA, Buffer.concat([GOVDE, Buffer.from("x")]));
    h.updater.installerPath = DOSYA;
    h.emit("update-downloaded", { ...bilgi(), downloadedFile: DOSYA });
    await vi.waitFor(() => expect(durum().imzaReddi?.kod).toBe("DOSYA_OZETI"));
    expect(durum().state).toBe("error");
    expect(existsSync(DOSYA)).toBe(false);
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await tik();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("kurulum anında dosya değiştirilmiş (indirme ile kurulum arası) → quitAndInstall YOK", async () => {
    await kur();
    await hazirla();
    writeFileSync(DOSYA, Buffer.from("başka exe"));
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(durum().imzaReddi?.kod).toBe("DOSYA_OZETI"));
    await tik();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("electron-updater'ın çalıştıracağı dosya doğrulanan dosya değil → kurulum YOK", async () => {
    await kur();
    await hazirla();
    h.updater.installerPath = join(DIZIN, "baska.exe");
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(durum().imzaReddi?.kod).toBe("KUNYE_YOK"));
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("red denetim boyunca KALIR (şerit titremez), 'güncel' sonucu temizler", async () => {
    await kur();
    h.emit("update-available", bilgi(latestYml({ imza: false })));
    h.emit("checking-for-update");
    expect(durum().imzaReddi?.kod).toBe("KUNYE_YOK");
    h.emit("update-not-available", {});
    expect(durum().imzaReddi).toBeNull();
  });
});

describe("güncelleme adresi ezmesi — ana süreç kuralı (yazarken + okurken)", () => {
  const ezme = (u: string | null) => h.handlers.get("updater:set-feed-url")!(UYGULAMA, u) as Promise<UpdateStatus>;

  it("http · yabancı ana makine · yanlış yol · kimlik/port/sorgu → yazılmaz (hata döner)", async () => {
    await kur();
    for (const kotu of [
      IZINLI.replace("https:", "http:"),
      "https://kotu.example/adnansahin/electron/",
      new URL("../../baska/", IZINLI).toString(),
      IZINLI.replace("https://", "https://u:p@"),
      IZINLI.replace(".com/", ".com:8443/"),
      `${IZINLI}?x=1`,
    ]) {
      await expect(ezme(kotu), kotu).rejects.toThrow();
      expect(h.store.has(UPDATE_FEED_OVERRIDE_KEY), kotu).toBe(false);
    }
  });

  it("izinli adres normalize edilerek yazılır (sonda /)", async () => {
    await kur();
    const s = await ezme(IZINLI.slice(0, -1));
    expect(h.store.get(UPDATE_FEED_OVERRIDE_KEY)).toBe(IZINLI);
    expect(s).toMatchObject({ feedUrl: IZINLI, feedUrlOverridden: true });
  });

  it("⭐ yabancı belgeden ezme · kontrol · kurulum işleyiciye ULAŞMAZ (izinli adres bile yazılmaz)", async () => {
    const guvenilir = await kur();
    expect(() => h.handlers.get("updater:set-feed-url")!(YABANCI, IZINLI)).toThrow(guvenilir.UNTRUSTED_SENDER_ERROR);
    expect(h.store.has(UPDATE_FEED_OVERRIDE_KEY)).toBe(false);
    expect(() => h.handlers.get("updater:check")!(YABANCI)).toThrow(guvenilir.UNTRUSTED_SENDER_ERROR);
    expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
    h.onHandlers.get("updater:install")!(YABANCI);
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("kasaya başka yoldan yazılmış http/yabancı ezme OKURKEN yok sayılır; belirteç yalnız izinli adrese gider", async () => {
    await kur();
    h.store.set(API_BASE_URL_STORE_KEY, "http://10.0.0.5:4000");
    h.store.set(AUTH_TOKEN_STORE_KEY, "jwt");
    h.fetchMock.mockResolvedValue(izin());
    h.store.set(UPDATE_FEED_OVERRIDE_KEY, "http://10.0.0.9/adnansahin/electron/");
    await h.handlers.get("updater:check")!(UYGULAMA);
    const son = h.updater.setFeedURL.mock.calls.at(-1)?.[0] as { url: string; requestHeaders?: Record<string, string> };
    expect(son.url).toBe(IZINLI);
    expect(son.requestHeaders).toEqual({ [DOWNLOAD_TOKEN_HEADER]: TOKEN });
    expect(durum().feedUrlOverridden).toBe(false);
  });
});
