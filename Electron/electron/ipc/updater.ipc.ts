import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import log from "electron-log/main.js";
import type { UpdateStatus } from "@shared/ipc-contract";
import { DEFAULT_UPDATE_FEED_URL, UPDATE_FEED_OVERRIDE_KEY } from "@shared/update-feed";
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

/** Ezme adresi geçerliyse onu, değilse derlemeye gömülü varsayılanı döndürür. */
function resolveFeedUrl(): { url: string; overridden: boolean } {
  const raw = readSecureValue(UPDATE_FEED_OVERRIDE_KEY);
  if (!raw) return { url: DEFAULT_UPDATE_FEED_URL, overridden: false };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("protokol");
    }
    // Sondaki `/` şart: electron-updater adrese `latest.yml` EKLER.
    return { url: raw.endsWith("/") ? raw : `${raw}/`, overridden: true };
  } catch {
    // Bozuk ezme sessizce yok sayılır — makineyi güncellemesiz bırakmaktansa
    // varsayılana dönmek doğru; yanlış adres Ayarlar ekranında zaten görünür.
    log.warn("[updater] geçersiz feed URL ezmesi yok sayıldı", raw);
    return { url: DEFAULT_UPDATE_FEED_URL, overridden: false };
  }
}

/** Çözülen adresi autoUpdater'a uygula ve duruma yansıt. */
function applyFeedUrl(): void {
  const { url, overridden } = resolveFeedUrl();
  updater().setFeedURL({ provider: "generic", url });
  publish({ feedUrl: url, feedUrlOverridden: overridden });
}

let checking = false;

async function check(): Promise<UpdateStatus> {
  if (!status.enabled) return status;
  // Zaten indirilmiş güncelleme varsa yeniden sormak, hazır paketi "checking"e
  // düşürüp kullanıcının gördüğü "Yeniden Başlat" bandını kaybettirir.
  if (status.state === "ready") return status;
  if (checking) return status;
  checking = true;
  try {
    applyFeedUrl();
    await updater().checkForUpdates();
  } catch (err) {
    // checkForUpdates hem reject eder hem "error" olayı yayar; ikisi de aynı
    // duruma yazdığı için burada ekstra bir şey yapmaya gerek yok.
    log.warn("[updater] kontrol başarısız", err);
  } finally {
    checking = false;
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
  ipcMain.handle("updater:set-feed-url", (_e, next: string | null) => {
    if (next && next.trim()) writeSecureValue(UPDATE_FEED_OVERRIDE_KEY, next.trim());
    else deleteSecureValue(UPDATE_FEED_OVERRIDE_KEY);
    if (status.enabled) applyFeedUrl();
    else {
      const r = resolveFeedUrl();
      publish({ feedUrl: r.url, feedUrlOverridden: r.overridden });
    }
    return status;
  });

  ipcMain.on("updater:install", () => {
    if (!status.enabled || status.state !== "ready") return;
    log.info("[updater] kurulum başlatılıyor", status.newVersion);
    // isSilent=true → NSIS sihirbazı açılmaz. Uygulama "Program Files"a kurulu
    // olduğu için Windows yine de bir kez yönetici izni sorar; kullanıcı "Evet"
    // dedikten sonrası sessizdir. isForceRunAfter=true → kurulumdan sonra
    // uygulama kendiliğinden geri açılır (operatör boş ekranla kalmasın).
    setImmediate(() => updater().quitAndInstall(true, true));
  });

  if (!packaged) {
    // Dev'de electron-updater "application is not packed" ile hata fırlatır;
    // hiç çağırmıyoruz. Ayarlar ekranı bunu "geliştirme modu" diye yazar.
    log.info("[updater] paketlenmemiş çalıştırma — otomatik güncelleme kapalı");
    return;
  }

  updater().logger = log;
  updater().autoDownload = true;
  // Kapanışta sessizce kurma KAPALI: uygulama "Program Files"a kurulu olduğu
  // için kurulum yönetici izni ister. Kapanışta tetiklenirse operatör gittikten
  // sonra ekranda cevapsız bir izin penceresi asılı kalır. Kurulum yalnız
  // kullanıcı bandan "Yeniden Başlat" dediğinde, yani başındayken yapılır.
  updater().autoInstallOnAppQuit = false;
  applyFeedUrl();

  updater().on("checking-for-update", () => publish({ state: "checking", error: undefined }));
  updater().on("update-available", (info) =>
    publish({
      state: "available",
      newVersion: info?.version,
      lastCheckedAt: new Date().toISOString(),
      error: undefined,
    }),
  );
  updater().on("update-not-available", () =>
    publish({
      state: "up-to-date",
      newVersion: undefined,
      percent: undefined,
      lastCheckedAt: new Date().toISOString(),
      error: undefined,
    }),
  );
  updater().on("download-progress", (p) =>
    publish({ state: "downloading", percent: Math.round(p?.percent ?? 0) }),
  );
  updater().on("update-downloaded", (info) => {
    log.info("[updater] indirildi", info?.version);
    publish({ state: "ready", newVersion: info?.version, percent: 100, error: undefined });
  });
  updater().on("error", (err) => {
    log.error("[updater] hata", err);
    publish({ state: "error", error: toTurkishError(err) });
  });

  setTimeout(() => void check(), UPDATE_FIRST_CHECK_DELAY_MS);
  setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
}
