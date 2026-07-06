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
  clampCopies,
  mmToDots,
  resolveQrScale,
  resolveEplTextStyle,
  EPL_FONT,
} from "./native-label.shared";
import { fieldDisplayValue } from "./label-field-values";
import {
  elementSupported,
  type CanvasLayout,
  type LabelElement,
  type FieldElement,
  type TextElement,
} from "../../config/label-elements";

export interface CanvasRenderInput {
  payload: LabelPayload;
  format: ResolvedLabelFormat;
  copies: number;
  layout: CanvasLayout;
}

const CRLF = "\r\n";
const CR = "\r";
const STX = "\x02";

/** Metraj bandı glif çarpanı — akış üreticisiyle birebir (xl font × 3). */
const BANNER_MUL = 3;

function pad4(n: number): string {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

/** field/text elemanının basılacak metni — present:false → null (eleman atlanır). */
function elementText(el: FieldElement | TextElement, payload: LabelPayload): string | null {
  if (el.type === "text") return el.text;
  const dv = fieldDisplayValue(payload, el.bind);
  if (!dv.present) return null;
  const label = el.label?.trim();
  return label ? `${label}: ${dv.value}` : dv.value;
}

/** Metraj bandı dolgulu değeri — akış üreticisiyle aynı mantık: değer bandın
 *  ~%60'ını dolduracak şekilde iki yandan boşlukla beslenir (ters modda boşluk
 *  da siyah hücredir). bandLenDots = bandın uzun ekseni. */
function bannerPadded(value: string, bandLenDots: number): { padded: string; charLen: number } {
  const charLen = EPL_FONT.xl.w * BANNER_MUL;
  const targetChars = Math.max(value.length, Math.floor((bandLenDots * 0.6) / charLen));
  const padEach = Math.floor((targetChars - value.length) / 2);
  const padded = " ".repeat(padEach) + value + " ".repeat(padEach);
  return { padded, charLen };
}

// =============================================================================
// PPLB (EPL2)
// =============================================================================

/** EPL2 veri çift-tırnak içinde → veri içi `"` güvenli karaktere çevrilir. */
function eplData(s: string): string {
  return cleanCtl(s).replace(/"/g, "'");
}

export function emitCanvasPplb({ payload, format, copies, layout }: CanvasRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const lines: string[] = [];
  lines.push("N");
  lines.push(`q${d(format.widthMm)}`);
  lines.push(`Q${d(format.heightMm)},${d(format.gapMm)}`);
  lines.push("D8");

  const bc = payload.barcode ? eplData(payload.barcode) : "";

  for (const el of layout.elements) {
    if (!elementSupported(el.type, "PPLB")) continue;
    const x = d(el.x);
    const y = d(el.y);
    switch (el.type) {
      case "field":
      case "text": {
        const text = elementText(el, payload);
        if (!text) break;
        const rotCode = (el.rot ?? 0) / 90;
        if (el.hMm != null) {
          // SERBEST boyut: hedef mm → en yakın (font, çarpan) kombinasyonu;
          // wr yatay çarpana biner (EPL2 güvenli aralık maxMul=6).
          const st = resolveEplTextStyle(d(el.hMm), el.wr ?? 1, 6);
          lines.push(`A${x},${y},${rotCode},${st.code},${st.hmul},${st.vmul},N,"${eplData(text)}"`);
        } else {
          // ESKİ 4-kademe yol (bayt-uyum): bold = her iki çarpan ×2.
          const font = EPL_FONT[el.font ?? "md"] ?? EPL_FONT.md;
          const mul = el.bold ? 2 : 1;
          lines.push(`A${x},${y},${rotCode},${font.code},${mul},${mul},N,"${eplData(text)}"`);
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
        const human = el.human !== false ? "B" : "N";
        // Modül (dar çubuk) kalınlığı — genişlik bununla ORANTILI büyür; mw yokken
        // bugünkü 2,3 aynen (bayt-uyum).
        const mw = el.mw ?? 2;
        lines.push(`B${x},${y},0,1,${mw},${mw + 1},${h},${human},"${bc}"`);
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
      case "lengthBanner": {
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = eplData(String(payload.lengthMeters));
        const { padded, charLen } = bannerPadded(val, h);
        // Ters (R) TEK BAŞINA: kendi siyah kutusu + beyaz glif (LO YOK — Argox XOR gotcha'sı).
        // rotation 1 (90° CW): anchor bandın SAĞ kenarı; blok sola+aşağı uzar.
        const ty = y + Math.round((h - padded.length * charLen) / 2);
        lines.push(`A${x + w},${ty},1,${EPL_FONT.xl.code},${BANNER_MUL},${BANNER_MUL},R,"${padded}"`);
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
  const lines: string[] = [];
  lines.push(`${STX}n`);
  lines.push(`${STX}M${pad4(d(format.heightMm))}`);
  lines.push(`${STX}L`);
  lines.push("D11");
  lines.push("H10");

  const bc = payload.barcode ? cleanCtl(payload.barcode) : "";
  // DPL rot: 1=0°, 2=90°, 3=180°, 4=270°
  const dplRot = (rot?: number) => String(((rot ?? 0) / 90) + 1);

  for (const el of layout.elements) {
    if (!elementSupported(el.type, "PPLA")) continue; // lengthBanner → yok (reverse yok)
    const row = d(el.y);
    const col = d(el.x);
    switch (el.type) {
      case "field":
      case "text": {
        const text = elementText(el, payload);
        if (!text) break;
        if (el.hMm != null) {
          // SERBEST boyut — DPL çarpanları tek hane (1-9).
          const st = resolveEplTextStyle(d(el.hMm), el.wr ?? 1, 9);
          lines.push(`${dplRot(el.rot)}${st.code}${st.hmul}${st.vmul}000${pad4(row)}${pad4(col)}${cleanCtl(text)}`);
        } else {
          // ESKİ 4-kademe yol (bayt-uyum).
          const font = EPL_FONT[el.font ?? "md"] ?? EPL_FONT.md;
          const mult = el.bold ? "22" : "11";
          lines.push(`${dplRot(el.rot)}${font.code}${mult}000${pad4(row)}${pad4(col)}${cleanCtl(text)}`);
        }
        break;
      }
      case "qr": {
        if (!bc) break;
        const mod = String(resolveQrScale(el.scale)).padStart(2, "0");
        lines.push(`1W1c${mod}${mod}${pad4(row)}${pad4(col)}${bc}`);
        break;
      }
      case "code128": {
        if (!bc) break;
        const h = d(el.hMm ?? 9);
        // Modül kalınlığı: DPL barkod kaydında 'e' sonrası dar+geniş tek hane.
        // mw yokken bugünkü "22" aynen (bayt-uyum).
        const mw = Math.min(9, el.mw ?? 2);
        lines.push(`1e${mw}${mw}${pad4(h)}${pad4(row)}${pad4(col)}${bc}`);
        // PPLB/ZPL'de okunur satırı yazıcı çizer; DPL'de elle küçük metin (akış paritesi).
        // Format: <rot=1><font=1><mul=11>000<row4><col4><veri>
        if (el.human !== false) {
          lines.push(`1111000${pad4(row + h + d(1))}${pad4(col)}${bc}`);
        }
        break;
      }
      // DPL font-X grafik kayıtları: L=dolu çizgi/kutu, B=çerçeve.
      // Format: 1X11000<row4><col4><L|B><yatay4><dikey4>[<alt-üst duvar4><yan duvar4>]
      case "line":
        lines.push(`1X11000${pad4(row)}${pad4(col)}L${pad4(d(el.wMm))}${pad4(d(el.hMm))}`);
        break;
      case "box": {
        const t = Math.max(1, d(el.thickMm ?? 0.5));
        lines.push(`1X11000${pad4(row)}${pad4(col)}B${pad4(d(el.wMm))}${pad4(d(el.hMm))}${pad4(t)}${pad4(t)}`);
        break;
      }
      case "lengthBanner": {
        // PPLA ÇERÇEVELİ sürüm: ters-renk DPL'de güvenilmez → kutu + içinde 90°
        // döndürülmüş SİYAH metraj değeri (dolgu yok; PPLB/ZPL dolgulu basar).
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * row;
        lines.push(`1X11000${pad4(row)}${pad4(col)}B${pad4(w)}${pad4(h)}${pad4(2)}${pad4(2)}`);
        const val = cleanCtl(String(payload.lengthMeters));
        // Glif bandı doldursun: döndürülmüş yüksekliği (glif h) band genişliğine
        // en yakın xl-çarpanı; anchor sağ kenar hizası (rot=2, blok sola+aşağı).
        const mul = Math.max(1, Math.min(4, Math.round(w / EPL_FONT.xl.h)));
        const textLen = val.length * EPL_FONT.xl.w * mul;
        const ty = row + Math.max(0, Math.round((h - textLen) / 2));
        const tx = col + Math.round((w + EPL_FONT.xl.h * mul) / 2);
        lines.push(`2${EPL_FONT.xl.code}${mul}${mul}000${pad4(ty)}${pad4(tx)}${val}`);
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

export function emitCanvasZpl({ payload, format, copies, layout }: CanvasRenderInput): string {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const lines: string[] = [];
  lines.push("^XA");
  lines.push("^CI28");
  lines.push(`^PW${d(format.widthMm)}`);
  lines.push(`^LL${d(format.heightMm)}`);

  const bc = payload.barcode ? zplData(payload.barcode) : "";

  for (const el of layout.elements) {
    if (!elementSupported(el.type, "ZPL")) continue;
    const x = d(el.x);
    const y = d(el.y);
    switch (el.type) {
      case "field":
      case "text": {
        const text = elementText(el, payload);
        if (!text) break;
        const rot = ZPL_ROT[el.rot ?? 0] ?? "N";
        if (el.hMm != null) {
          // ZPL ^A0 tam ölçeklenebilir — hedef mm BİREBİR basılır; wr genişliğe.
          const h = Math.max(4, d(el.hMm));
          const w = Math.max(3, Math.round(h * 0.6 * (el.wr ?? 1)));
          lines.push(`^FO${x},${y}^A0${rot},${h},${w}^FD${zplData(text)}^FS`);
        } else {
          // ESKİ 4-kademe yol (bayt-uyum).
          const font = EPL_FONT[el.font ?? "md"] ?? EPL_FONT.md;
          const mul = el.bold ? 2 : 1;
          lines.push(`^FO${x},${y}^A0${rot},${font.h * mul},${font.w * mul}^FD${zplData(text)}^FS`);
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
        const human = el.human !== false ? "Y" : "N";
        // ^BY = modül kalınlığı (genişlik orantılı) — mw yokken emit edilmez (bayt-uyum).
        const by = el.mw != null ? `^BY${Math.min(10, el.mw)}` : "";
        lines.push(`^FO${x},${y}${by}^BCN,${h},${human},N,N^FD${bc}^FS`);
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
      case "lengthBanner": {
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = zplData(String(payload.lengthMeters));
        const { padded, charLen } = bannerPadded(val, h);
        const gh = EPL_FONT.xl.h * BANNER_MUL;
        const gw = EPL_FONT.xl.w * BANNER_MUL;
        const ty = y + Math.round((h - padded.length * charLen) / 2);
        lines.push(`^FO${x},${y}^GB${w},${h},${w},B^FS`); // solid siyah zemin
        lines.push(`^FO${x},${ty}^A0R,${gh},${gw}^FR^FD${padded}^FS`); // ters beyaz döndürülmüş değer
        break;
      }
    }
  }

  lines.push(`^PQ${clampCopies(copies)}`);
  lines.push("^XZ");
  return lines.join("\n") + "\n";
}

/** Dil anahtarına göre kanvas emit — registry tek noktadan çağırır. */
export function emitCanvasNative(
  language: "PPLA" | "PPLB" | "ZPL",
  input: CanvasRenderInput,
): string {
  if (language === "PPLA") return emitCanvasPpla(input);
  if (language === "PPLB") return emitCanvasPplb(input);
  return emitCanvasZpl(input);
}

/** Statik metin elemanı için degrade edilen tipler — Electron rozetiyle paylaşılan
 *  bilgi CAPABILITY'de; bu yardımcı editör-dışı tüketiciler (test/rapor) içindir. */
export function skippedTypesFor(language: string): string[] {
  return (["line", "box", "lengthBanner"] as const).filter((t) => !elementSupported(t, language));
}
