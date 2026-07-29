// =============================================================================
// Kanvas eleman modeli → native komut emit (PPLA / PPLB / ZPL) — Etiket Stüdyosu v2
// =============================================================================
// Serbest x/y yerleşimli varyant tuvalini (LabelTemplateVariant.elements) üç
// yazıcı diline derler. Dört dilin komut seti zaten mutlak koordinatlıdır —
// akış-modelinden farkı: y burada TUVALDEN gelir, üretici hesaplamaz.
//
// - MEDYA komutları (q/Q, ^PW/^LL, STX M) FORMAT PROFİLİNDEN (fiziksel etiket
//   gerçeği); ELEMAN koordinatları VARYANT tuvalinden (mm→dot). Eşleşen varyantta
//   ikisi aynıdır (±1mm); fallback varyantta taşan elemanı yazıcı kırpar —
//   çakışma/taşma sorumluluğu EDİTÖRDE (lint), emit katmanı basar.
// - Dil yetenek matrisi (CAPABILITY, config/label-elements.ts): desteklenmeyen
//   eleman o dilde SESSİZCE atlanır (örn. lengthBanner PPLA'da yok — reverse yok).
// - present:false veri alanı ATLANIR — mutlak konumda satır kayması olmaz,
//   yalnız boşluk kalır.
// - Sanitize akış üreticileriyle birebir: cleanCtl/asciiFold + dil-özel kaçış.
// =============================================================================

import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import {
  cleanCtl,
  cleanCtlCp1254,
  clampCopies,
  mmToDots,
  resolveQrScale,
  resolveEplTextStyle,
  EPL_FONT,
  DPL_FONT,
  DPL_BASE_FONTS,
  dplBarcodeMul,
  qrSymbolModules,
  bannerValueText,
  mediaTypeCommand,
  alignOffsetDots,
  applyTextCase,
} from "./native-label.shared";
import { fieldDisplayValue } from "./label-field-values";
import {
  elementSupported,
  expandMultilineText,
  ICON_DEFAULT_MM,
  type CanvasLayout,
  type LabelElement,
  type FieldElement,
  type TextElement,
  type LengthBannerElement,
} from "../../config/label-elements";
import { Bitmap1, type Rotation } from "./raster/raster-bitmap";
import { renderIconBitmap, iconBitmap } from "./raster/raster-icon";
import { pplbGwBlock, PPLB_RASTER_VERIFIED } from "./raster/raster-envelope-pplb";

export interface CanvasRenderInput {
  payload: LabelPayload;
  format: ResolvedLabelFormat;
  copies: number;
  layout: CanvasLayout;
  /** PPLB ikon GW bloğu BINARY bayt (>0x7F) içerir → yalnız binary-güvenli tüketicide
   *  emit edilir: b64 transport (mobil printRawBytes / Electron), in-process önizleme
   *  SVG, ağ/BT bayt gönderimi. Ham text HTTP yanıtı (UTF-8 decode eden eski istemci)
   *  bunu bozar → o yolda FALSE bırakılır ve ikon atlanır (temiz ASCII komut; bugünkü
   *  davranış). Varsayılan falsy = güvenli (atla). ZPL ^GFA hex-ASCII olduğu için gate'siz. */
  iconGraphicsOk?: boolean;
}

const CRLF = "\r\n";
const CR = "\r";
const STX = "\x02";

/** Metraj bandı glif çarpanı — akış üreticisiyle birebir (xl font × 3). */
const BANNER_MUL = 3;

