// =============================================================================
// Kanvas eleman modeli → 1bpp bitmap rasterize (raster boru hattının kalbi)
// =============================================================================
// Aynı CanvasRenderInput'u (label-canvas-native.helper) alır ama komut yerine tek
// bir Bitmap1 üretir → hem önizleme hem yazıcı AYNI pikseli görür (önizleme=baskı).
// CAPABILITY matrisi UYGULANMAZ: raster'da 7 eleman tipi de dört dilde birebir aynı
// çizilir (lengthBanner PPLA'da da dolgulu/ters çıkar — komut yolundaki çerçeve
// fallback'i burada YOK). Metin gerçek TTF glifi (Türkçe basılır; asciiFold YOK).
// =============================================================================

import { mmToDots, resolveQrScale, bannerValueText, alignOffsetDots } from "../native-label.shared";
import { fieldDisplayValue } from "../label-field-values";
import { elementText, type CanvasRenderInput } from "../label-canvas-native.helper";
import type { LabelPayload } from "../../../types/label.types";
import type { ResolvedLabelFormat } from "../label-format.resolver";
import { ICON_DEFAULT_MM, prepareElements, type CanvasRotation, type LengthBannerElement } from "../../../config/label-elements";
import { Bitmap1, rotatedSize } from "./raster-bitmap";
import { drawText, renderTextBitmap, measureText, rasterCleanText } from "./raster-text";
import { drawCode128, drawQr } from "./raster-barcode";
import { drawIconOnBitmap } from "./raster-icon";

/** hMm boş (eski 4-kademe) → büyük-harf hedef yüksekliği (mm). EPL_FONT cell mm'iyle
 *  görsel süreklilik; hMm dolu şablonlar bunu kullanmaz (o yol tam mm). Fiziksel
 *  kalibrasyon (F6) gerekirse tek yerden ayarlanır. */
const RASTER_FONT_MM: Record<string, number> = { sm: 1.5, md: 2.0, lg: 2.5, xl: 3.0 };
const DEFAULT_FONT_MM = 2.0;
/** Barkod ile okunur satır arası boşluk (mm) — native ile aynı. */
const BC_HUMAN_GAP_MM = 1;
/** Okunur satır büyük-harf yüksekliği (mm) — humanHMm yoksa. */
const HUMAN_DEFAULT_MM = 2.0;
/** lengthBanner varsayılan genişliği (mm) — native EPL xl.h×3 @203dpi eşdeğeri. */
const BANNER_DEFAULT_W_MM = 9;

/** ASYNC (2026-07 icon): drawIconOnBitmap async imzalı (içte sync) — zincir
 *  renderCanvasRaster → registry/önizleme uçlarına minimal await ile taşınır. */
