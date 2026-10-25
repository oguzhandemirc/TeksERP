// =============================================================================
// Bildirim — işletim sistemi bildirimi + görev çubuğu rozeti (genel kanal; tezgah alarmı da
// aynı sunucuyu kullanır). Pencere öndeyken OS bildirimi çıkmaz (renderer kendi tostunu gösterir);
// tıklamada İSTEYEN pencere öne gelir ve renderer'a yalnız doğrulanmış kimlik + göreli yol gider.
// =============================================================================
import path from "node:path";
import { app, BrowserWindow, nativeImage, Notification, type IpcMainInvokeEvent, type NativeImage } from "electron";
import log from "electron-log/main.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import { shouldShowOsNotification } from "@shared/loom-alarm-notify";
import {
  BILDIRIM_BADGE_CHANNEL,
  BILDIRIM_NOTIFY_CHANNEL,
  BILDIRIM_OPEN_CHANNEL,
  overlayDescription,
  overlayIconFile,
  overlayIconKey,
  parseBildirimNotifyRequest,
  parseBildirimRozetRequest,
  type BildirimNotifyResult,
} from "@shared/bildirim-notify";

type Sender = Pick<IpcMainInvokeEvent, "sender">;
export type OsNotifyResult = { shown: true } | { shown: false; reason: "invalid" | "focused" | "unsupported" };

// Gösterilen bildirimler çöpe gitmesin (tıklama dinleyicisi kaybolurdu); kapanınca bırakılır.
const live = new Set<Notification>();

function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Ortak sunucu: pencere arkadaysa sessiz OS bildirimi; tıklamada pencere öne + `onClick(win)`. */
export function presentOsNotification(
  event: Sender,
  text: { title: string; body: string },
  onClick: (win: BrowserWindow) => void,
): OsNotifyResult {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { shown: false, reason: "invalid" };
  if (!shouldShowOsNotification({ focused: win.isFocused(), minimized: win.isMinimized(), visible: win.isVisible() })) {
    return { shown: false, reason: "focused" };
  }
  if (!Notification.isSupported()) return { shown: false, reason: "unsupported" };
  // Sesi renderer çalar (kullanıcı tercihi) — bildirim sessizdir, çift ses olmasın.
  const n = new Notification({ title: text.title, body: text.body, silent: true });
  const release = () => live.delete(n);
  n.on("click", () => {
    release();
    if (win.isDestroyed()) return;
    bringToFront(win);
    onClick(win);
  });
  n.on("close", release);
  live.add(n);
  n.show();
  return { shown: true };
}

export function showBildirimNotification(event: Sender, raw: unknown): BildirimNotifyResult {
  const req = parseBildirimNotifyRequest(raw);
  if (!req) {
    log.warn("[bildirim] geçersiz OS bildirimi isteği reddedildi");
    return { shown: false, reason: "invalid" };
  }
  return presentOsNotification(event, { title: req.baslik, body: req.govde ?? "" }, (win) =>
    win.webContents.send(BILDIRIM_OPEN_CHANNEL, { bildirimId: req.bildirimId, yol: req.yol }),
  );
}

let overlayDir = "";
const overlayCache = new Map<string, NativeImage>();
const flashing = new WeakSet<BrowserWindow>();

function overlayImage(key: string): NativeImage | null {
  const hit = overlayCache.get(key);
  if (hit) return hit;
  const img = nativeImage.createFromPath(path.join(overlayDir, overlayIconFile(key)));
  if (img.isEmpty()) return null;
  overlayCache.set(key, img);
  return img;
}

/** Rozet: Windows overlay ikonu (1..9, 9+) + alarmda yanıp sönme; macOS/Linux dock/launcher sayısı. */
export function applyBildirimBadge(event: Sender, raw: unknown, platform: NodeJS.Platform = process.platform): boolean {
  const req = parseBildirimRozetRequest(raw);
  if (!req) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (platform === "win32") {
    const key = overlayIconKey(req.okunmamis);
    win.setOverlayIcon(key ? overlayImage(key) : null, overlayDescription(req.okunmamis));
  } else {
    app.setBadgeCount(req.okunmamis);
  }
  // Aynı durumu tekrar yollamak yanıp sönmeyi yeniden başlatmasın.
  if (req.alarm !== flashing.has(win)) {
    win.flashFrame(req.alarm);
    if (req.alarm) flashing.add(win);
    else flashing.delete(win);
  }
  return true;
}

export function registerBildirimNotifyIpc(opts: { overlayDir: string }): void {
  overlayDir = opts.overlayDir;
  handleTrusted(BILDIRIM_NOTIFY_CHANNEL, (event, raw: unknown) => showBildirimNotification(event, raw));
  handleTrusted(BILDIRIM_BADGE_CHANNEL, (event, raw: unknown) => applyBildirimBadge(event, raw));
}
