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

/** ORTAK PAYDA bant geometrisi — dört dil AYNI çerçeveli bandı basar (dolgulu
 *  sürüm PPLA'da fiziksel imkânsız → ortak görünüm çerçeve + siyah dikey değer).
 *  Glif çarpanı band genişliğine oturur; değer dikeyde ortalanır; anchor sağ
 *  hiza (rot-90 blok sola+aşağı uzar — üç dilin önizleme modeliyle aynı). */
function bannerGeom(colDots: number, rowDots: number, wDots: number, hDots: number, valLen: number) {
  const mul = Math.max(1, Math.min(4, Math.round(wDots / EPL_FONT.xl.h)));
  const gh = EPL_FONT.xl.h * mul;
  const gw = EPL_FONT.xl.w * mul;
  const textLen = valLen * gw;
  const ty = rowDots + Math.max(0, Math.round((hDots - textLen) / 2));
  const tx = colDots + Math.round((wDots + gh) / 2);
  return { mul, gh, gw, ty, tx };
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
        // ORTAK PAYDA: çerçeveli bant (X kutu + rot-90 SİYAH değer) — PPLA/ZPL/HTML
        // ile BİREBİR AYNI görünüm (dolgulu 'R' sürümü kaldırıldı: PPLA basamıyordu,
        // eleman dilden dile farklı görünmemeli).
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = eplData(String(payload.lengthMeters));
        const g = bannerGeom(x, y, w, h, val.length);
        lines.push(`X${x},${y},2,${x + w},${y + h}`);
        lines.push(`A${g.tx},${g.ty},1,${EPL_FONT.xl.code},${g.mul},${g.mul},N,"${val}"`);
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
          // SERBEST boyut — ORTAK PAYDA: dört dil aynı kombinasyonu basar; sınır
          // en dar dil olan PPLB'ninki (maxMul=6). DPL 9'a kadar destekler ama
          // parite için kullanılmaz (eleman dilden dile farklı boyut vermemeli).
          const st = resolveEplTextStyle(d(el.hMm), el.wr ?? 1, 6);
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
        // ORTAK PAYDA çerçeveli bant — dört dilde aynı görünüm (bannerGeom paylaşımlı).
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * row;
        lines.push(`1X11000${pad4(row)}${pad4(col)}B${pad4(w)}${pad4(h)}${pad4(2)}${pad4(2)}`);
        const val = cleanCtl(String(payload.lengthMeters));
        const g = bannerGeom(col, row, w, h, val.length);
        lines.push(`2${EPL_FONT.xl.code}${g.mul}${g.mul}000${pad4(g.ty)}${pad4(g.tx)}${val}`);
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
          // ORTAK PAYDA: ^A0 serbest ölçeklenebilir ama BİLEREK PPLB/PPLA'nın
          // seçtiği kombinasyonun boyutunda basılır — dört dilde AYNI boyut
          // (eleman dilden dile farklı çıktı vermemeli; kullanıcı kararı).
          const st = resolveEplTextStyle(d(el.hMm), el.wr ?? 1, 6);
          lines.push(`^FO${x},${y}^A0${rot},${st.hDots},${st.wDots}^FD${zplData(text)}^FS`);
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
        // ORTAK PAYDA çerçeveli bant — dolgulu ^GB+^FR sürümü kaldırıldı (PPLA
        // basamıyordu; eleman dilden dile farklı görünmemeli).
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = zplData(String(payload.lengthMeters));
        const g = bannerGeom(x, y, w, h, val.length);
        lines.push(`^FO${x},${y}^GB${w},${h},2^FS`); // çerçeve (t=2)
        lines.push(`^FO${g.tx},${g.ty}^A0R,${g.gh},${g.gw}^FD${val}^FS`); // siyah rot-90 değer
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
