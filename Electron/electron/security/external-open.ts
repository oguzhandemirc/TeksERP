// `shell.openExternal`ın TEK çağrı noktası: yalnız beyanlı https izin listesi
// (`@shared/shell-policy`). Reddedilen adres açılmaz, günlüğe düşer. PDF penceresi
// ve gezinme kapısı bunu ÇAĞIRMAZ — onlarda gezinme yalnız engellenir.
import { shell } from "electron";
import log from "electron-log/main.js";
import { isAllowedExternalUrl } from "@shared/shell-policy";

export async function openExternalSafely(url: unknown, source: string): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) {
    log.warn("[guvenlik] dış bağlantı reddedildi", { source, url: String(url).slice(0, 200) });
    return false;
  }
  await shell.openExternal(url);
  return true;
}
