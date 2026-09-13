// =============================================================================
// Native etiket üreteçleri (PPLA/PPLB/ZPL) için ortak yardımcılar
// =============================================================================
// Aynı mantıksal alan listesini (ürün/renk/kalite/metraj/en/ağırlık/müşteri/parti)
// üretir; her dil renderer'ı kendi sözdiziminde konumlar. 203dpi = 8 dot/mm.
// =============================================================================

import { LabelKind, PrinterLanguage, type LabelTemplate, type PrinterMediaType } from "@prisma/client";
import type { LabelPayload } from "../../types/label.types";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import type { FontSize, TemplateField } from "../../config/label-fields";
import { fieldDisplayValue } from "./label-field-values";
import { formatNumber } from "./label-html.shared";
import { lowerTr, upperTr } from "../../utils/tr-case";

export interface NativeRenderInput {
  payload: LabelPayload;
  format: ResolvedLabelFormat;
  copies: number;
  /** Aktif etiket şablonu — alan görünürlük/sıra/ad/bold/font. null → varsayılan
   *  (rollTextLines) çıktısı: bayt-stabil geri uyum. */
  template: LabelTemplate | null;
}

/** Yatay (100×60) düzende sol tarama kolonu genişliği (QR + barkod) — sağ metin
 *  kolonu buradan sonra başlar. Üç native dil de paylaşır. */
export const LEFT_COL_MM = 30;

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

/** Baskı yöntemi komutu (dile göre) — cihaz mediaType'ından. Boş → "" (yazıcı otomatik
 *  algılar, komut gönderilmez = güvenli varsayılan). Tek satır döner (emitter CR/CRLF ile
 *  birleştirir): PPLA `<STX>KI7` 0/1 (0=direkt termal, 1=termal transfer/ribon); ZPL
 *  `^MTD`/`^MTT`. PPLB (EPL2) iş-başına komut YOK → "". */
export function mediaTypeCommand(
  language: PrinterLanguage,
  mediaType: PrinterMediaType | null | undefined,
): string {
  if (!mediaType) return "";
  const tt = mediaType === "THERMAL_TRANSFER";
  if (language === PrinterLanguage.PPLA) return `\x02KI7${tt ? "1" : "0"}`;
  if (language === PrinterLanguage.ZPL) return tt ? "^MTT" : "^MTD";
  return "";
}

/** Şablon-başına QR modül büyütme (dots/modül; PPLB `s`, ZPL/PPLA mag). Boş →
 *  dile-özel varsayılan (byte-compat için her dil kendi tuned değerini geçer).
 *  Dolu → makul aralığa kısılır (2–15) — çok küçük okunmaz, çok büyük sığmaz. */
export function resolveQrScale(qrScale?: number | null, defaultScale = 5): number {
  if (qrScale == null || !Number.isFinite(qrScale)) return defaultScale;
  return Math.max(2, Math.min(15, Math.round(qrScale)));
}

/** Şablon-başına satırlar arası EK boşluk (mm). Boş → varsayılan; dolu → 0–20 clamp.
 *  NOT: v2 tasarımda bu "toplam adım" DEĞİL, satırlar arası ek boşluktur — gerçek
 *  adım = fontYüksekliği×çarpan + boşluk (asla çakışmaz). */
export function resolveLineStepMm(lineStepMm?: number | null): number | null {
  if (lineStepMm == null || !Number.isFinite(lineStepMm)) return null;
  return Math.max(0, Math.min(20, lineStepMm));
}

// =============================================================================
// v2 yerleşim geometrisi — "gördüğün = basılan" için tek kaynak (generator + önizleme)
// =============================================================================

/** EPL2/PPLB dahili bitmap font boyutları (203dpi, dot) — W×H, çarpan ÖNCESİ.
 *  Font 5 (32×48) KASTEN kullanılmaz (etikete sığmaz/çakışır); xl = font4 + bold ile
 *  büyütülür. lg=headline. Önizleme bu tabloyu birebir kullanır → metin genişliği
 *  yazıcıyla eşleşir (eski FONT_H-only tahmin sapması giderildi). */
