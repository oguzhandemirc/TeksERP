#!/usr/bin/env node
// YER TUTUCU uygulama görselleri — kullanıcı onaylı nihai görsel gelene kadar (2026-10-15). Tablet markasının
// (mobil/assets/logo-front-512.png) aynısı; "Patron" ayrımı için koyu zemin + altın halka. Çıktı assets/ altına,
// commit'lenir; nihai görsel gelince bu betik değil dosyalar değişir. Koşum: node scripts/yer-tutucu-gorsel.cjs
const path = require("node:path");
const Jimp = require("jimp-compact");

const KOK = path.join(__dirname, "..");
const LOGO = path.join(KOK, "..", "..", "mobil", "assets", "logo-front-512.png");
const ZEMIN = 0x161c2bff; // koyu lacivert-antrasit (tablet zemini #181D31'e yakın, daha koyu)
const ALTIN = [0xc9, 0xa2, 0x27];

function halka(img, merkez, yaricap, kalinlik) {
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, i) {
    const d = Math.hypot(x + 0.5 - merkez, y + 0.5 - merkez);
    const a = Math.max(0, Math.min(1, kalinlik / 2 + 0.5 - Math.abs(d - yaricap)));
    if (a <= 0) return;
    const b = this.bitmap.data;
    const eskiA = b[i + 3] / 255;
    const yeniA = a + eskiA * (1 - a);
    for (let k = 0; k < 3; k++) b[i + k] = Math.round((ALTIN[k] * a + b[i + k] * eskiA * (1 - a)) / (yeniA || 1));
    b[i + 3] = Math.round(yeniA * 255);
  });
}

async function logo(boyut) {
  return (await Jimp.read(LOGO)).resize(boyut, boyut, Jimp.RESIZE_BICUBIC);
}

async function main() {
  // 1) Klasik ikon (1024, opak): zemin + halka + logo.
  const ikon = new Jimp(1024, 1024, ZEMIN);
  halka(ikon, 512, 440, 28);
  ikon.composite(await logo(760), 132, 120);
  await ikon.writeAsync(path.join(KOK, "assets", "icon.png"));

  // 2) Uyarlanır ikon ön yüzü (1024, saydam): güvenli alan merkezdeki %66 — halka r=300, logo 520.
  const on = new Jimp(1024, 1024, 0x00000000);
  halka(on, 512, 300, 22);
  on.composite(await logo(520), 252, 240);
  await on.writeAsync(path.join(KOK, "assets", "adaptive-icon.png"));

  // 3) Uyarlanır ikon tek renk katmanı (Android 13 temalı ikon): ön yüzün alfa maskesi, beyaz.
  const tek = on.clone();
  tek.scan(0, 0, 1024, 1024, function (_x, _y, i) {
    this.bitmap.data[i] = this.bitmap.data[i + 1] = this.bitmap.data[i + 2] = 255;
  });
  await tek.writeAsync(path.join(KOK, "assets", "adaptive-icon-monochrome.png"));

  // 4) Açılış ekranı görseli (saydam; zemin rengi app.json'da).
  const acilis = new Jimp(512, 512, 0x00000000);
  halka(acilis, 256, 236, 14);
  acilis.composite(await logo(400), 56, 50);
  await acilis.writeAsync(path.join(KOK, "assets", "splash-icon.png"));
  // 5) Play mağaza görselleri (uygulamaya girmez): yüksek çözünürlüklü ikon 512 · öne çıkan görsel 1024x500.
  await ikon.clone().resize(512, 512, Jimp.RESIZE_BICUBIC).writeAsync(path.join(KOK, "assets", "magaza", "ikon-512.png"));
  const one = new Jimp(1024, 500, ZEMIN);
  const rozet = new Jimp(440, 440, 0x00000000);
  halka(rozet, 220, 200, 12);
  rozet.composite(await logo(340), 50, 44);
  one.composite(rozet, 292, 30);
  await one.writeAsync(path.join(KOK, "assets", "magaza", "one-cikan-1024x500.png"));
  console.log("yer tutucu görseller yazıldı: assets/{icon,adaptive-icon,adaptive-icon-monochrome,splash-icon}.png + assets/magaza/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