export async function rasterizeCanvasLayout(input: CanvasRenderInput): Promise<Bitmap1> {
  const { payload, format, layout } = input;
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const bmp = new Bitmap1(d(format.widthMm), d(format.heightMm));
  const bc = payload.barcode ? String(payload.barcode) : "";

  for (const el of prepareElements(layout.elements, payload)) {
    const x = d(el.x);
    const y = d(el.y);
    switch (el.type) {
      case "field":
      case "text": {
        const raw = elementText(el, payload);
        if (raw == null) break;
        const text = rasterCleanText(raw);
        if (!text) break;
        const rot = (el.rot ?? 0) as CanvasRotation;
        const align = rot === 0 ? el.align : undefined; // hizalama yalnız rot=0
        if (el.hMm != null) {
          // SERBEST boyut: hedef mm TAM (native'in en-yakın-font kuantizasyonu KALKAR).
          const opts = { heightDots: d(el.hMm), widthRatio: el.wr ?? 1, bold: el.bold === true };
          const ax = align ? alignOffsetDots(align, measureText(text, opts).widthDots) : 0;
          drawText(bmp, Math.max(0, x + ax), y, text, { ...opts, rot });
        } else {
          // ESKİ 4-kademe (bold = ×2 boyut; native legacy anlamı).
          const capMm = (RASTER_FONT_MM[el.font ?? "md"] ?? DEFAULT_FONT_MM) * (el.bold ? 2 : 1);
          const opts = { heightDots: d(capMm) };
          const ax = align ? alignOffsetDots(align, measureText(text, opts).widthDots) : 0;
          drawText(bmp, Math.max(0, x + ax), y, text, { ...opts, rot });
        }
        break;
      }
      case "qr": {
        if (!bc) break;
        drawQr(bmp, x, y, bc, resolveQrScale(el.scale));
        break;
      }
      case "code128": {
        if (!bc) break;
        const h = d(el.hMm ?? 9);
        const res = drawCode128(bmp, x, y, bc, { heightDots: h, moduleDots: el.mw ?? 2 });
        if (el.human !== false && res) {
          const capDots = d(el.humanHMm ?? HUMAN_DEFAULT_MM);
          const tw = measureText(bc, { heightDots: capDots }).widthDots;
          const center = Math.max(0, Math.round((res.widthDots - tw) / 2));
          const hx = x + center + d(el.humanDx ?? 0);
          const hy = y + h + d(BC_HUMAN_GAP_MM) + d(el.humanDy ?? 0);
          drawText(bmp, hx, hy, bc, { heightDots: capDots });
        }
        break;
      }
      case "line":
        bmp.fillRect(x, y, d(el.wMm), d(el.hMm));
        break;
      case "box":
        bmp.frameRect(x, y, d(el.wMm), d(el.hMm), d(el.thickMm ?? 0.5) || 1);
        break;
      case "lengthBanner":
        drawBanner(bmp, el, payload, format, d);
        break;
      case "icon": {
        // Bakım sembolü — kare 1bpp damga; rot kare içi dönüş (ayak izi değişmez).
        // Bilinmeyen anahtar (katalogdan kalkmış eski kayıt) → sessiz atla.
        const sizeDots = d(el.hMm ?? ICON_DEFAULT_MM);
        try {
          await drawIconOnBitmap(bmp, el.icon, x, y, sizeDots, el.rot ?? 0);
        } catch { /* bilinmeyen ikon → iz bırakmadan geç */ }
        break;
      }
    }
  }
  return bmp;
}

/** lengthBanner — dolu siyah bant + ORTALANMIŞ BEYAZ değer (bölge inversiyonu = blit
 *  clear). PPLA dahil dört dilde aynı görünüm (komut yolundaki PPLA çerçeve istisnası
 *  raster'da yok). Değer = bannerValueText (TR-formatlı sayı; "m" eki unit'e bağlı).
 *  glyphHMm dolu → değer yüksekliği TAM mm (raster serbest ölçer); boş → banda sığdır.
 *  wr → dar/geniş ("ince/kalın") görünüm. */
function drawBanner(
  bmp: Bitmap1,
  el: LengthBannerElement,
  payload: LabelPayload,
  format: ResolvedLabelFormat,
  d: (mm: number) => number,
): void {
  const dv = fieldDisplayValue(payload, "lengthMeters");
  if (!dv.present) return;
  const bx = d(el.x);
  const by = d(el.y);
  const bw = el.wMm != null ? d(el.wMm) : d(BANNER_DEFAULT_W_MM);
  const bh = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * by;
  if (bw <= 0 || bh <= 0) return;

  bmp.fillRect(bx, by, bw, bh); // siyah zemin

  const val = rasterCleanText(bannerValueText(payload, el.unit !== false));
  if (!val) return;
  const rot = (el.rot ?? 90) as CanvasRotation;
  const vertical = rot === 90 || rot === 270;
  const cross = vertical ? bw : bh; // glif yüksekliğinin dolduracağı eksen
  const capH = el.glyphHMm != null ? d(el.glyphHMm) : Math.max(6, Math.round(cross * 0.6));
  const run = renderTextBitmap(val, { heightDots: capH, widthRatio: el.wr ?? 1 });
  const rs = rotatedSize(run.widthDots, run.heightDots, rot);
  const dx = bx + Math.round((bw - rs.w) / 2);
  const dy = by + Math.round((bh - rs.h) / 2);
  bmp.blit(run, dx, dy, rot, "clear"); // beyaz değer (siyah bandı deler)
}