export const EPL_FONT: Record<FontSize, { code: string; w: number; h: number }> = {
  sm: { code: "1", w: 8, h: 12 },
  md: { code: "2", w: 10, h: 16 },
  lg: { code: "3", w: 12, h: 20 },
  xl: { code: "4", w: 14, h: 24 },
};

/** DPL/PPLA (Datamax/Argox) dahili bitmap font boyutları (203dpi, dot) — W×H, çarpan
 *  ÖNCESİ. Font KODLARI EPL_FONT ile AYNI ('1'..'4') ve DPL'de de geçerli ID'lerdir —
 *  AMA fiziksel boyutları EPL2'den FARKLIDIR (DPL fontları daha büyük). PPLB EPL2'nin
 *  native'i olduğu için EPL_FONT'u kullanır; PPLA bir DPL yazıcısıdır → bu tabloyu
 *  kullanmalı, yoksa emit+önizleme EPL2 boyutuyla anlaşır ama fiziksel yazıcı ~%35-50
 *  daha büyük basar ("önizleme doğru, baskı alakasız" kök-nedeni).
 *  ⚠️ Değerler Datamax DPL spec'inden türetildi; kesin dot boyutları Argox OS-214plus'ta
 *  tek-satır referans baskısıyla KALİBRE EDİLMELİ (yön kesin, sayılar tahmini). */
export const DPL_FONT: Record<FontSize, { code: string; w: number; h: number }> = {
  sm: { code: "1", w: 7, h: 13 },
  md: { code: "2", w: 10, h: 18 },
  lg: { code: "3", w: 14, h: 27 },
  xl: { code: "4", w: 18, h: 36 },
};

/** Satırlar arası varsayılan ek boşluk (mm) — otomatik adımda font yüksekliğine eklenir. */
export const LINE_GAP_MM = 1.2;

// =============================================================================
// SERBEST METİN BOYUTU (Etiket Stüdyosu v2) — hedef mm → en yakın basılabilir
// =============================================================================
// ZPL/HTML serbest ölçek basar (birebir); PPLA/PPLB bitmap fonttur — 5 temel
// font × dikey/yatay tam-sayı çarpan kombinasyonundan HEDEFE EN YAKINI seçilir
// (eski 4-kademe sisteminden çok daha granüler; font 5 (32×48) de kullanımda).
// Genişlik oranı (wr): yatay çarpan ayrı seçilir — dar/geniş ("ince/kalın"
// görünüm; bitmap'te vuruş kalınlığı genişlikle ölçeklenir).

const EPL_BASE_FONTS: ReadonlyArray<{ code: string; w: number; h: number }> = [
  { code: "1", w: 8, h: 12 },
  { code: "2", w: 10, h: 16 },
  { code: "3", w: 12, h: 20 },
  { code: "4", w: 14, h: 24 },
  { code: "5", w: 32, h: 48 },
];

/** DPL/PPLA taban fontları (203dpi, dot) — serbest-boyut seçici (resolveEplTextStyle)
 *  PPLA için BU tabloyla çağrılmalı. EPL2 tabanıyla çağrılırsa DPL yazıcıda hedeften
 *  ~%35 uzun basar (font3×2=40 dot seçilir → DPL 27×2=54 dot). Font5 DPL'de dar-uzun
 *  (18×52). ⚠️ Kalibrasyon gerekir (bkz. DPL_FONT). */
export const DPL_BASE_FONTS: ReadonlyArray<{ code: string; w: number; h: number }> = [
  { code: "1", w: 7, h: 13 },
  { code: "2", w: 10, h: 18 },
  { code: "3", w: 14, h: 27 },
  { code: "4", w: 18, h: 36 },
  { code: "5", w: 18, h: 52 },
];

/** DPL barkod/2D modül çarpanı → TEK karakter kodu. DPL alanı tek karakter ister:
 *  1-9 → '1'..'9', 10-35 → 'A'..'Z', 36-61 → 'a'..'z'. İki-haneli ondalık ("10") YAZMA
 *  — sabit-alan header'ını kaydırır (eski `1W1c`+padStart(2) bug'ının ta kendisi). */
