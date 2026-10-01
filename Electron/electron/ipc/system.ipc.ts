import { shell } from "electron";
import log from "electron-log/main.js";
import { isShowableLocalPath } from "@shared/shell-policy";
import { handleTrusted, onTrusted } from "../security/trusted-ipc.js";
import { openExternalSafely } from "../security/external-open.js";

export function registerSystemIpc(): void {
  // Yalnız beyanlı https listesi (eskiden her http/https adresi açılıyordu).
  handleTrusted("system:open-external", async (_e, url: unknown) => {
    if (!(await openExternalSafely(url, "system:open-external"))) throw new Error("Invalid URL");
  });
  onTrusted("system:show-in-folder", (_e, target: unknown) => {
    if (!isShowableLocalPath(target)) {
      log.warn("[guvenlik] klasörde gösterme reddedildi (yerel mutlak yol değil)");
      return;
    }
    shell.showItemInFolder(target);
  });
}
