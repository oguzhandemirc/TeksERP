// =============================================================================
// PPLB (Argox PPLB / Eltron EPL2) raster zarfı — 1bpp bitmap'i GW (Print Immediate
// Graphics) ile sarar
// =============================================================================
// Format (ARGOX PPLB manueli PPLB_Text_EN.pdf): `GWp1,p2,p3,p4,DATA` — p4 SONRASI
// VİRGÜL VAR, sonra ham veri. ⚠ Zebra EPL2'de p4 sonrası virgül YOK; ilk sürüm onu
// izliyordu → Argox virgülsüz GW'yi yanlış ayrıştırıp BOŞ basıyordu (fiziksel bulgu).
// p1=x dot, p2=y dot, p3=BAYT genişliği (=rowBytes), p4=piksel yüksekliği. DATA = p3×p4
// ham bayt satır-satır sıkıştırmasız. Manuel: "1=boş piksel, 0=siyah piksel". Baytlar
// Buffer.concat ile birleşir — binary blok HİÇBİR string/regex/CRLF yolundan geçmez.
// =============================================================================

import { Bitmap1 } from "./raster-bitmap";
import { mmToDots, clampCopies } from "../native-label.shared";
import type { ResolvedLabelFormat } from "../label-format.resolver";

const CRLF = "\r\n";

/** Argox PPLB GW polaritesi: manuel (PPLB_Text_EN.pdf) "1=boş piksel, 0=siyah piksel".
 *  İç bitmap 1=siyah olduğundan bitler INVERT edilir (siyah→0, beyaz→1) → manuelle uyumlu.
 *  Yine de fiziksel testte NEGATİF (siyah zemin) çıkarsa false yap — tek satır. */
export const GW_ONE_IS_WHITE = true;

/** PPLB raster (GW bitmap) — Argox PPLB manueline göre GW komutunun p4 SONRASI VİRGÜLÜ
 *  eklendi (ilk sürüm Zebra EPL2 formatını izliyordu, virgülsüz → Argox BOŞ basıyordu;
 *  komut yolu aynı N/q/Q/D header'ıyla sorunsuz bastığı için fark yalnız GW'deydi).
 *  Polarite de manuelle doğrulandı. Fiziksel doğrulama için AÇIK. Argox'ta yine boş
 *  çıkarsa false yap → registry emitCanvasPplb komut yoluna GÜVENLE düşer (baskı ölmez).
 *  Bkz. [[argox-ppla-spec]] (kardeş PPLB manueli) ve docs/ops/RASTER-F6-FIZIKSEL-CHECKLIST.md. */
export const PPLB_RASTER_VERIFIED = true;

export class PplbRasterUnsupportedError extends Error {
  constructor() {
    super("PPLB raster GW grafik komutu henüz fiziksel doğrulanmadı (Argox PPLB boş basıyor — F6 bekliyor)");
    this.name = "PplbRasterUnsupportedError";
  }
}

/** TEK GW komut bloğu (Buffer) — `GWx,y,rowBytes,height,` + polarite-düzeltilmiş ham
 *  bayt. Argox PPLB manueli: p4 SONRASI VİRGÜL, sonra p3×p4 ham bayt (yazıcı tam bu
 *  kadar okur → içindeki CR/LF veri sayılır, komut sınırı sanılmaz). Polarite manuel:
 *  1=boş, 0=siyah → iç bitmap (1=siyah) INVERT edilir. Hem tam-raster zarfı hem hibrit
 *  ikon (emitCanvasPplb — bloğu latin1 string olarak native komut akışına gömer; transport
 *  latin1→bayt birebir round-trip) BUNU paylaşır → GW kodlaması + polarite TEK KAYNAK. */
export function pplbGwBlock(bmp: Bitmap1, xDots: number, yDots: number): Buffer {
  const img = Buffer.from(bmp.data);
  if (GW_ONE_IS_WHITE) {
    for (let i = 0; i < img.length; i++) img[i] = ~img[i] & 0xff;
  }
  const head = Buffer.from(`GW${xDots},${yDots},${bmp.rowBytes},${bmp.heightDots},`, "latin1");
  return Buffer.concat([head, img]);
}

export function wrapPplbRaster(bmp: Bitmap1, format: ResolvedLabelFormat, copies: number): Buffer {
  // Doğrulanmadıkça komuta düş (registry try/catch yakalar → emitCanvasPplb native yolu).
  if (!PPLB_RASTER_VERIFIED) throw new PplbRasterUnsupportedError();
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);

  const head = Buffer.from(
    "N" + CRLF +
      `q${d(format.widthMm)}` + CRLF +
      `Q${d(format.heightMm)},${d(format.gapMm)}` + CRLF +
      "D8" + CRLF,
    "latin1",
  );
  const gw = pplbGwBlock(bmp, 0, 0); // tüm etiket tek GW bloğu (0,0)
  const tail = Buffer.from(CRLF + `P${clampCopies(copies)}` + CRLF, "latin1");
  return Buffer.concat([head, gw, tail]);
}