export function dplBarcodeMul(n: number): string {
  const v = Math.max(1, Math.min(61, Math.round(n)));
  if (v <= 9) return String(v);
  if (v <= 35) return String.fromCharCode(55 + v); // 10→'A'(65) … 35→'Z'(90)
  return String.fromCharCode(61 + v); // 36→'a'(97) … 61→'z'(122)
}

/** dplBarcodeMul tersi — önizleme parser'ı tek-karakter modülü sayıya çevirir. */
export function dplBarcodeMulToNum(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 49 && c <= 57) return c - 48; // '1'-'9'
  if (c >= 65 && c <= 90) return c - 55; // 'A'-'Z' → 10-35
  if (c >= 97 && c <= 122) return c - 61; // 'a'-'z' → 36-61
  return 4; // güvenli varsayılan
}

export interface EplTextStyle {
  code: string;
  /** Dikey çarpan (yükseklik). */
  vmul: number;
  /** Yatay çarpan (genişlik — wr buradan). */
  hmul: number;
  /** Fiilen basılacak hücre (dot) — editör/önizleme "gerçekte ne çıkacak" için. */
  hDots: number;
  wDots: number;
}

/**
 * Hedef glif yüksekliği (dot) + genişlik oranı → (font, vmul, hmul).
 * Eşit sapmada BÜYÜK temel font tercih edilir (piksel çoğaltma yerine daha ince
 * doğal detay). maxMul: PPLB=6 (EPL2 güvenli aralık). `baseFonts` verilmezse EPL2
 * tablosu; PPLA/DPL çağrıları DPL_BASE_FONTS geçmeli (dile-doğru fiziksel boyut).
 */
export function resolveEplTextStyle(
  targetHDots: number,
  wr: number,
  maxMul: number,
  baseFonts: ReadonlyArray<{ code: string; w: number; h: number }> = EPL_BASE_FONTS,
): EplTextStyle {
  let best = { f: baseFonts[1] ?? baseFonts[0]!, v: 1, diff: Number.POSITIVE_INFINITY };
  for (const f of baseFonts) {
    for (let v = 1; v <= maxMul; v++) {
      const diff = Math.abs(f.h * v - targetHDots);
      if (diff < best.diff || (diff === best.diff && f.h > best.f.h)) {
        best = { f, v, diff };
      }
    }
  }
  const hmul = Math.max(1, Math.min(maxMul, Math.round(best.v * wr)));
  return {
    code: best.f.code,
    vmul: best.v,
    hmul,
    hDots: best.f.h * best.v,
    wDots: best.f.w * hmul,
  };
}

/** QR kodlama modu (ISO/IEC 18004). Yazıcı p7 varsayılan OTOMATİK → bu STANDART seçimi
 *  yapar: yalnız rakam → numeric; STANDART alnum seti (SADECE büyük harf) → alnum; aksi
 *  (küçük harf/Türkçe/ç..) → byte. Byte kapasitesi en düşük → en büyük sürüm → en büyük
 *  ayak izi; mod'a bakmayan eski lookup bunu kaçırıp QR'ı metne bindirebiliyordu. */
export function qrMode(data: string): "numeric" | "alnum" | "byte" {
  if (/^[0-9]+$/.test(data)) return "numeric";
  if (/^[0-9A-Z $%*+./:-]+$/.test(data)) return "alnum"; // STANDART alnum: küçük harf YOK
  return "byte";
}

/** ECC seviyesi M için sürüm başına maks. karakter (v1..v10) — ISO/IEC 18004 kapasite
 *  tablosu. Emit QR komutuna `e` yazmıyoruz → yazıcı varsayılanı M (manuel p6 default M);
 *  önizleme bwip'i de M'e pinli → hesap = yazıcı = önizleme, üçü de aynı sürümü verir. */
const QR_CAP_M: Record<"numeric" | "alnum" | "byte", number[]> = {
  numeric: [34, 63, 101, 149, 202, 255, 293, 365, 432, 513],
  alnum: [20, 38, 61, 90, 122, 154, 178, 221, 262, 311],
  byte: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
};

