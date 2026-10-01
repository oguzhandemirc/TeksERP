import { unlink } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, net } from "electron";
import electronUpdater from "electron-updater";
import log from "electron-log/main.js";
import type { UpdateStatus } from "@shared/ipc-contract";
import { CHANNEL_CODE } from "@shared/channel";
import { DEFAULT_UPDATE_FEED_URL, UPDATE_FEED_OVERRIDE_KEY, validateFeedOverride } from "@shared/update-feed";
import { API_BASE_URL_STORE_KEY, AUTH_TOKEN_STORE_KEY, feedOptions, fetchDownloadToken } from "@shared/download-token";
import { createUpdateVerifier, panelAnchor, type UpdateRejection, type UpdateVerifier } from "../guncelleme/guncelleme-dogrulama";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
} from "@shared/update-schedule";
import { deleteSecureValue, readSecureValue, writeSecureValue } from "./secure-store.ipc.js";

// electron-updater CommonJS'tir; main ESM olarak derlendiği için named import
// çalışmaz (`externalizeDepsPlugin` paketi dışarıda bıraktığından Node'un CJS
// interop'u devreye girer). Default'tan sökmek tek güvenli yol.
//
// ⚠️ `autoUpdater` bir GETTER'dır: ilk erişimde platforma göre updater nesnesini
// KURAR ve o anda Electron `app`ine dokunur (`ElectronAppAdapter.version`).
// Modül gövdesinde sökülseydi bu, import zincirinde — yani `app.whenReady()`
// çalışmadan önce — olurdu. Bu yüzden erişim ilk kullanıma ertelenir;
// `registerUpdaterIpc` zaten whenReady içinden çağrılıyor.
type AppUpdater = typeof electronUpdater.autoUpdater;
let updaterRef: AppUpdater | null = null;
function updater(): AppUpdater {
  if (!updaterRef) updaterRef = electronUpdater.autoUpdater;
  return updaterRef;
}

/**
 * ⚠️ ZAMANLAYICI BU DOSYADA TEKTİR ve süreler `@shared/update-schedule`ten gelir
 * (ilk kontrol 30 sn, sonra 15 dk). Arayüzdeki "güncelleme denetle" düğmesi
 * kendi takvimini KURMAZ — yalnız `updater:check` çağırır; ikinci bir
 * zamanlayıcı, pencere/mount sayısı kadar çoğalan bir yoklama demek olurdu.
 */

let status: UpdateStatus = {
  state: "idle",
  currentVersion: app.getVersion(),
  lastCheckedAt: null,
  feedUrl: DEFAULT_UPDATE_FEED_URL,
  feedUrlOverridden: false,
  enabled: false,
  imzaReddi: null,
};

/** Durum değişimini sakla + AÇIK TÜM pencerelere yayınla. */
function publish(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("updater:status", status);
  }
  return status;
}

/**
 * electron-updater hatalarını operatörün okuyabileceği Türkçeye çevirir.
 *
 * Ham metinler İngilizce ve teknik ("net::ERR_NAME_NOT_RESOLVED", "status code
 * 404"). Fabrikadaki okuyucu bunları anlamaz; anlamadığı uyarıyı da görmezden
 * gelir. Tanınmayan hata İngilizce ham hâliyle geçer — yutmak, teşhisi imkânsız
 * kılardı (`electron-log` dosyasına zaten tam metin yazılıyor).
 */
function toTurkishError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const t = raw.toLowerCase();
  if (t.includes("err_name_not_resolved") || t.includes("enotfound")) {
    return "Güncelleme sunucusunun adresi çözülemedi (internet bağlantısı yok olabilir).";
  }
  if (
    t.includes("err_internet_disconnected") ||
    t.includes("err_network") ||
    t.includes("econnrefused") ||
    t.includes("etimedout") ||
    t.includes("err_connection")
  ) {
    return "Güncelleme sunucusuna ulaşılamadı (internet bağlantısı yok olabilir).";
  }
  if (t.includes("404") || t.includes("not found")) {
    return "Güncelleme sunucusunda sürüm dosyası bulunamadı (yayın henüz yüklenmemiş olabilir).";
  }
  if (t.includes("cert") || t.includes("ssl") || t.includes("err_cert")) {
    return "Güncelleme sunucusunun güvenlik sertifikası kabul edilmedi.";
  }
  if (t.includes("sha512") || t.includes("checksum")) {
    return "İndirilen dosya bozuk çıktı; sonraki kontrolde yeniden denenecek.";
  }
  return raw || "Güncelleme kontrolü başarısız oldu.";
}

/**
 * Ezme adresi geçerliyse onu, değilse derlemeye gömülü varsayılanı döndürür. Kural OKURKEN de uygulanır
 * (`validateFeedOverride`: https · kanal kaydının ana makinesi · `/<kanal>/electron/`) — kasaya başka bir yoldan
 * yazılmış ya da eski sürümün kabul ettiği (http, yabancı ana makine) değer sessizce yok sayılır.
 */
