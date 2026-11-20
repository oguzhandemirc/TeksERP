import { BrowserWindow } from "electron";
import { handleTrusted } from "../security/trusted-ipc.js";
import type { ScreenCaptureResult } from "@shared/ipc-contract";

/** Destek ekinin üst sınırı: merkez de görselleri 1920 px'e indirir; büyüğünü taşımak boşa bayttır. */
const MAX_EDGE = 1920;

/**
 * `screen:capture` — İSTEYEN pencerenin (event.sender) içeriğini yakalar. Girdi almaz: hangi pencerenin
 * yakalanacağını renderer seçemez, başka bir pencerenin görüntüsü bu kanaldan çıkamaz.
 */
export function registerScreenIpc(): void {
  handleTrusted("screen:capture", async (event): Promise<ScreenCaptureResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    let image = await win.webContents.capturePage();
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const longEdge = Math.max(width, height);
    if (longEdge > MAX_EDGE) {
      const scale = MAX_EDGE / longEdge;
      image = image.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        quality: "good",
      });
    }
    const size = image.getSize();
    return { dataBase64: image.toPNG().toString("base64"), width: size.width, height: size.height };
  });
}