/** Verinin GERÇEK QR sürümü (1..10) — mod + ECC M kapasitesinden. Yazıcının fiilen
 *  seçtiği sürümle birebir (aynı standart). Kaba uzunluk-lookup DEĞİL. */
export function qrVersion(data: string): number {
  const caps = QR_CAP_M[qrMode(data)];
  const len = data.length;
  for (let v = 0; v < caps.length; v++) if (len <= caps[v]) return v + 1;
  return caps.length; // master-data barkodu v10'u aşmaz; güvenli tavan
}

/** QR sembol modül sayısı (kenar) = 17 + 4×sürüm. Veri STRING'inden — mod-farkındalıklı,
 *  TAM (v1=21, v2=25, ...). Generator (textX rezervi) + önizleme (görsel boyut) BUNU
 *  paylaşır → "gördüğün = basılan". */
export function qrSymbolModules(data: string): number {
  return 17 + 4 * qrVersion(data);
}

/** QR spec sessiz-bölge (her kenar modül). */
export const QR_QUIET_MODULES = 4;

/** QR toplam ayak izi (dot) = (sembol + 2×sessiz) × büyütme. Yazıcı `s<mag>` modeli:
 *  her modül `mag` dot. Generator (textX) ve önizleme (görsel boyut) BUNU paylaşır. */
export function qrFootprintDots(data: string, mag: number): number {
  return (qrSymbolModules(data) + 2 * QR_QUIET_MODULES) * Math.max(1, mag);
}

/** Metraj bandı değeri — TR-formatlı sayı + "m" (metre) son eki, boşluksuz bitişik
 *  ("230,5m"). Dar dikey şeritte kompakt. TÜM diller (PPLB/PPLA/ZPL/HTML) + önizleme
 *  bu tek metni kullanır → gördüğün = basılan. Değer yoksa "" döner (çağıran zaten
 *  present-guard'lı; ham `String(lengthMeters)` binlik-ayıraç + birimsiz veriyordu).
 *  unit=false → yalnız sayı (kanvas LengthBannerElement.unit; akış-modeli hep true). */
export function bannerValueText(payload: LabelPayload, unit = true): string {
  const v = payload.lengthMeters;
  if (v == null || String(v).trim() === "") return "";
  const num = formatNumber(v);
  return unit ? `${num}m` : num;
}

// Türkçe → ASCII eşlemesi (İ/Ş/Ğ/ç vb.). Native gönderimde KRİTİK: ham 9100 baytları
// latin1; latin1-dışı karakter (İ=U+0130) kayıplı çevrilir VE daha kötüsü latin1'de
// komut-baytına denk gelir (Ş=U+015E→0x5E '^' ZPL öneki, Ğ=U+011E→0x1E kontrol) →
// frame bozulur. ASCII'ye katlayarak hem doğru hem güvenli yaparız (yazıcı codepage'i
// gerektiren tam Türkçe glif = Faz-2 fiziksel ayar konusu).
const TR_TO_ASCII: Record<string, string> = {
  "ç": "c", "Ç": "C", "ğ": "g", "Ğ": "G", "ı": "i", "İ": "I",
  "ö": "o", "Ö": "O", "ş": "s", "Ş": "S", "ü": "u", "Ü": "U",
};

/** Metni ASCII'ye katla — Türkçe map + diакритik ayıkla + kalan latin1-dışını at. */
export function asciiFold(s: string): string {
  const mapped = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_TO_ASCII[c] ?? c);
  return mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // ASCII dışı her kod noktası düşer (ZPL/PPLB tek bayt bekler).
    .replace(/[^\x00-\x7f]/g, "");
}

/**
 * Native veri alanı temizleme — kontrol karakterlerini (STX/CR/LF) ayıkla VE ASCII'ye
 * katla (latin1 kaybı/komut-baytı enjeksiyonu engellenir). Komut yapısına dokunmaz;
 * yalnız text/barkod veri alanlarına uygulanır.
 */
