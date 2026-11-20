import { BrowserWindow } from "electron";
import { handleTrusted, onTrusted } from "../security/trusted-ipc.js";

export function registerWindowIpc(): void {
  onTrusted("window:minimize", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize(),
  );
  onTrusted("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  onTrusted("window:close", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
  handleTrusted("window:is-maximized", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  );
}
