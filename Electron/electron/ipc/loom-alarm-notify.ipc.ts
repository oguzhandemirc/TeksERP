// =============================================================================
// Tezgah alarmı — işletim sistemi bildirimi (Windows + macOS). Eski renderer sürümleri için
// kanal AYNEN kalır; gösterim genel sunucudan (`bildirim-notify.ipc.ts#presentOsNotification`).
// Tıklamada renderer'a yalnız alarm kimliği gider (adres taşınmaz).
// =============================================================================
import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log/main.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import { presentOsNotification } from "./bildirim-notify.ipc.js";
import {
  LOOM_ALARM_NOTIFY_CHANNEL,
  LOOM_ALARM_OPEN_CHANNEL,
  parseLoomAlarmNotifyRequest,
  type LoomAlarmNotifyResult,
} from "@shared/loom-alarm-notify";

export function showLoomAlarmNotification(event: Pick<IpcMainInvokeEvent, "sender">, raw: unknown): LoomAlarmNotifyResult {
  const req = parseLoomAlarmNotifyRequest(raw);
  if (!req) {
    log.warn("[alarm-bildirimi] geçersiz istek reddedildi");
    return { shown: false, reason: "invalid" };
  }
  return presentOsNotification(event, { title: req.title, body: req.body }, (win) =>
    win.webContents.send(LOOM_ALARM_OPEN_CHANNEL, { alarmId: req.alarmId }),
  );
}

export function registerLoomAlarmNotifyIpc(): void {
  handleTrusted(LOOM_ALARM_NOTIFY_CHANNEL, (event, raw: unknown) => showLoomAlarmNotification(event, raw));
}