export function cleanCtl(s: string | number | null | undefined): string {
  // Kontrol/ASCII-dışı kod noktaları ayıklanır (yazıcı tek bayt bekler).
  return asciiFold(String(s ?? "").replace(/[\x00-\x1f]/g, " ")).trim();
}

/** Türkçe glif → CP1254 (Windows-1254) baytı. latin1'den YALNIZ bu 6 kod noktası farklı;
 *  ç/ö/ü/Ç/Ö/Ü + gerisi latin1 = cp1254 (Unicode kod noktası = bayt değeri). */
const TR_TO_CP1254: Record<string, string> = {
  "Ğ": "Ð", "İ": "Ý", "Ş": "Þ", "ğ": "ð", "ı": "ý", "ş": "þ",
};

/** CP1254 baytı → Türkçe Unicode — önizleme parser'ı (native-preview `esc`) için TERS
 *  eşleme. Bu 6 latin1 kodu (Ð/Ý/Þ/ð/ý/þ) Türkçe tekstil etiketinde asla geçmez → codepage
 *  kontrolü gerekmez, güvenle her yerde geri eşlenir → önizleme Türkçe glifi gösterir. */
export const CP1254_TO_UNICODE: Record<string, string> = {
  "Ð": "Ğ", "Ý": "İ", "Þ": "Ş", "ð": "ğ", "ý": "ı", "þ": "ş",
};

/**
 * CP1254-farkında native veri temizleme — asciiFold YERİNE (codepage destekleyen dilde,
 * ör. PPLB `I8,E`). Türkçe glifi cp1254 BAYTINA eşler (yazıcı 1254 codepage'iyle GERÇEK
 * Türkçe basar), latin1'i korur, kalan non-latin1'i fold eder. Baytlar char-code olarak
 * string'e girer → mevcut latin1 transmit birebir gönderir (transmit'e dokunmadan). Kontrol
 * baytları ayıklanır (frame güvenliği). Önizleme (esc) baytları geri Türkçe'ye eşler → =çıktı.
 */
export function cleanCtlCp1254(s: string | number | null | undefined): string {
  // Kontrol/ASCII-dışı kod noktaları ayıklanır (yazıcı tek bayt bekler).
  const stripped = String(s ?? "").replace(/[\x00-\x1f]/g, " ").trim();
  let out = "";
  for (const ch of stripped) {
    const cp = TR_TO_CP1254[ch];
    if (cp) out += cp;
    else out += ch.charCodeAt(0) <= 0xff ? ch : asciiFold(ch); // latin1 (çöüÇÖÜ dahil) koru
  }
  return out;
}

export interface RollTextLine {
  text: string;
  /** Büyük font (ürün adı + metraj). */
  big?: boolean;
}

/** Etiketin sıralı metin satırları (barkod hariç) — üç native dil paylaşır.
 *  kind=SWATCH (kartela) iken metraj yerine En×Boy + Kart No / Ana Top satırları. */
export function rollTextLines(p: LabelPayload): RollTextLine[] {
  const lines: RollTextLine[] = [];
  lines.push({ text: cleanCtl(p.itemName || "-"), big: true });
  if (p.colorName) lines.push({ text: `Renk: ${cleanCtl(p.colorName)}` });

  if (p.kind === LabelKind.SWATCH) {
    lines.push({ text: `En: ${p.widthCm ?? "-"} cm   Boy: ${p.lengthCm ?? "-"} cm`, big: true });
    if (p.weightKg != null) lines.push({ text: `Agirlik: ${cleanCtl(p.weightKg)} kg` });
    if (p.cardNumber) lines.push({ text: `Kart No: ${cleanCtl(p.cardNumber)}` });
    if (p.customerName) lines.push({ text: `Musteri: ${cleanCtl(p.customerName)}` });
    if (p.parentRollBarcode) lines.push({ text: `Ana Top: ${cleanCtl(p.parentRollBarcode)}` });
    return lines;
  }

  lines.push({ text: `Kalite: ${cleanCtl(p.qualityGrade ?? "-")}` });
  lines.push({ text: `${cleanCtl(p.lengthMeters)} mt   En: ${p.widthCm ?? "-"} cm`, big: true });
  if (p.weightKg != null) lines.push({ text: `Agirlik: ${cleanCtl(p.weightKg)} kg` });
  if (p.customerName) lines.push({ text: `Musteri: ${cleanCtl(p.customerName)}` });
  if (p.batchNumber) lines.push({ text: `Parti: ${cleanCtl(p.batchNumber)}` });
  return lines;
}