function resolveFeedUrl(): { url: string; overridden: boolean } {
  const raw = readSecureValue(UPDATE_FEED_OVERRIDE_KEY);
  if (!raw) return { url: DEFAULT_UPDATE_FEED_URL, overridden: false };
  const v = validateFeedOverride(raw);
  if (v.ok) return { url: v.url, overridden: true };
  // Makineyi güncellemesiz bırakmaktansa varsayılana dönmek doğru; yanlış adres Ayarlar ekranında görünür.
  log.warn("[updater] geçersiz feed URL ezmesi yok sayıldı:", v.reason);
  return { url: DEFAULT_UPDATE_FEED_URL, overridden: false };
}

/**
 * Çözülen adresi autoUpdater'a uygula ve duruma yansıt. Her denetimde fabrikanın backend'inden taze
 * indirme belirteci istenir (3b); alınamazsa başlıksız — bugünkü davranış (@shared/download-token).
 */
async function applyFeedUrl(): Promise<void> {
  const { url, overridden } = resolveFeedUrl();
  const token = await fetchDownloadToken({
    apiBaseUrl: readSecureValue(API_BASE_URL_STORE_KEY),
    authToken: readSecureValue(AUTH_TOKEN_STORE_KEY),
    fetchImpl: (u, init) => net.fetch(u, init),
  });
  updater().setFeedURL(feedOptions(url, token));
  publish({ feedUrl: url, feedUrlOverridden: overridden });
}

/**
 * Devam eden kontrolün SÖZÜ (eskiden düz bir `checking` bayrağıydı).
 *
 * ⚠️ Fark, elle denetleme yüzeyi için load-bearing: bayrak varken ikinci çağrı
 * ANINDA ve o anki (bayat) durumla dönüyordu. Kullanıcı düğmeye tam otomatik
 * kontrolün üstüne bastığında bu, "bir saat önceki cevabı" bugünün sonucu diye
 * baloncukla bastırırdı. Sözü paylaşmak, ikinci çağırana da AYNI kontrolün
 * gerçek sonucunu verir; sunucuya yine tek istek gider.
 */
let inFlight: Promise<UpdateStatus> | null = null;

async function check(): Promise<UpdateStatus> {
  if (!status.enabled) return status;
  // Zaten indirilmiş güncelleme varsa yeniden sormak, hazır paketi "checking"e
  // düşürüp kullanıcının gördüğü "Yeniden Başlat" bandını kaybettirir.
  if (status.state === "ready") return status;
  if (inFlight) return inFlight;

  const calisan = (async () => {
    try {
      await applyFeedUrl();
      await updater().checkForUpdates();
    } catch (err) {
      // checkForUpdates hem reject eder hem "error" olayı yayar; ikisi de aynı
      // duruma yazdığı için burada ekstra bir şey yapmaya gerek yok.
      log.warn("[updater] kontrol başarısız", err);
    }
    return status;
  })();
  inFlight = calisan;
  try {
    return await calisan;
  } finally {
    // Yalnız KENDİ sözünü temizle — arada yenisi kurulmuşsa ona dokunma.
    if (inFlight === calisan) inFlight = null;
  }
}

// ── İMZALI KÜNYE AKIŞI ───────────────────────────────────────────────────────
// electron-updater'ın sha512'si aynı sunucudaki latest.yml'e bağlıdır (bütünlük kanıtı DEĞİL) ve paket kod
// imzasızdır (Authenticode denetimi atlanır). Kanıt, yayın makinesinde imzalanan künyedir
// (`electron/guncelleme/`): doğrulanamayan güncelleme İNDİRİLMEZ ve KURULMAZ.
let verifier: UpdateVerifier | null = null;
let installing = false;

/** Güvenlik reddi: kurulum yok, TR uyarı, sağlık/teşhis için tek satır (kod + sürüm — sır yok). */
function rejectUpdate(r: UpdateRejection): void {
  log.warn(`[updater] güncelleme REDDEDİLDİ kod=${r.kod} surum=${r.surum ?? "-"}`);
  const now = new Date().toISOString();
  publish({
    state: "error",
    error: `${r.mesaj} Panel bu sürümle çalışmaya devam ediyor; bilgi işlem sorumlusuna bildirin.`,
    newVersion: undefined,
    percent: undefined,
    lastCheckedAt: now,
    imzaReddi: { kod: r.kod, surum: r.surum, zaman: now },
  });
}

/**
 * ⚠️ `autoDownload=false` İÇ AYRINTIDIR: indirme künye doğrulanınca BURADA kendiliğinden başlar — kullanıcının
 * gördüğü akış (available → downloading → ready → geri sayım → kur) bugünküyle aynı; elle denetim de aynı yoldan.
 */
function onUpdateAvailable(info: { version?: string } | undefined): void {
  const v = verifier?.checkInfo(info);
  if (!v?.ok) {
    rejectUpdate(v?.rejection ?? { kod: "CAPA_BOS", mesaj: "Güncelleme doğrulayıcısı kurulmamış; kurulmadı.", surum: info?.version ?? null });
    return;
  }
  publish({ state: "available", newVersion: info?.version, lastCheckedAt: new Date().toISOString(), error: undefined, imzaReddi: null });
  void updater()
    .downloadUpdate()
    .catch((err: unknown) => log.warn("[updater] indirme başarısız", err));
}

