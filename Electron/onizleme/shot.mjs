// Ekran görüntüsü alıcı (YALNIZ GELİŞTİRME): node Electron/onizleme/shot.mjs <çıktı-dizini> [sonek] (görüntüler: docs/design/dokuma-canli-ekran/)
// Önce önizleme sunucusu (vite.onizleme.config.mjs, port 5391) açık olmalı.
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium } = require("playwright");

const [out, suffix = ""] = process.argv.slice(2);
const URL_BASE = "http://localhost:5391/preview-weaving-floor.html";
const browser = await chromium.launch();
const errors = [];
async function open(theme, w, h, extra = "") {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(`${URL_BASE}?tema=${theme}${extra}`);
  await p.waitForSelector("button[aria-label^='Tezgah']");
  await p.waitForTimeout(1500);
  return p;
}
const noScroll = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }));

let p = await open("acik", 1600, 1000);
await p.screenshot({ path: `${out}/01-salon-acik${suffix}.png` });
const escalated = p.locator("button[aria-label*='Patrona iletildi']").first();
await ((await escalated.count()) ? escalated : p.locator("button[aria-label*='duruyor']").first()).click();
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/03-duran-detay-acik${suffix}.png` });
await p.close();

p = await open("koyu", 1600, 1000);
await p.screenshot({ path: `${out}/02-salon-koyu${suffix}.png` });
await p.close();

p = await open("acik", 1100, 800);
await p.screenshot({ path: `${out}/04-dar-pencere${suffix}.png` });
console.log("1100x800", JSON.stringify(await noScroll(p)));
await p.close();

p = await open("koyu", 1920, 1080);
await p.getByRole("button", { name: "Tam ekran" }).click();
await p.waitForTimeout(800);
const fs = await p.evaluate(() => {
  const root = document.querySelector(".fixed.inset-0");
  return root ? { sh: root.scrollHeight, ch: root.clientHeight } : null;
});
console.log("tam ekran kök", JSON.stringify(fs));
await p.screenshot({ path: `${out}/05-tam-ekran-koyu${suffix}.png` });
await p.close();

// TV kipi: ayrı bağlantı (?kip=tv) — açılışta tam ekran, düğme/çıkış yok.
p = await open("koyu", 1920, 1080, "&kip=tv");
const tv = await p.evaluate(() => {
  const root = document.querySelector(".fixed.inset-0");
  const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((t) => t && !t.startsWith("Tezgah"));
  return root ? { sh: root.scrollHeight, ch: root.clientHeight, buttons: buttons.filter((t) => !/^\d/.test(t)) } : null;
});
console.log("tv kipi kök", JSON.stringify(tv));
await p.screenshot({ path: `${out}/06-tv-kipi-koyu${suffix}.png` });
await p.close();

await browser.close();
console.log(errors.length ? "HATALAR:\n" + [...new Set(errors)].join("\n") : "hata yok");