/** Native metin satırı — boyut + bold şablondan gelir; native helper'lar dile
 *  özgü font koduna eşler. text HAM (sanitize edilmemiş) — helper cleanCtl uygular. */
export interface NativeTextLine {
  text: string;
  size: FontSize;
  bold: boolean;
}

/**
 * Şablon-bilinçli native metin satırları (üç dil paylaşır). template null →
 * mevcut `rollTextLines` çıktısına delege (büyük→lg/normal→md, bold yok) =
 * BAYT-AYNI geri uyum. template dolu → görünür + scan-olmayan + değeri olan
 * alanlar `order`'a göre; headline çıplak değer, row "Etiket: değer"; size/bold
 * şablon `fontSize`/`isBold`'dan. Sol QR+barkod tarama kolonu burada YOK (sabit).
 */
export function templateTextLines(
  payload: LabelPayload,
  template: LabelTemplate | null,
): NativeTextLine[] {
  if (!template) {
    return rollTextLines(payload).map((ln) => ({
      text: ln.text,
      size: (ln.big ? "lg" : "md") as FontSize,
      bold: false,
    }));
  }
  const fields = (template.fields as unknown as TemplateField[] | null) ?? null;
  if (!fields) {
    return rollTextLines(payload).map((ln) => ({
      text: ln.text,
      size: (ln.big ? "lg" : "md") as FontSize,
      bold: false,
    }));
  }
  return fields
    .filter((f) => f.isVisible)
    .map((f) => ({ f, dv: fieldDisplayValue(payload, f.key) }))
    .filter((x) => x.dv.role !== "scan" && x.dv.present)
    .sort((a, b) => a.f.order - b.f.order)
    .map(({ f, dv }) => {
      const headline = dv.role === "headline";
      const size: FontSize = f.fontSize ?? (headline ? "lg" : "md");
      // Alan etiketi (label) doluysa "Etiket: değer", boşsa yalnız değer — kullanıcı
      // FieldsPanel'den başlığı yazar/siler. (Eskiden headline alanlar label'ı düşürüyordu.)
      const label = f.label?.trim();
      const text = label ? `${label}: ${dv.value}` : dv.value;
      return { text, size, bold: f.isBold ?? false };
    });
}

/** Emit-katmanı kopya tavanı — 100 (Etiket Stüdyosu şablon baskısı toplu basabilir).
 *  Rulo/kartela fabrika akışı 5'te kalır: bulk uçları Zod max(5), tekil uçlar
 *  label.service clampRollCopies (1-5) girişte kırpar — 100 oraya SIZMAZ. */
export function clampCopies(copies: number): number {
  return Math.max(1, Math.min(100, copies || 1));
}

/** Metin hizalama x-kayması (dot) — çapa (x) referanslı: left=0, center=−w/2, right=−w.
 *  widthDots = satırın basılacak genişliği. Çok satırlı metin expandMultilineText'te
 *  satırlara bölünür; her satır kendi genişliğiyle çapaya hizalanır → satırlar hizalı. */
export function alignOffsetDots(align: "left" | "center" | "right" | undefined, widthDots: number): number {
  if (align === "center") return -Math.round(widthDots / 2);
  if (align === "right") return -Math.round(widthDots);
  return 0;
}

/** Harf dönüşümü — Türkçe-duyarlı (i↔İ, ı↔I). Yok → dokunma. Native + raster + HTML
 *  aynı dönüşümü uygular → tüm dillerde aynı metin (sanitize/asciiFold sonradan). */
export function applyTextCase(text: string, textCase: "upper" | "lower" | undefined): string {
  if (textCase === "upper") return upperTr(text);
  if (textCase === "lower") return lowerTr(text);
  return text;
}
