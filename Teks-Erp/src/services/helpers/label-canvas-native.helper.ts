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

/** Code128 sembol genişliği (dot) — okunur satırı barkod ALTINDA ortalamak için.
 *  ≈ 11 modül/karakter + start/check/stop (~35 modül); modül = mwDots. Sessiz
 *  bölge hariç (kabaca; merkezleme için yeterli). */
function code128WidthDots(len: number, mwDots: number): number {
  return (11 * len + 35) * Math.max(1, mwDots);
}

/** Küçük okunur-satır glif genişliği (dot) — native font "1" (8×12). */
const HUMAN_CHAR_W = 8;

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
        // Modül (dar çubuk) kalınlığı — genişlik bununla ORANTILI büyür; mw yokken
        // bugünkü 2,3 aynen (bayt-uyum).
        const mw = el.mw ?? 2;
        // Okunur satır firmware'de SOLA yaslanır → kapat (N) + manuel ORTALA.
        lines.push(`B${x},${y},0,1,${mw},${mw + 1},${h},N,"${bc}"`);
        if (el.human !== false) {
          const bw = code128WidthDots(bc.length, mw);
          const hx = x + Math.max(0, Math.round((bw - bc.length * HUMAN_CHAR_W) / 2));
          lines.push(`A${hx},${y + h + d(1)},0,1,1,1,N,"${bc}"`);
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
      case "lengthBanner": {
        // SİYAH ZEMİN / BEYAZ DEĞER — ters (R) metin + boşluk dolgusu kendi siyah
        // bandını çizer (Argox XOR gotcha'sı: ayrı LO kutu YOK). PPLB gerçek saha
        // yazıcısı; reverse güvenilir.
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = eplData(String(payload.lengthMeters));
        const mul = Math.max(1, Math.min(4, Math.round(w / EPL_FONT.xl.h)));
        const adv = EPL_FONT.xl.w * mul; // döndürülmüş glif ilerlemesi
        const target = Math.max(val.length, Math.floor((h * 0.85) / adv));
        const pad = Math.max(0, Math.floor((target - val.length) / 2));
        const padded = " ".repeat(pad) + val + " ".repeat(pad);
        const ty = y + Math.max(0, Math.round((h - padded.length * adv) / 2));
        lines.push(`A${x + w},${ty},1,${EPL_FONT.xl.code},${mul},${mul},R,"${padded}"`);
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
        // Okunur satır — barkodun altında ORTALANMIŞ (eskiden sola yaslıydı).
        // Format: <rot=1><font=1><mul=11>000<row4><col4><veri>
        if (el.human !== false) {
          const bw = code128WidthDots(bc.length, mw);
          const hcol = col + Math.max(0, Math.round((bw - bc.length * HUMAN_CHAR_W) / 2));
          lines.push(`1111000${pad4(row + h + d(1))}${pad4(hcol)}${bc}`);
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
        // PPLA/DPL İSTİSNASI: siyah zemin/beyaz yazı (ters-renk) DPL'de güvenilir
        // DEĞİL (Datamax reverse cihaza bağlı). Değer görünmez (siyah-üstü-siyah)
        // riskine düşmemek için PPLA'da ÇERÇEVELİ basılır (kutu + siyah dikey
        // değer, her zaman okunur). PPLB/ZPL/HTML dolgulu siyah + beyaz değer.
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
        // ^BY = modül kalınlığı (genişlik orantılı) — mw yokken emit edilmez (bayt-uyum).
        const by = el.mw != null ? `^BY${Math.min(10, el.mw)}` : "";
        // ZPL yorum satırı (interpretation) sola yaslar → kapat (N) + manuel ORTALA.
        lines.push(`^FO${x},${y}${by}^BCN,${h},N,N,N^FD${bc}^FS`);
        if (el.human !== false) {
          const bw = code128WidthDots(bc.length, el.mw ?? 2);
          const fh = 20, fw = 12;
          const hx = x + Math.max(0, Math.round((bw - bc.length * fw) / 2));
          lines.push(`^FO${hx},${y + h + d(1)}^A0N,${fh},${fw}^FD${bc}^FS`);
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
      case "lengthBanner": {
        // SİYAH ZEMİN / BEYAZ DEĞER — ^GB dolu siyah kutu + ^FR (field reverse)
        // döndürülmüş değer (glifler beyaza döner). Boşluk dolgusu bandı doldurur.
        const dv = fieldDisplayValue(payload, "lengthMeters");
        if (!dv.present) break;
        const w = el.wMm != null ? d(el.wMm) : EPL_FONT.xl.h * BANNER_MUL;
        const h = el.hMm != null ? d(el.hMm) : d(format.heightMm) - 2 * y;
        const val = zplData(String(payload.lengthMeters));
        const mul = Math.max(1, Math.min(4, Math.round(w / EPL_FONT.xl.h)));
        const gh = EPL_FONT.xl.h * mul, gw = EPL_FONT.xl.w * mul;
        const target = Math.max(val.length, Math.floor((h * 0.85) / gw));
        const pad = Math.max(0, Math.floor((target - val.length) / 2));
        const padded = " ".repeat(pad) + val + " ".repeat(pad);
        const ty = y + Math.max(0, Math.round((h - padded.length * gw) / 2));
        lines.push(`^FO${x},${y}^GB${w},${h},${w},B^FS`); // dolu siyah zemin (t=w)
        lines.push(`^FO${x},${ty}^A0R,${gh},${gw}^FR^FD${padded}^FS`); // ters (beyaz) değer
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
