// Windows görev çubuğu overlay ikonları (okunmamış bildirim: 1..9, 9+) — 16 px + @2x 32 px PNG.
// Yeni paket yok: mevcut Playwright Chromium'unun canvas'ı çizer. Koşum (Electron/): node resources/overlay/uret.mjs
/* global document, Buffer, console */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const out = path.dirname(fileURLToPath(import.meta.url));
const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+"];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const key of keys) {
  for (const scale of [1, 2]) {
    const data = await page.evaluate(
      ({ key, scale }) => {
        const s = 16 * scale;
        const c = document.createElement("canvas");
        c.width = s;
        c.height = s;
        const g = c.getContext("2d");
        g.fillStyle = "#dc2626";
        g.beginPath();
        g.arc(s / 2, s / 2, s / 2 - 0.5 * scale, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#ffffff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `bold ${(key.length > 1 ? 9 : 12) * scale}px Arial, Helvetica, sans-serif`;
        g.fillText(key, s / 2, s / 2 + 0.5 * scale);
        return c.toDataURL("image/png").split(",")[1];
      },
      { key, scale },
    );
    const name = `${key === "9+" ? "9plus" : key}${scale === 2 ? "@2x" : ""}.png`;
    writeFileSync(path.join(out, name), Buffer.from(data, "base64"));
  }
}
await browser.close();
console.log(`overlay: ${keys.length * 2} dosya → ${out}`);