function pad4(n: number): string {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

/** DPL barkod kaydının yükseklik alanı 3 HANE (4 değil) — 4 hane yazılırsa alanlar
 *  1 kayar, satır devasa okunur → yazıcı boş etiket besler (fiziksel doğrulandı). */
function pad3(n: number): string {
  return String(Math.max(0, Math.min(999, Math.round(n)))).padStart(3, "0");
}

/** field/text elemanının basılacak metni — present:false → null (eleman atlanır).
 *  Raster boru hattı da (raster-canvas) bunu paylaşır → alan/etiket/present mantığı
 *  komut ve raster yollarında TEK KAYNAK (ham metin; sanitize çağırana ait). */
export function elementText(el: FieldElement | TextElement, payload: LabelPayload): string | null {
  let out: string;
  if (el.type === "text") {
    out = el.text;
  } else {
    const dv = fieldDisplayValue(payload, el.bind);
    if (!dv.present) return null;
    const label = el.label?.trim();
    out = label ? `${label}: ${dv.value}` : dv.value;
  }
  // Harf dönüşümü (BÜYÜK/küçük) — native + raster ikisi de bunu kullanır → tek yer.
  return applyTextCase(out, el.textCase);
}

/** ÇEVRİLEBİLİR bant geometrisi — value metni ROT (0/90/180/270) ile döner.
 *  Glif stili: glyphHMm dolu → metin elemanlarıyla AYNI ortak-payda (en yakın
 *  basılabilir kombinasyon, resolveEplTextStyle); boş → banda otomatik sığdır
 *  (bugünkü davranış: xl font, cross'tan çarpan). wr yatay çarpana biner (dar/geniş
 *  = "ince/kalın"; ters/reverse modda çift-vuruş XOR'lanacağı için bold YOK).
 *  Metin bant içinde ORTALANIR. origin(len): top-sol anchor + CW dönüşle merkez.
 *  pad: PPLB'nin kendi-siyah-bandı için boşluk dolgusu. */
function bannerGeom(
  el: LengthBannerElement,
  colDots: number,
  rowDots: number,
  wDots: number,
  hDots: number,
  rot: number,
  valLen: number,
  d: (mm: number) => number,
  xl: { code: string; w: number; h: number } = EPL_FONT.xl,
  baseFonts?: ReadonlyArray<{ code: string; w: number; h: number }>,
) {
  const vertical = rot === 90 || rot === 270;
  const cross = vertical ? wDots : hDots; // glif yüksekliği bunu doldurur
  const along = vertical ? hDots : wDots; // metin ilerlemesi bunu doldurur
  const wr = el.wr ?? 1;
  let code: string, vmul: number, hmul: number, gh: number, gw: number;
  if (el.glyphHMm != null) {
    const st = resolveEplTextStyle(d(el.glyphHMm), wr, 6, baseFonts);
    code = st.code; vmul = st.vmul; hmul = st.hmul; gh = st.hDots; gw = st.wDots;
  } else {
    vmul = Math.max(1, Math.min(4, Math.round(cross / xl.h)));
    hmul = Math.max(1, Math.min(6, Math.round(vmul * wr)));
    code = xl.code; gh = xl.h * vmul; gw = xl.w * hmul;
  }
  const targetChars = Math.max(valLen, Math.floor((along * 0.85) / gw));
  const pad = Math.max(0, Math.floor((targetChars - valLen) / 2));
  const cx = colDots + wDots / 2;
  const cy = rowDots + hDots / 2;
  /** `len` karakterlik bloğun (top-sol anchor, CW dönüş) merkeze oturan köşesi. */
  const origin = (len: number) => {
    const W = len * gw; // ilerleme (advance)
    const H = gh; // glif yüksekliği
    let ox: number, oy: number;
    switch (rot) {
      case 0:   ox = cx - W / 2; oy = cy - H / 2; break;
      case 90:  ox = cx + H / 2; oy = cy - W / 2; break;
      case 180: ox = cx + W / 2; oy = cy + H / 2; break;
      default:  ox = cx - H / 2; oy = cy + W / 2; break; // 270
    }
    // Yanlış bant şekli (örn. kısa banta dikey metin) negatife düşürebilir →
    // etikette kal (0'a kıstır); değer bantı taşarsa kullanıcı boyut/dönüş ayarlar.
    return { ox: Math.max(0, Math.round(ox)), oy: Math.max(0, Math.round(oy)) };
  };
  return { code, vmul, hmul, gh, gw, pad, paddedLen: valLen + 2 * pad, origin };
}

/** Code128 sembol genişliği (dot) — okunur satırı barkod ALTINDA ortalamak için.
 *  ≈ 11 modül/karakter + start/check/stop (~35 modül); modül = mwDots. Sessiz
 *  bölge hariç (kabaca; merkezleme için yeterli). */
function code128WidthDots(len: number, mwDots: number): number {
  return (11 * len + 35) * Math.max(1, mwDots);
}

/** Küçük okunur-satır glif genişliği (dot) — native font "1" (8×12). */
const HUMAN_CHAR_W = 8;

/** Okunur satır (barkod altı kod) EPL/DPL stili — humanHMm dolu → 4 dilde ortak-payda
 *  boyut (metin gibi en yakın basılabilir kombinasyon); boş → bugünkü sabit font "1"
 *  (bayt-uyum). charW = karakter hücre genişliği (dot) — okunur satırı ortalamak için. */
function humanEplStyle(
  humanHMm: number | undefined,
  d: (mm: number) => number,
  baseFonts?: ReadonlyArray<{ code: string; w: number; h: number }>,
  fallbackCharW: number = HUMAN_CHAR_W,
): {
  code: string;
  hmul: number;
  vmul: number;
  charW: number;
} {
  if (humanHMm != null) {
    // baseFonts verilirse (PPLA → DPL_BASE_FONTS) seçim dile-doğru fiziksel boyutla yapılır.
    const st = resolveEplTextStyle(d(humanHMm), 1, 6, baseFonts);
    return { code: st.code, hmul: st.hmul, vmul: st.vmul, charW: st.wDots };
  }
  return { code: "1", hmul: 1, vmul: 1, charW: fallbackCharW };
}

/** Okunur satır ZPL font hücresi (dot) — humanHMm dolu → ortak-payda; boş → 20×12
 *  (bugünkü sabit; bayt-uyum). */
function humanZplStyle(humanHMm: number | undefined, d: (mm: number) => number): { fh: number; fw: number } {
  if (humanHMm != null) {
    const st = resolveEplTextStyle(d(humanHMm), 1, 6);
    return { fh: st.hDots, fw: st.wDots };
  }
  return { fh: 20, fw: 12 };
}

// =============================================================================
// PPLB (EPL2)
// =============================================================================

/** EPL2 veri çift-tırnak içinde → veri içi `"` güvenli karaktere çevrilir. CP1254-farkında:
 *  PPLB header'ında `I8,E` (Türkçe 1254) seçildiği için Türkçe glif cp1254 baytına eşlenir
 *  (asciiFold DEĞİL) → yazıcı gerçek Türkçe basar; önizleme (esc) baytı geri Türkçe'ye eşler. */
function eplData(s: string): string {
  return cleanCtlCp1254(s).replace(/"/g, "'");
}

export function emitCanvasPplb({ payload, format, copies, layout, iconGraphicsOk }: CanvasRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const lines: string[] = [];
  lines.push("N");
  lines.push(`q${d(format.widthMm)}`);
  lines.push(`Q${d(format.heightMm)},${d(format.gapMm)}`);
  lines.push("D8");
  lines.push("I8,E,001"); // Select Symbol Set: 8-bit, Türkçe (CP1254) → gerçek Türkçe glif

  const bc = payload.barcode ? eplData(payload.barcode) : "";

  for (const el of expandMultilineText(layout.elements)) {
    if (!elementSupported(el.type, "PPLB")) continue;
    const x = d(el.x);
    const y = d(el.y);
    switch (el.type) {
      case "field":
      case "text": {
        const text = elementText(el, payload);
        if (!text) break;
        const rotCode = (el.rot ?? 0) / 90;
        // Hizalama yalnız rot=0'da (çapa=x; döndürülmüşte sol-çapa kalır — nadir).
        const align = (el.rot ?? 0) === 0 ? el.align : undefined;
        const data = eplData(text);
        if (el.hMm != null) {
          // SERBEST boyut: hedef mm → en yakın (font, çarpan) kombinasyonu;
          // wr yatay çarpana biner (EPL2 güvenli aralık maxMul=6).
          const st = resolveEplTextStyle(d(el.hMm), el.wr ?? 1, 6);
          const ax = alignOffsetDots(align, data.length * st.wDots);
          // KALIN = çift-vuruş: aynı metni +1 dot kaydırıp tekrar bas → çubuklar
          // kalınlaşır (bitmap fontta gerçek bold yok; boyut değişmez). bold yoksa
          // tek satır = bayt-aynı.
          const emit = (dx: number) => `A${Math.max(0, x + ax + dx)},${y},${rotCode},${st.code},${st.hmul},${st.vmul},N,"${data}"`;
          lines.push(emit(0));
          if (el.bold) lines.push(emit(1));
        } else {
          // ESKİ 4-kademe yol (bayt-uyum): bold = her iki çarpan ×2.
          const font = EPL_FONT[el.font ?? "md"] ?? EPL_FONT.md;
          const mul = el.bold ? 2 : 1;
          const ax = alignOffsetDots(align, data.length * font.w * mul);
          lines.push(`A${Math.max(0, x + ax)},${y},${rotCode},${font.code},${mul},${mul},N,"${data}"`);
        }
        break;
      }
      case "qr": {
        if (!bc) break;
        lines.push(`b${x},${y},Q,m2,s${resolveQrScale(el.scale)},"${bc}"`);
        break;
      }
      case "code128": {
        if (!bc) break;
        const h = d(el.hMm ?? 9);
        // Modül (dar çubuk) kalınlığı — genişlik bununla ORANTILI büyür; mw yokken
        // bugünkü 2,3 aynen (bayt-uyum).
        const mw = el.mw ?? 2;
        // Okunur satır firmware'de SOLA yaslanır → kapat (N) + manuel ORTALA.
        lines.push(`B${x},${y},0,1,${mw},${mw + 1},${h},N,"${bc}"`);
        if (el.human !== false) {
          // Boyut humanHMm'den (ortak-payda); ortalı taban + humanDx/Dy ince ayar.
          const hs = humanEplStyle(el.humanHMm, d);
          const bw = code128WidthDots(bc.length, mw);
          const center = Math.max(0, Math.round((bw - bc.length * hs.charW) / 2));
          const hx = Math.max(0, x + center + d(el.humanDx ?? 0));
          const hy = Math.max(0, y + h + d(1) + d(el.humanDy ?? 0));
          lines.push(`A${hx},${hy},0,${hs.code},${hs.hmul},${hs.vmul},N,"${bc}"`);
        }
        break;
      }
      case "line":
        lines.push(`LO${x},${y},${d(el.wMm)},${d(el.hMm)}`);
        break;
      case "box": {
        const t = d(el.thickMm ?? 0.5) || 1;
        lines.push(`X${x},${y},${t},${x + d(el.wMm)},${y + d(el.hMm)}`);
        break;
      }
      case "icon": {
        // Bakım sembolü → GW (Print Immediate Graphics) inline 1bpp grafik. Metin/barkod
        // yine native komut; SADECE ikon bitmap gider (Bluetooth'ta düşük yük — tüm etiketi
        // raster'a çevirmeye gerek yok). Blok Buffer olarak üretilip latin1 STRING'e çevrilip
        // lines'a eklenir → join(CRLF) binary'i BOZMAZ (tek eleman, GW p3×p4 baytı yazıcıda
        // veri sayılır) + transport latin1→bayt birebir round-trip. Kodlama/polarite
        // pplbGwBlock'ta (raster zarfıyla TEK KAYNAK). Fiziksel kill-switch: PPLB_RASTER_VERIFIED
        // (aynı GW komutu) — false ise atla (bugünkü skip; rest native basılır). rot → kare
        // temp bitmap blit (ayak izi değişmez). Bilinmeyen anahtar → sessiz atla.
        // iconGraphicsOk: binary-güvenli tüketici mi (b64/preview/bayt-transport)? Ham text
        // HTTP yolunda FALSE → ikon atlanır (UTF-8 decode GW binary'sini bozardı → tüm etiket
        // kayar). PPLB_RASTER_VERIFIED: Argox GW fiziksel kill-switch (raster zarfıyla ortak).
        if (!iconGraphicsOk || !PPLB_RASTER_VERIFIED) break;
        const sizeDots = d(el.hMm ?? ICON_DEFAULT_MM);
        let icon: Bitmap1;
        try {
          icon = iconBitmap(el.icon, sizeDots);
        } catch { break; }
        const rot = (el.rot ?? 0) as Rotation;
        if (rot) {
          const tmp = new Bitmap1(icon.widthDots, icon.heightDots);
          tmp.blit(icon, 0, 0, rot);
          icon = tmp;
        }
        if (icon.rowBytes * icon.heightDots === 0) break;
        lines.push(pplbGwBlock(icon, x, y).toString("latin1"));
        break;
      }
      case "lengthBanner": {
        // SİYAH ZEMİN / BEYAZ DEĞER — ters (R) metin + boşluk dolgusu kendi siyah
        // bandını çizer (Argox XOR gotcha'sı: ayrı LO kutu YOK). Metin ROT ile döner.
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const rot = el.rot ?? 90;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = eplData(bannerValueText(payload, el.unit !== false));
        const g = bannerGeom(el, x, y, w, h, rot, val.length, d);
        const padded = " ".repeat(g.pad) + val + " ".repeat(g.pad);
        const o = g.origin(g.paddedLen);
        lines.push(`A${o.ox},${o.oy},${rot / 90},${g.code},${g.hmul},${g.vmul},R,"${padded}"`);
        break;
      }
    }
  }

  lines.push(`P${clampCopies(copies)}`);
  return lines.join(CRLF) + CRLF;
}

// =============================================================================
// PPLA (Datamax DPL)
// =============================================================================

export function emitCanvasPpla({ payload, format, copies, layout }: CanvasRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  // DPL/PPLA inç modunda (STX n) kayıt koordinat/uzunluk alanları 1/100 İNÇ'tir —
  // dot DEĞİL (Argox OS-214plus fiziksel testi, 2026-07-10: dot yazınca her konum
  // ×2.03 kayıyor — "ortadaki sağa dayanır, metin taşar"). İç geometri (font seçimi,
  // ortalama, banner) dot'ta hesaplanır; kayıt alanına yazarken u() ile çevrilir.
  const u = (dots: number) => Math.round((dots * 100) / dpi);
  const lines: string[] = [];
  lines.push(`${STX}n`);
  // Baskı yöntemi (ribon): cihaz mediaType'ından <STX>KI7 0/1 — boşsa yazıcı otomatik.
  const mc = mediaTypeCommand(format.language, format.mediaType);
  if (mc) lines.push(mc);
  // <STX>M = TOF ararken beslenecek AZAMİ mesafe (sayfa boyu DEĞİL). Gövde boyuna EŞİT
  // yazınca yazıcı gap'i bulamayıp boş besler; gövde+gap'in ~1.5×'i ve ≥5" güvenli tavan.
  lines.push(`${STX}M${pad4(Math.max(500, u(d(format.heightMm + format.gapMm)) + 50))}`);
  lines.push(`${STX}L`);
  lines.push("D11"); // basılan dot elemanı w×h çarpanı (1×1). Koyuluk AYRI komut (H).
  lines.push("H10");

  const bc = payload.barcode ? cleanCtl(payload.barcode) : "";
  // DPL rot: 1=0°, 2=90°, 3=180°, 4=270°
  const dplRot = (rot?: number) => String(((rot ?? 0) / 90) + 1);
  // Argox origin = SOL-ALT, Y YUKARI artar; tuval Y ÜSTTEN. Her Argox Y'si = tuval-üst
  // Y'nin flip'i: H - yÜst - elemanYüksekliği. Yoksa etiket DİKEY TERS basar (fiziksel
  // doğrulama 2026-07-10: tasarım üstü kağıdın altına düşüyordu).
  const H = d(format.heightMm);
  const flipY = (yTopDots: number, hDots: number) => Math.max(0, H - yTopDots - hDots);

  for (const el of expandMultilineText(layout.elements)) {
    if (!elementSupported(el.type, "PPLA")) continue; // lengthBanner → yok (reverse yok)
    const row = d(el.y); // tuval-üstünden Y (flipY ile Argox alt-orijine çevrilir)
    const col = d(el.x);
    switch (el.type) {
      case "field":
      case "text": {
        const text = elementText(el, payload);
        if (!text) break;
        const align = (el.rot ?? 0) === 0 ? el.align : undefined;
        const data = cleanCtl(text);
        if (el.hMm != null) {
          // SERBEST boyut: hedef mm → en yakın (font,çarpan). DPL_BASE_FONTS ile seçilir
          // ki seçilen kod+çarpan DPL yazıcıda DOĞRU fiziksel boyu üretsin (EPL2 tabanıyla
          // ~%35 aşıyordu). Çarpan maxMul=6 → tek hane (header hizalı kalır).
          const st = resolveEplTextStyle(d(el.hMm), el.wr ?? 1, 6, DPL_BASE_FONTS);
          const fy = flipY(row, st.hDots);
          const ucol = u(Math.max(0, col + alignOffsetDots(align, data.length * st.wDots)));
          // KALIN = çift-vuruş (+1 birim = 0.254mm ≈ 2 dot); bold yoksa tek satır.
          const emit = (dc: number) => `${dplRot(el.rot)}${st.code}${st.hmul}${st.vmul}000${pad4(u(fy))}${pad4(ucol + dc)}${data}`;
          lines.push(emit(0));
          if (el.bold) lines.push(emit(1));
        } else {
          // ESKİ 4-kademe yol — font KODU EPL ile aynı ('1'..'4', DPL'de de geçerli);
          // DPL_FONT niyeti + flip için gerçek DPL glif yüksekliğini verir.
          const font = DPL_FONT[el.font ?? "md"] ?? DPL_FONT.md;
          const mult = el.bold ? "22" : "11";
          const fy = flipY(row, font.h * (el.bold ? 2 : 1));
          const ucol = u(Math.max(0, col + alignOffsetDots(align, data.length * font.w * (el.bold ? 2 : 1))));
          lines.push(`${dplRot(el.rot)}${font.code}${mult}000${pad4(u(fy))}${pad4(ucol)}${data}`);
        }
        break;
      }
      case "qr": {
        if (!bc) break;
        // DPL QR: W1d (auto) = QR; W1c DataMatrix'ti (yanlış sembol). Modül TEK karakter
        // (dplBarcodeMul), c=d kare hücre, eee='000'. NORMAL tek-CR kaydı.
        const qrMag = dplBarcodeMul(resolveQrScale(el.scale));
        const qrH = qrSymbolModules(bc) * resolveQrScale(el.scale); // flip için ~ayak izi
        const fy = flipY(row, qrH);
        lines.push(`1W1d${qrMag}${qrMag}000${pad4(u(fy))}${pad4(u(col))}${bc}`);
        break;
      }
      case "code128": {
        if (!bc) break;
        const h = d(el.hMm ?? 9);
        const mw = Math.min(9, el.mw ?? 2); // dar+geniş modül; barkod yüksekliği 3 HANE (pad3)
        lines.push(`1e${mw}${mw}${pad3(u(h))}${pad4(u(flipY(row, h)))}${pad4(u(col))}${bc}`);
        // Okunur satır — barkodun ALTINDA ORTALANMIŞ (flip'te de altında = daha küçük Y).
        if (el.human !== false) {
          const hs = humanEplStyle(el.humanHMm, d, DPL_BASE_FONTS, DPL_FONT.sm.w);
          const humanH = el.humanHMm != null ? d(el.humanHMm) : DPL_FONT.sm.h;
          const bw = code128WidthDots(bc.length, mw);
          const center = Math.max(0, Math.round((bw - bc.length * hs.charW) / 2));
          const hcol = Math.max(0, u(col + center + d(el.humanDx ?? 0)));
          const humanTopY = row + h + d(1) + d(el.humanDy ?? 0); // tuvalde barkod altı
          const hrow = u(flipY(humanTopY, humanH));
          lines.push(`1${hs.code}${hs.hmul}${hs.vmul}000${pad4(hrow)}${pad4(hcol)}${bc}`);
        }
        break;
      }
      // Argox Line/Box (manuel §A7): `RX11000 yyyy xxxx {l|b} ...`. KÜÇÜK l/b = 4-haneli
      // param; BÜYÜK L/B = 3-haneli. pad4 (4 hane) + BÜYÜK harf → Argox alan kayması →
      // bozuk kayıt → RESET (Standart Ham Top'un lengthBanner'ı buydu). → küçük l/b.
      case "line":
        lines.push(`1X11000${pad4(u(flipY(row, d(el.hMm))))}${pad4(u(col))}l${pad4(u(d(el.wMm)))}${pad4(u(d(el.hMm)))}`);
        break;
      case "box": {
        const t = Math.max(1, u(d(el.thickMm ?? 0.5)));
        const boxH = d(el.hMm);
        lines.push(`1X11000${pad4(u(flipY(row, boxH)))}${pad4(u(col))}b${pad4(u(d(el.wMm)))}${pad4(u(boxH))}${pad4(t)}${pad4(t)}`);
        break;
      }
      case "lengthBanner": {
        // PPLA/DPL İSTİSNASI: ters-renk (siyah zemin/beyaz yazı) DPL'de güvenilir DEĞİL →
        // ÇERÇEVELİ (kutu + siyah değer) basılır. Kutu = Argox box (küçük 'b', 4-hane).
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const rot = el.rot ?? 90;
        const w = el.wMm != null ? d(el.wMm) : DPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * row;
        const boxFy = flipY(row, h);
        lines.push(`1X11000${pad4(u(boxFy))}${pad4(u(col))}b${pad4(u(w))}${pad4(u(h))}${pad4(1)}${pad4(1)}`);
        // Değer, diğer dillerle AYNI biçim: TR-formatlı sayı + "m" eki (unit'e bağlı).
        const val = cleanCtl(bannerValueText(payload, el.unit !== false));
        // g.gw/gh/çarpanlar = fiziksel glif metriği (bannerGeom: glyphHMm/wr veya banda-sığdır).
        // Değeri Argox kutusuna ORTALA — rot=90 metin anchor'dan SOLA+AŞAĞI uzar (fiziksel
        // doğrulama 2026-07-10): anchor = kutu-merkezi + (dikey uzunluk/2, gh/2). Böylece
        // metnin merkezi kutu merkezine oturur. (Banner varsayılan dik/rot=90; diğer rot nadir.)
        const g = bannerGeom(el, col, row, w, h, rot, val.length, d, DPL_FONT.xl, DPL_BASE_FONTS);
        const advance = val.length * g.gw; // rot=90'da dikey uzunluk
        const valY = boxFy + h / 2 + advance / 2;
        const valX = col + w / 2 + g.gh / 2;
        lines.push(`${rot / 90 + 1}${g.code}${g.hmul}${g.vmul}000${pad4(u(valY))}${pad4(u(valX))}${val}`);
        break;
      }
    }
  }

  lines.push(`Q${pad4(clampCopies(copies))}`);
  lines.push("E");
  return lines.join(CR) + CR;
}

// =============================================================================
// ZPL (Zebra)
// =============================================================================

/** ZPL ^FD verisi ^FS'e dek sürer; kontrol önekleri `^` ve `~` veriden ayıklanır. */
function zplData(s: string): string {
  return cleanCtl(s).replace(/[\^~]/g, " ");
}

const ZPL_ROT: Record<number, string> = { 0: "N", 90: "R", 180: "I", 270: "B" };

/** ASYNC: icon elemanı ^GFA inline grafik ister (renderIconBitmap async sarıcı). PPLB
 *  ikonu GW ile SENKRON basar (iconBitmap çekirdeği); PPLA'da icon skip. Çağrı zinciri:
 *  emitCanvasNative → registry. */
export async function emitCanvasZpl({ payload, format, copies, layout }: CanvasRenderInput): Promise<string> {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const lines: string[] = [];
  lines.push("^XA");
  // Baskı yöntemi (ribon): cihaz mediaType'ından ^MTD/^MTT — boşsa yazıcı otomatik.
  const mc = mediaTypeCommand(format.language, format.mediaType);
  if (mc) lines.push(mc);
  lines.push("^CI28");
  lines.push(`^PW${d(format.widthMm)}`);
  lines.push(`^LL${d(format.heightMm)}`);

  const bc = payload.barcode ? zplData(payload.barcode) : "";

  for (const el of expandMultilineText(layout.elements)) {
    if (!elementSupported(el.type, "ZPL")) continue;
    const x = d(el.x);
    const y = d(el.y);
    switch (el.type) {
      case "field":
      case "text": {
        const text = elementText(el, payload);
        if (!text) break;
        const rot = ZPL_ROT[el.rot ?? 0] ?? "N";
        const align = (el.rot ?? 0) === 0 ? el.align : undefined;
        const data = zplData(text);
        if (el.hMm != null) {
          // ORTAK PAYDA: ^A0 serbest ölçeklenebilir ama BİLEREK PPLB/PPLA'nın
          // seçtiği kombinasyonun boyutunda basılır — dört dilde AYNI boyut
          // (eleman dilden dile farklı çıktı vermemeli; kullanıcı kararı).
          const st = resolveEplTextStyle(d(el.hMm), el.wr ?? 1, 6);
          const ax = alignOffsetDots(align, data.length * st.wDots);
          // KALIN = çift-vuruş (+1 dot); bold yoksa tek satır = bayt-aynı.
          const emit = (dx: number) => `^FO${Math.max(0, x + ax + dx)},${y}^A0${rot},${st.hDots},${st.wDots}^FD${data}^FS`;
          lines.push(emit(0));
          if (el.bold) lines.push(emit(1));
        } else {
          // ESKİ 4-kademe yol (bayt-uyum).
          const font = EPL_FONT[el.font ?? "md"] ?? EPL_FONT.md;
          const mul = el.bold ? 2 : 1;
          const ax = alignOffsetDots(align, data.length * font.w * mul);
          lines.push(`^FO${Math.max(0, x + ax)},${y}^A0${rot},${font.h * mul},${font.w * mul}^FD${data}^FS`);
        }
        break;
      }
      case "qr": {
        if (!bc) break;
        const mag = Math.min(10, resolveQrScale(el.scale)); // ZPL BQ mag 1–10
        lines.push(`^FO${x},${y}^BQN,2,${mag}^FDQA,${bc}^FS`);
        break;
      }
      case "code128": {
        if (!bc) break;
        const h = d(el.hMm ?? 9);
        // ^BY = modül kalınlığı (genişlik orantılı) — mw yokken emit edilmez (bayt-uyum).
        const by = el.mw != null ? `^BY${Math.min(10, el.mw)}` : "";
        // ZPL yorum satırı (interpretation) sola yaslar → kapat (N) + manuel ORTALA.
        lines.push(`^FO${x},${y}${by}^BCN,${h},N,N,N^FD${bc}^FS`);
        if (el.human !== false) {
          // Boyut humanHMm'den (ortak-payda); ortalı taban + humanDx/Dy ince ayar.
          const hs = humanZplStyle(el.humanHMm, d);
          const bw = code128WidthDots(bc.length, el.mw ?? 2);
          const center = Math.max(0, Math.round((bw - bc.length * hs.fw) / 2));
          const hx = Math.max(0, x + center + d(el.humanDx ?? 0));
          const hy = Math.max(0, y + h + d(1) + d(el.humanDy ?? 0));
          lines.push(`^FO${hx},${hy}^A0N,${hs.fh},${hs.fw}^FD${bc}^FS`);
        }
        break;
      }
      case "line": {
        const w = d(el.wMm);
        const h = d(el.hMm);
        lines.push(`^FO${x},${y}^GB${w},${h},${Math.min(w, h)},B^FS`); // t≥min → dolu siyah
        break;
      }
      case "box": {
        const t = d(el.thickMm ?? 0.5) || 1;
        lines.push(`^FO${x},${y}^GB${d(el.wMm)},${d(el.hMm)},${t}^FS`);
        break;
      }
      case "icon": {
        // Bakım sembolü → ^GFA inline 1bpp grafik (raster-envelope-zpl ile aynı
        // konvansiyon: 1 bit = SİYAH, invert yok, ASCII-hex UPPERCASE). Kare bitmap;
        // rot → temp Bitmap1 + blit (ayak izi değişmez — frontend in-place kare dönüşü).
        // Bilinmeyen anahtar (katalogdan kalkmış eski kayıt) → sessiz atla.
        const sizeDots = d(el.hMm ?? ICON_DEFAULT_MM);
        let icon: Bitmap1;
        try {
          icon = await renderIconBitmap(el.icon, sizeDots);
        } catch { break; }
        const rot = (el.rot ?? 0) as Rotation;
        if (rot) {
          const tmp = new Bitmap1(icon.widthDots, icon.heightDots);
          tmp.blit(icon, 0, 0, rot);
          icon = tmp;
        }
        const total = icon.rowBytes * icon.heightDots;
        if (total === 0) break;
        const hex = Buffer.from(icon.data).toString("hex").toUpperCase();
        lines.push(`^FO${x},${y}^GFA,${total},${total},${icon.rowBytes},${hex}^FS`);
        break;
      }
      case "lengthBanner": {
        // SİYAH ZEMİN / BEYAZ DEĞER — ^GB dolu siyah kutu + ^FR (field reverse)
        // ORTALANMIŞ değer (glifler beyaza döner). Değer ROT ile döner.
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const rot = el.rot ?? 90;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = zplData(bannerValueText(payload, el.unit !== false));
        const g = bannerGeom(el, x, y, w, h, rot, val.length, d);
        const o = g.origin(val.length);
        lines.push(`^FO${x},${y}^GB${w},${h},${Math.min(w, h)},B^FS`); // dolu siyah zemin
        lines.push(`^FO${o.ox},${o.oy}^A0${ZPL_ROT[rot] ?? "R"},${g.gh},${g.gw}^FR^FD${val}^FS`);
        break;
      }
    }
  }

  lines.push(`^PQ${clampCopies(copies)}`);
  lines.push("^XZ");
  return lines.join("\n") + "\n";
}

/** Dil anahtarına göre kanvas emit — registry tek noktadan çağırır.
 *  ASYNC (2026-07 icon): ZPL icon ^GFA üretimi async; PPLA/PPLB içte SENKRON kalır
 *  (PPLB ikonu GW ile iconBitmap senkron çekirdeğinden basar). */
export async function emitCanvasNative(
  language: "PPLA" | "PPLB" | "ZPL",
  input: CanvasRenderInput,
): Promise<string> {
  if (language === "PPLA") return emitCanvasPpla(input);
  if (language === "PPLB") return emitCanvasPplb(input);
  return emitCanvasZpl(input);
}

/** Statik metin elemanı için degrade edilen tipler — Electron rozetiyle paylaşılan
 *  bilgi CAPABILITY'de; bu yardımcı editör-dışı tüketiciler (test/rapor) içindir. */
export function skippedTypesFor(language: string): string[] {
  return (["line", "box", "lengthBanner", "icon"] as const).filter((t) => !elementSupported(t, language));
}