async function onUpdateDownloaded(info: { version?: string; downloadedFile?: string } | undefined): Promise<void> {
  log.info("[updater] indirildi, künyeyle ölçülüyor", info?.version);
  const v = verifier ? await verifier.checkDownloaded(info) : null;
  if (!v?.ok) {
    rejectUpdate(v?.rejection ?? { kod: "KUNYE_YOK", mesaj: "Güncelleme doğrulanmadı; kurulmadı.", surum: info?.version ?? null });
    return;
  }
  publish({ state: "ready", newVersion: info?.version, percent: 100, error: undefined, imzaReddi: null });
}

/** electron-updater'ın ÇALIŞTIRACAĞI dosya (NSIS: indirme önbelleğindeki kurulum) — doğrulanan dosya olmalı. */
function installerPath(): unknown {
  return (updater() as unknown as { installerPath?: unknown }).installerPath;
}

async function installVerified(): Promise<void> {
  if (!status.enabled || status.state !== "ready" || installing || !verifier) return;
  installing = true;
  try {
    const v = await verifier.checkBeforeInstall(installerPath());
    if (!v.ok) {
      rejectUpdate(v.rejection);
      return;
    }
    log.info("[updater] kurulum başlatılıyor", status.newVersion);
    // isSilent=true → NSIS sihirbazı açılmaz. Uygulama "Program Files"a kurulu
    // olduğu için Windows yine de bir kez yönetici izni sorar; kullanıcı "Evet"
    // dedikten sonrası sessizdir. isForceRunAfter=true → kurulumdan sonra
    // uygulama kendiliğinden geri açılır (operatör boş ekranla kalmasın).
    setImmediate(() => updater().quitAndInstall(true, true));
  } finally {
    installing = false;
  }
}

/** Ezme YAZIMI: kural (`validateFeedOverride`) burada da uygulanır; geçersiz adres yazılmaz, çağırana hata döner. */
async function setFeedOverride(next: string | null): Promise<UpdateStatus> {
  if (next && next.trim()) {
    const v = validateFeedOverride(next);
    if (!v.ok) throw new Error(v.reason);
    writeSecureValue(UPDATE_FEED_OVERRIDE_KEY, v.url);
  } else deleteSecureValue(UPDATE_FEED_OVERRIDE_KEY);
  if (status.enabled) await applyFeedUrl();
  else {
    const r = resolveFeedUrl();
    publish({ feedUrl: r.url, feedUrlOverridden: r.overridden });
  }
  return status;
}

export function registerUpdaterIpc(): void {
  const packaged = app.isPackaged;
  const { url, overridden } = resolveFeedUrl();
  publish({
    enabled: packaged,
    feedUrl: url,
    feedUrlOverridden: overridden,
    currentVersion: app.getVersion(),
  });

  ipcMain.handle("updater:status", () => status);
  ipcMain.handle("updater:check", () => check());
  ipcMain.handle("updater:set-feed-url", (_e, next: string | null) => setFeedOverride(next));
  ipcMain.on("updater:install", () => void installVerified());

  if (!packaged) {
    // Dev'de electron-updater "application is not packed" ile hata fırlatır;
    // hiç çağırmıyoruz. Ayarlar ekranı bunu "geliştirme modu" diye yazar.
    log.info("[updater] paketlenmemiş çalıştırma — otomatik güncelleme kapalı");
    return;
  }

  verifier = createUpdateVerifier({
    keys: panelAnchor,
    channel: CHANNEL_CODE,
    installedVersion: app.getVersion(),
    removeFile: (p) => unlink(p),
  });
  updater().logger = log;
  // İndirme künye doğrulandıktan SONRA `onUpdateAvailable` başlatır (yukarıda); görünen akış değişmez.
  updater().autoDownload = false;
  // Kapanışta sessizce kurma KAPALI: uygulama "Program Files"a kurulu olduğu
  // için kurulum yönetici izni ister. Kapanışta tetiklenirse operatör gittikten
  // sonra ekranda cevapsız bir izin penceresi asılı kalır. Kurulum yalnız
  // kullanıcı bandan "Yeniden Başlat" dediğinde, yani başındayken yapılır.
  updater().autoInstallOnAppQuit = false;
  void applyFeedUrl();

  updater().on("checking-for-update", () => publish({ state: "checking", error: undefined }));
  updater().on("update-available", (info) => onUpdateAvailable(info));
  updater().on("update-not-available", () =>
    publish({
      state: "up-to-date",
      newVersion: undefined,
      percent: undefined,
      lastCheckedAt: new Date().toISOString(),
      error: undefined,
      imzaReddi: null,
    }),
  );
  updater().on("download-progress", (p) =>
    publish({ state: "downloading", percent: Math.round(p?.percent ?? 0) }),
  );
  updater().on("update-downloaded", (info) => void onUpdateDownloaded(info));
  updater().on("error", (err) => {
    log.error("[updater] hata", err);
    publish({ state: "error", error: toTurkishError(err) });
  });

  setTimeout(() => void check(), UPDATE_FIRST_CHECK_DELAY_MS);
  setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
}
