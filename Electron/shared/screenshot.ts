/**
 * Destek talebi ekran görüntüsü (3d-2) — yalnız PANEL PENCERESİ yakalanır (masaüstü değil).
 * Backend ≤700 KB kabul eder (base64 hâli 1 MB genel gövde sınırına sığsın); panel payla 600 KB'a sıkıştırır.
 * Kodlama seçimi SAF: main süreç NativeImage'la `encode`u sağlar, test sahte kodlayıcıyla koşar.
 */
export const SCREENSHOT_MAX_BYTES = 600 * 1024;
export const SCREENSHOT_WIDTHS = [1600, 1280, 960] as const;
export const SCREENSHOT_QUALITIES = [80, 65, 50, 35] as const;

export interface ScreenshotResult {
  readonly tur: "image/jpeg";
  /** base64 (JPEG baytları). */
  readonly veri: string;
}

/** En geniş + en kaliteli, sınırın altındaki kodlamayı seçer; hiçbiri sığmazsa null. */
export function pickScreenshotEncoding(
  encode: (width: number, quality: number) => Uint8Array,
  sourceWidth: number,
  maxBytes: number = SCREENSHOT_MAX_BYTES,
): Uint8Array | null {
  const widths = [...new Set(SCREENSHOT_WIDTHS.map((w) => Math.min(w, Math.max(1, Math.floor(sourceWidth)))))];
  for (const width of widths) {
    for (const quality of SCREENSHOT_QUALITIES) {
      const bytes = encode(width, quality);
      if (bytes.length > 0 && bytes.length <= maxBytes) return bytes;
    }
  }
  return null;
}
