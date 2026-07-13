// Raster kanvas testi (DB'siz): rasterizeCanvasLayout — 7 eleman tipi, present:false
// atlama (konum kaymaz), tam-dot barkod, QR, banner ters, box çerçeve, 300dpi orantı.
// Koş: npx tsx scripts/test_raster_canvas.ts

import { mmToDots } from "../src/services/helpers/native-label.shared";
import { rasterizeCanvasLayout } from "../src/services/helpers/raster/raster-canvas";
import type { CanvasRenderInput } from "../src/services/helpers/label-canvas-native.helper";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { CanvasLayout } from "../src/config/label-elements";
import type { LabelPayload } from "../src/services/label.service";
import type { Bitmap1 } from "../src/services/helpers/raster/raster-bitmap";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const format: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 60, marginMm: 3,
  marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3, gapMm: 2,
  orientation: "LANDSCAPE" as never, dpi: 203, language: "PPLB" as never, source: "machine" as never,
};
const payload = {
  barcode: "TEKS20260706AB12", qualityGrade: "1.KALITE", widthCm: 150,
  lengthMeters: 320, weightKg: 40, itemName: "PATOS", colorName: "MAVİ",
  customerName: "Şahin Tekstil", batchNumber: "P-1",
} as unknown as LabelPayload;
const layout: CanvasLayout = {
  v: 1,
  elements: [
    { id: "qr", type: "qr", x: 3, y: 3, scale: 6 },
    { id: "t1", type: "field", bind: "itemName", x: 30, y: 3, font: "lg", bold: true },
    { id: "t2", type: "field", bind: "customerName", label: "Müşteri", x: 30, y: 12 },
    { id: "t3", type: "text", text: "SABİT NOT", x: 30, y: 20, rot: 90 },
    { id: "ln", type: "line", x: 3, y: 30, wMm: 90, hMm: 0.8 },
    { id: "bx", type: "box", x: 3, y: 32, wMm: 40, hMm: 10, thickMm: 1 },
    { id: "bn", type: "lengthBanner", x: 88, y: 3, wMm: 9, hMm: 50 },
    { id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true },
  ],
};
function mk(input?: Partial<CanvasRenderInput>): CanvasRenderInput {
  return { payload, format, copies: 2, layout, ...input };
}

/** mm-bölgesindeki siyah piksel sayısı. */
function regionInk(bmp: Bitmap1, xMm: number, yMm: number, wMm: number, hMm: number, dpi = 203): number {
  const d = (mm: number) => mmToDots(mm, dpi);
  let n = 0;
  const x1 = d(xMm), y1 = d(yMm), x2 = d(xMm + wMm), y2 = d(yMm + hMm);
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (bmp.get(x, y)) n++;
  return n;
}
function totalInk(bmp: Bitmap1): number {
  let n = 0;
  for (let y = 0; y < bmp.heightDots; y++) for (let x = 0; x < bmp.widthDots; x++) if (bmp.get(x, y)) n++;
  return n;
}

const bmp = rasterizeCanvasLayout(mk());

// --- Tuval boyutu = yazıcı DPI'ında mm→dot ---
check("tuval boyutu 799×480 (100×60mm@203dpi)", bmp.widthDots === mmToDots(100, 203) && bmp.heightDots === mmToDots(60, 203),
  `${bmp.widthDots}×${bmp.heightDots}`);
check("toplam ink anlamlı (>2000 px)", totalInk(bmp) > 2000, `${totalInk(bmp)} px`);

// --- Her eleman iz bırakır (bölge bazlı) ---
check("qr iz bırakır (sol-üst)", regionInk(bmp, 3, 3, 18, 18) > 100);
check("field t1 (ürün adı, x30y3) iz bırakır", regionInk(bmp, 30, 3, 40, 6) > 30);
check("text t3 (dikey, x30y20) iz bırakır", regionInk(bmp, 30, 20, 8, 30) > 20);
check("line (x3y30 90×0.8mm) iz bırakır", regionInk(bmp, 3, 30, 90, 1) > 100);
check("code128 (alt, x3y46) iz bırakır", regionInk(bmp, 3, 46, 90, 9) > 200);

// --- box: çerçeve siyah, iç boş ---
check("box çerçeve kenarı siyah (x3y32)", regionInk(bmp, 3, 32, 40, 1) > 20);
check("box iç boş (merkez ~x20y37)", regionInk(bmp, 18, 36, 8, 2) === 0);

// --- lengthBanner: siyah bant + ters (beyaz) değer içinde ---
{
  const bandTotal = mmToDots(9, 203) * mmToDots(50, 203);
  const bandInk = regionInk(bmp, 88, 3, 9, 50);
  check("lengthBanner çoğunlukla siyah zemin", bandInk > bandTotal * 0.4, `${bandInk}/${bandTotal}`);
  check("lengthBanner içinde beyaz değer (bant tam dolu DEĞİL)", bandInk < bandTotal, "ters değer deldi");
}

// --- present:false atlama: customerName yoksa t2 düşer, DİĞERLERİ kaymaz ---
{
  const noCust = { ...payload, customerName: undefined } as unknown as LabelPayload;
  const bmp2 = rasterizeCanvasLayout(mk({ payload: noCust }));
  check("customerName yok → toplam ink azalır (t2 düştü)", totalInk(bmp2) < totalInk(bmp));
  check("t2 bölgesi (x30y12) boşaldı", regionInk(bmp2, 30, 12, 40, 6) === 0);
  check("QR bölgesi DEĞİŞMEDİ (konum kaymadı)", regionInk(bmp2, 3, 3, 18, 18) === regionInk(bmp, 3, 3, 18, 18));
  check("barkod bölgesi DEĞİŞMEDİ (konum kaymadı)", regionInk(bmp2, 3, 46, 90, 9) === regionInk(bmp, 3, 46, 90, 9));
}

// --- 300dpi: aynı şablon orantılı büyür ---
{
  const bmp300 = rasterizeCanvasLayout(mk({ format: { ...format, dpi: 300 } }));
  check("300dpi tuval büyür", bmp300.widthDots === mmToDots(100, 300) && bmp300.heightDots === mmToDots(60, 300),
    `${bmp300.widthDots}×${bmp300.heightDots}`);
  check("300dpi ink 203dpi'dan fazla (daha çok piksel)", totalInk(bmp300) > totalInk(bmp));
}

// --- barkodsuz payload: qr/code128 atlanır, çökme yok ---
{
  const noBc = { ...payload, barcode: undefined } as unknown as LabelPayload;
  const b = rasterizeCanvasLayout(mk({ payload: noBc }));
  check("barkodsuz: QR bölgesi boş", regionInk(b, 3, 3, 18, 18) === 0);
  check("barkodsuz: yine de metin/line/box var (çökmedi)", totalInk(b) > 200);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
