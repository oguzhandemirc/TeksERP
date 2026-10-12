import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";
import type { UpdateStatus } from "@shared/ipc-contract";
import { groupFeedUrl } from "@shared/update-feed";
import { API_BASE_URL_STORE_KEY, AUTH_TOKEN_STORE_KEY } from "@shared/download-token";
import { buildReleaseDoc } from "../../../electron/guncelleme/panel-kunye.mjs";
import { withReleaseBlock } from "../../../electron/guncelleme/latest-yml.mjs";
import { REVOCATION_FILE_NAME } from "../../../electron/guncelleme/iptal-deposu";
import { anahtarUret, zincirKur } from "./istemci-zinciri-fikstur";

/**
 * Gerçek `registerUpdaterIpc` için sahte electron/electron-updater fikstürü — `updater-imza-akisi` ve
 * `updater-kapanista-kur` ortak kullanır (mock kayıtları modül yüklenirken; `kur()` modülü dinamik içe aktarır).
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
    anchorFile: { kokler: [] as Array<{ kid: string; x: string; classes: string[] }> },
    userData: { dir: "" },
    updater: {
      setFeedURL: vi.fn(),
      requestHeaders: null as Record<string, string> | null,
      checkForUpdates: vi.fn(async () => null),
      downloadUpdate: vi.fn(async () => [] as string[]),
      quitAndInstall: vi.fn(),
      on: (ev: string, fn: (...a: unknown[]) => unknown) => listeners.set(ev, [...(listeners.get(ev) ?? []), fn]),
      logger: null as unknown,
      autoDownload: true,
      autoInstallOnAppQuit: true,
      installerPath: null as string | null,
    },
    appListeners: new Map<string, (...a: unknown[]) => unknown>(),
    appQuit: vi.fn(),
    emit(ev: string, ...a: unknown[]) {
      for (const fn of listeners.get(ev) ?? []) fn(...a);
    },
  };
});
vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getVersion: () => "9.9.9",
    getPath: () => h.userData.dir,
    on: (ev: string, fn: (...a: unknown[]) => unknown) => h.appListeners.set(ev, fn),
    quit: () => h.appQuit(),
  },
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
vi.mock("../../../electron/ipc/secure-store.ipc.js", () => ({
  readSecureValue: (k: string) => h.store.get(k) ?? null,
  writeSecureValue: (k: string, v: string) => h.store.set(k, v),
  deleteSecureValue: (k: string) => h.store.delete(k),
}));
vi.mock("../../../electron/guncelleme/imza-capasi.json", () => ({ default: h.anchorFile }));

export const Z = zincirKur();
export const YABANCI_SERTIFIKA = Z.sertifikaBas(Z.ist, {}, anahtarUret("kok-yabanci-1")).token;
export const YENI = "10.0.0";
export const AD = `TeksERP-${YENI}-Setup.exe`;
export const INSTALLER_BODY = Buffer.from("imzali kurulum ".repeat(4096));
export const DIZIN = mkdtempSync(join(tmpdir(), "updater-imza-"));
export const INSTALLER_FILE = join(DIZIN, AD);
h.userData.dir = mkdtempSync(join(tmpdir(), "updater-userdata-"));
export const REVOCATION_FILE = join(h.userData.dir, REVOCATION_FILE_NAME);
/** Ortak pakette kiranın grubu (dinlenme grubu DEĞİL olsun diye `oncu`: gömülü adresle karışmasın). */
export const GRUP = "oncu";
export const IZINLI = groupFeedUrl(GRUP)!;
/** Künyenin taşıması gereken kanal: kiradaki grup. */
export const BEKLENEN = GRUP;
export const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJ2IjoxfQ.c2lnbmF0dXJl";
export const izin = (grup: string | null = GRUP, iptal: string | null = null) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data: { belirtec: TOKEN, grup, iptal } }) });
export const GIRIS = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
/** Uygulama belgesinin ana çerçevesinden gelen IPC olayı (gönderen denetimi geçer). */
export const UYGULAMA = { senderFrame: { url: `${GIRIS}#/ayarlar`, parent: null } };
export const YABANCI = { senderFrame: { url: "file://saldirgan/pay/index.html", parent: null } };

