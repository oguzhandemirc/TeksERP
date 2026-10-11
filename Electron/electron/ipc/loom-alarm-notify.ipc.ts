// =============================================================================
// Tezgah alarmı — işletim sistemi bildirimi (Windows + macOS). Pencere öndeyken çıkmaz;
// tıklamada İSTEYEN pencere öne gelir ve renderer'a yalnız alarm kimliği gider.
// Sesi renderer çalar (kullanıcı tercihi) — bildirim sessizdir, çift ses olmasın.
// =============================================================================
import { BrowserWindow, Notification, type IpcMainInvokeEvent } from "electron";
import log from "electron-log/main.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import {
  LOOM_ALARM_NOTIFY_CHANNEL,
  LOOM_ALARM_OPEN_CHANNEL,
  parseLoomAlarmNotifyRequest,
  shouldShowOsNotification,
  type LoomAlarmNotifyResult,
} from "@shared/loom-alarm-notify";

// Gösterilen bildirimler çöpe gitmesin (tıklama dinleyicisi kaybolurdu); kapanınca bırakılır.
const live = new Set<Notification>();

function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function showLoomAlarmNotification(event: Pick<IpcMainInvokeEvent, "sender">, raw: unknown): LoomAlarmNotifyResult {
  const req = parseLoomAlarmNotifyRequest(raw);
  if (!req) {
    log.warn("[alarm-bildirimi] geçersiz istek reddedildi");
    return { shown: false, reason: "invalid" };
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { shown: false, reason: "invalid" };
  if (!shouldShowOsNotification({ focused: win.isFocused(), minimized: win.isMinimized(), visible: win.isVisible() })) {
    return { shown: false, reason: "focused" };
  }
  if (!Notification.isSupported()) return { shown: false, reason: "unsupported" };

  const n = new Notification({ title: req.title, body: req.body, silent: true });
  const release = () => live.delete(n);
  n.on("click", () => {
    release();
    if (win.isDestroyed()) return;
    bringToFront(win);
    win.webContents.send(LOOM_ALARM_OPEN_CHANNEL, { alarmId: req.alarmId });
  });
  n.on("close", release);
  live.add(n);
  n.show();
  return { shown: true };
}

export function registerLoomAlarmNotifyIpc(): void {
  handleTrusted(LOOM_ALARM_NOTIFY_CHANNEL, (event, raw: unknown) => showLoomAlarmNotification(event, raw));
}
