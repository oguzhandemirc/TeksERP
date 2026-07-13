// Raster çekirdek testi (DB'siz): Bitmap1 primitifleri + rotate-blit + BMP kodlayıcı.
// Koş: npx tsx scripts/test_raster_bitmap.ts

import { Bitmap1 } from "../src/services/helpers/raster/raster-bitmap";
import { encodeBmp1, bmpDataUri } from "../src/services/helpers/raster/raster-bmp";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}`);
  }
}

// --- set/get + sınır kırpma ---
{
  const b = new Bitmap1(10, 6);
  b.set(3, 2);
  check("set/get tek piksel", b.get(3, 2) === true && b.get(3, 3) === false);
  b.set(3, 2, false);
  check("set false temizler", b.get(3, 2) === false);
  b.set(-1, -1); // sınır dışı — patlamaz
  b.set(100, 100);
  check("sınır dışı set yok sayılır", b.get(0, 0) === false);
  check("rowBytes width%8 (10→2)", b.rowBytes === 2);
}

// --- fillRect + kırpma ---
{
  const b = new Bitmap1(16, 8);
  b.fillRect(2, 1, 4, 3);
  check("fillRect köşeleri dolu", b.get(2, 1) && b.get(5, 3));
  check("fillRect dışı boş", !b.get(1, 1) && !b.get(6, 1) && !b.get(2, 4));
  b.fillRect(14, 6, 10, 10); // taşan — kırpılır
  check("fillRect taşma kırpılır", b.get(15, 7) === true);
}

// --- frameRect: çevre dolu, iç boş ---
{
  const b = new Bitmap1(12, 12);
  b.frameRect(1, 1, 8, 8, 1);
  check("frameRect üst kenar", b.get(1, 1) && b.get(8, 1));
  check("frameRect sol/sağ kenar", b.get(1, 4) && b.get(8, 4));
  check("frameRect iç boş", !b.get(4, 4));
}

// --- invertRect ---
{
  const b = new Bitmap1(8, 8);
  b.invertRect(0, 0, 4, 4);
  check("invertRect siyahlatır", b.get(0, 0) && b.get(3, 3));
  b.invertRect(0, 0, 4, 4);
  check("invertRect geri beyazlatır", !b.get(0, 0) && !b.get(3, 3));
}

// --- rotate-blit: tek köşe pikselinin dört yönde konumu ---
{
  // kaynak 3×2, sol-üst (0,0) işaretli
  const src = new Bitmap1(3, 2);
  src.set(0, 0);
  const mapped = (rot: 0 | 90 | 180 | 270): [number, number] | null => {
    const t = new Bitmap1(6, 6);
    t.blit(src, 0, 0, rot);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (t.get(x, y)) return [x, y];
    return null;
  };
  check("blit rot0 → (0,0)", JSON.stringify(mapped(0)) === JSON.stringify([0, 0]));
  check("blit rot90 → (1,0)", JSON.stringify(mapped(90)) === JSON.stringify([1, 0]));
  check("blit rot180 → (2,1)", JSON.stringify(mapped(180)) === JSON.stringify([2, 1]));
  check("blit rot270 → (0,2)", JSON.stringify(mapped(270)) === JSON.stringify([0, 2]));
}

// --- blit clear modu: siyah bant üstüne beyaz damga ---
{
  const t = new Bitmap1(8, 8);
  t.fillRect(0, 0, 8, 8); // tümü siyah
  const stamp = new Bitmap1(2, 2);
  stamp.set(0, 0);
  stamp.set(1, 1);
  t.blit(stamp, 0, 0, 0, "clear");
  check("blit clear beyazlatır", !t.get(0, 0) && !t.get(1, 1) && t.get(1, 0));
}

// --- BMP kodlayıcı: header + bottom-up + palet + MSB ---
{
  const b = new Bitmap1(8, 2);
  b.set(0, 0); // sol-üst
  const buf = encodeBmp1(b);
  const stride = ((8 + 31) >> 5) << 2; // = 4
  check("BMP 'BM' magic", buf[0] === 0x42 && buf[1] === 0x4d);
  check("BMP pixel offset 62", buf.readUInt32LE(10) === 62);
  check("BMP biBitCount=1", buf.readUInt16LE(28) === 1);
  check("BMP biHeight=2 (bottom-up +)", buf.readInt32LE(22) === 2);
  check("BMP palet[1]=siyah", buf.readUInt32LE(58) === 0x00000000);
  // Dosyada ilk satır = bitmap ALT satırı (y=1, boş) → 0x00; ikinci = üst (y=0) → 0x80
  check("BMP bottom-up: alt satır boş", buf[62] === 0x00);
  check("BMP bottom-up + MSB: üst satır 0x80", buf[62 + stride] === 0x80);
  check("BMP toplam boyut", buf.length === 62 + stride * 2);
}

// --- data-URI round-trip ---
{
  const b = new Bitmap1(8, 8);
  b.set(2, 2);
  const uri = bmpDataUri(b);
  check("dataUri prefix", uri.startsWith("data:image/bmp;base64,"));
  const decoded = Buffer.from(uri.split(",")[1], "base64");
  check("dataUri round-trip = encodeBmp1", decoded.equals(encodeBmp1(b)));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