export function latestYml({ imza = true, kanal = BEKLENEN, sertifika = Z.sertifika } = {}): string {
  const sha = createHash("sha512").update(INSTALLER_BODY).digest();
  const yml = `version: ${YENI}\nfiles:\n  - url: ${AD}\n    sha512: ${sha.toString("base64")}\n    size: ${INSTALLER_BODY.length}\npath: ${AD}\nsha512: ${sha.toString("base64")}\nreleaseDate: '2026-10-01T01:00:00.000Z'\n`;
  if (!imza) return yml;
  const doc = buildReleaseDoc({
    kanal,
    surum: YENI,
    commit: "0efe882d",
    yayinZamani: "2026-10-01T01:00:00.000Z",
    paket: { ad: AD, boyut: INSTALLER_BODY.length, sha512: sha.toString("hex") },
    capa: [Z.kok.kid],
  });
  return withReleaseBlock(yml, Z.imzala(doc, { sertifika }));
}
/** electron-updater'ın `update-available`a verdiği nesne — kendi ayrıştırıcısından. */
export const bilgi = (yml = latestYml()) => parseUpdateInfo(yml, "latest.yml", new URL(`${IZINLI}latest.yml`)) as unknown as Record<string, unknown>;

export const getStatus = () => h.handlers.get("updater:status")!(UYGULAMA) as UpdateStatus;
/** Yayınlanan durumların sırası (ardışık tekrarlar tek) — kullanıcının gördüğü akış. */
export const akis = () => h.sent.map((s) => s.state).filter((s, i, a) => i === 0 || a[i - 1] !== s);
export const tik = () => new Promise<void>((r) => setImmediate(r));

/**
 * Gerçek `registerUpdaterIpc`. Oturum + belirteç kiradaki grubu (`GRUP`) taşır; açılıştaki feed kurulumu bitene dek beklenir (künyenin kanalı oradan gelir).
 */
export async function kur({ grup = GRUP as string | null, iptal = null as string | null } = {}) {
  vi.resetModules();
  for (const m of [h.handlers, h.onHandlers, h.listeners, h.store, h.appListeners]) m.clear();
  h.appQuit.mockClear();
  h.sent.length = 0;
  h.updater.installerPath = null;
  h.updater.autoDownload = true;
  h.fetchMock.mockReset().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
  h.store.set(API_BASE_URL_STORE_KEY, "http://10.0.0.5:4000");
  h.store.set(AUTH_TOKEN_STORE_KEY, "jwt");
  h.fetchMock.mockResolvedValue(izin(grup, iptal));
  for (const f of [h.updater.setFeedURL, h.updater.checkForUpdates, h.updater.downloadUpdate, h.updater.quitAndInstall]) f.mockClear();
  const m = await import("../../../electron/ipc/updater.ipc");
  const guvenilir = await import("../../../electron/security/trusted-ipc");
  guvenilir.setTrustedAppEntry(GIRIS);
  m.registerUpdaterIpc();
  // Açılıştaki `applyFeedUrl` (belirteç isteği + feed) mikro görevlerde biter.
  await tik();
  await tik();
  return guvenilir;
}

/** Geçerli künye → indirildi → ready. */
export async function hazirla() {
  writeFileSync(INSTALLER_FILE, INSTALLER_BODY);
  h.emit("checking-for-update");
  h.emit("update-available", bilgi());
  h.emit("download-progress", { percent: 42.4 });
  h.updater.installerPath = INSTALLER_FILE;
  h.emit("update-downloaded", { ...bilgi(), downloadedFile: INSTALLER_FILE });
  await vi.waitFor(() => expect(getStatus().state).toBe("ready"));
}

/** Ortak yaşam döngüsü kancaları — her test dosyası en üst düzeyde bir kez çağırır. */
export function updaterFiksturKancalari(): void {
  beforeAll(() => {
    h.anchorFile.kokler.push(...Z.roots.map((r) => ({ ...r, classes: [...r.classes] })));
  });
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] }));
  afterEach(() => vi.useRealTimers());
  afterEach(() => rmSync(REVOCATION_FILE, { force: true }));
  afterAll(() => [DIZIN, h.userData.dir].forEach((d) => rmSync(d, { recursive: true, force: true })));
}

export { h };
