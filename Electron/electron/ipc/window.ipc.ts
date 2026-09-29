import { BrowserWindow, ipcMain } from "electron";
import { pickScreenshotEncoding, type ScreenshotResult } from "@shared/screenshot";

export function registerWindowIpc(): void {
  ipcMain.on("window:minimize", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize(),
  );
  ipcMain.on("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:close", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
  ipcMain.handle("window:is-maximized", (event) =>
    BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  );
  // Destek ekran görüntüsü: yalnız isteyen pencere (masaüstü değil); boyut sınırı saf seçicide.
  ipcMain.handle("window:capture-screenshot", async (event): Promise<ScreenshotResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) return null;
    const { width } = image.getSize();
    const bytes = pickScreenshotEncoding(
      (w, quality) => (w >= width ? image : image.resize({ width: w, quality: "good" })).toJPEG(quality),
      width,
    );
    return bytes ? { tur: "image/jpeg", veri: Buffer.from(bytes).toString("base64") } : null;
  });
}
