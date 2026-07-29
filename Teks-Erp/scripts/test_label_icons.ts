// Etiket ikon testi (DB'siz): kayıt defteri bütünlüğü (benzersiz anahtar, geçerli
// kategori), labelIconSvg çıktısı (<svg + metin içerikleri), renderIconBitmap ink
// oranı (%2-%60 — hem bomboş hem simsiyah hatayı yakalar), rot=90 blit sınır testi,
// bilinmeyen anahtar davranışı. Koş: npx tsx scripts/test_label_icons.ts
// (Font CWD/assets/fonts'tan yüklenir — Teks-Erp kökünden çalıştır.)

import {
  LABEL_ICONS,
  LABEL_ICON_CATEGORIES,
  getLabelIcon,
  labelIconKeys,
  labelIconSvg,
} from "../src/config/label-icons";
import { renderIconBitmap, drawIconOnBitmap } from "../src/services/helpers/raster/raster-icon";
import { Bitmap1 } from "../src/services/helpers/raster/raster-bitmap";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

function totalInk(bmp: Bitmap1): number {
  let n = 0;
  for (let y = 0; y < bmp.heightDots; y++) for (let x = 0; x < bmp.widthDots; x++) if (bmp.get(x, y)) n++;
  return n;
}

/** (x,y,w,h) bölgesi DIŞINDA siyah piksel sayısı (blit sınır testi). */
function inkOutside(bmp: Bitmap1, x: number, y: number, w: number, h: number): number {
  let n = 0;
  for (let yy = 0; yy < bmp.heightDots; yy++) {
    for (let xx = 0; xx < bmp.widthDots; xx++) {
      if (bmp.get(xx, yy) && (xx < x || xx >= x + w || yy < y || yy >= y + h)) n++;
    }
  }
  return n;
}

async function main(): Promise<void> {
  const SIZE = 96;
  const catKeys = new Set(LABEL_ICON_CATEGORIES.map((c) => c.key));

  // --- Kayıt defteri bütünlüğü ---
  const keys = labelIconKeys();
  check("kayıt defteri boş değil", LABEL_ICONS.length >= 20, `${LABEL_ICONS.length} ikon`);
  check("anahtarlar benzersiz", new Set(keys).size === keys.length);
  check("her ikonun kategorisi LABEL_ICON_CATEGORIES'te",
    LABEL_ICONS.every((d) => catKeys.has(d.category)));
  check("getLabelIcon bilinen anahtarı bulur", getLabelIcon(keys[0])?.key === keys[0]);

  // --- Bilinmeyen anahtar davranışı ---
  check("labelIconSvg bilinmeyen anahtar → null", labelIconSvg("yok-boyle-ikon") === null);
  let threw = false;
  let msg = "";
  try {
    await renderIconBitmap("yok-boyle-ikon", SIZE);
  } catch (e) {
    threw = true;
    msg = (e as Error).message;
  }
  check("renderIconBitmap bilinmeyen anahtar → Türkçe Error", threw && msg.includes("Bilinmeyen etiket ikonu"), msg);

  // --- Her ikon: SVG + ink oranı + rot=90 sınır ---
  for (const def of LABEL_ICONS) {
    const svg = labelIconSvg(def.key);
    const texts = def.prims.filter((p) => p.t === "text").map((p) => (p as { s: string }).s);
    const svgOk = svg != null && svg.includes("<svg") && texts.every((t) => svg.includes(t));
    check(`${def.key}: SVG geçerli (<svg${texts.length ? " + metin" : ""})`, svgOk);

    const bmp = await renderIconBitmap(def.key, SIZE);
    const ink = totalInk(bmp);
    const ratio = ink / (SIZE * SIZE);
    check(`${def.key}: ink oranı makul (%2-%60)`, ratio >= 0.02 && ratio <= 0.6, `%${(ratio * 100).toFixed(1)}`);

    const target = new Bitmap1(SIZE + 20, SIZE + 20);
    await drawIconOnBitmap(target, def.key, 10, 10, SIZE, 90);
    const tInk = totalInk(target);
    check(`${def.key}: rot=90 blit sınır içinde ve kayıpsız`,
      inkOutside(target, 10, 10, SIZE, SIZE) === 0 && tInk === ink, `${tInk} px`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ Beklenmeyen hata:", e);
  process.exit(1);
});
