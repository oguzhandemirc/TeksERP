// =============================================================================
// Belge şablonu Liquid filtreleri — İZİN LİSTESİ (yerleşikler) + kendi filtrelerimiz
// =============================================================================
// Şablon hesap yapmaz, saat dilimini ve sayı rejimini seçemez, Türkçe büyük harfi
// atlatamaz: tarih/sayı/para/harf filtreleri belge renderer'larının TEK kaynak
// yardımcılarına bağlanır (fmt-date, docNum, upperTr/lowerTr, barcode-svg). Rejim ve
// SVG deposu render başına `Context` kaydından okunur — motorda değişken durum yok.
// Filtre ADLARI Türkçedir (şablon yazarının gördüğü tel anahtarı). Plan: §5.

import type { Context } from "liquidjs";
import { fmtCalendarDate, fmtDate, fmtDateTime } from "../../document-render/fmt-date";
import { roundHalfUpParts, type DocNum } from "../../document-render/fmt-num";
import { stripRawMarkers } from "../../document-render/template-html.sanitize";
import { renderCode128Svg, renderQrSvg } from "../../helpers/barcode-svg.helper";
import { lowerTr, upperTr } from "../../../utils/tr-case";
import { integerWordsTr, TR_NUMBER_WORDS_LIMIT } from "../../../utils/tr-number-words";
import { escapeHtml, SafeHtml, TemplateUserError, toText } from "./cikti";

/** Render başına durum: sayı rejimi + temizlik SONRASI yerine konacak SVG'ler. */
export interface RenderState {
  readonly num: DocNum;
  readonly marker: (key: string) => string;
  readonly svg: Record<string, string>;
  counter: number;
}
export const RENDER_STATE_KEY = "tekserp";

interface FilterThis {
  readonly context: Context;
}
type FilterFn = (this: FilterThis, v: unknown, ...args: unknown[]) => unknown;

function renderState(ctx: Context): RenderState {
  const st = ctx.getRegister(RENDER_STATE_KEY) as RenderState | undefined;
  if (!st) throw new TemplateUserError("İç hata: şablon render kaydı yok");
  return st;
}

// ── Yerleşik filtreler: yalnız bunlar kalır (geri kalanı motordan silinir) ─────────────
export const ALLOWED_BUILTIN_FILTERS: readonly string[] = [
  "default", "strip", "lstrip", "rstrip", "strip_newlines", "strip_html", "truncate", "truncatewords",
  "replace", "replace_first", "remove", "remove_first", "append", "prepend", "split", "join",
  "first", "last", "size", "where", "map", "sort", "sort_natural", "reverse", "uniq", "compact", "slice",
];

const DATE_REJECT = "Tarih için 'tarih', 'tarih_saat', 'takvim' ya da 'saat' filtresini kullanın (fabrika saat dilimi)";
const MATH_REJECT = "Şablon hesap yapmaz; toplam ve türetilmiş sayılar sözleşmeden gelir";

/** Adıyla reddedilen filtreler ve Türkçe gerekçeleri (strictFilters bunları parse anında düşürür). */
export const REJECTED_FILTERS: Readonly<Record<string, string>> = {
  date: DATE_REJECT,
  date_to_xmlschema: DATE_REJECT,
  date_to_rfc822: DATE_REJECT,
  date_to_string: DATE_REJECT,
  date_to_long_string: DATE_REJECT,
  plus: MATH_REJECT, minus: MATH_REJECT, times: MATH_REJECT, divided_by: MATH_REJECT, modulo: MATH_REJECT,
  abs: MATH_REJECT, ceil: MATH_REJECT, floor: MATH_REJECT, round: MATH_REJECT, at_least: MATH_REJECT,
  at_most: MATH_REJECT, sum: MATH_REJECT, to_integer: MATH_REJECT,
  raw: "'raw' filtresi kapalı: veri her zaman kaçışlı basılır",
  json: "'json' filtresi kapalı: alanları tek tek basın",
  jsonify: "'jsonify' filtresi kapalı: alanları tek tek basın",
  inspect: "'inspect' filtresi kapalı: alanları tek tek basın",
  newline_to_br: "'newline_to_br' yerine 'satir_kir' filtresini kullanın (satır sonları güvenli <br> olur)",
};

// ── Yardımcılar ─────────────────────────────────────────────────────────────────────
function isoText(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function digitsArg(filter: string, v: unknown, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 6) {
    throw new TemplateUserError(`'${filter}' filtresinde hane 0–6 arası tam sayı olmalı`);
  }
  return v;
}

function unitNumber(filter: string, unit: string, defaultDigits: number): FilterFn {
  return function (this: FilterThis, v: unknown, d?: unknown): string {
    const s = renderState(this.context).num.tr(toNumber(v), digitsArg(filter, d, defaultDigits));
    return s === "" ? "" : `${s} ${unit}`;
  };
}

/** Finans belgelerindeki `fmtMoney` ile BAYT-EŞİT (finance-doc.html.ts): boş "—", sayı tr-TR 2 hane, çözülemeyen metin kaçışlı. */
function moneyText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return escapeHtml(toText(v));
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currencyArg(filter: string, v: unknown): string | null {
  if (v === undefined) return null;
  if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)) throw new TemplateUserError(`'${filter}' filtresinde para birimi üç büyük harfli kod olmalı (ör. "TRY")`);
  return v;
}

const WORD_UNITS: Readonly<Record<string, readonly [string, string]>> = {
  TRY: ["TL", "Kr"],
  USD: ["ABD Doları", "Sent"],
  EUR: ["Avro", "Sent"],
  GBP: ["İngiliz Sterlini", "Peni"],
};

/** "Yalnız bin iki yüz otuz dört TL elli Kr" — kuruş ticari yuvarlamayla (fmt-num tek kaynak). */
export function amountInWords(v: unknown, currency = "TRY"): string {
  const n = toNumber(v);
  if (n === null) return "";
  const units = WORD_UNITS[currency];
  if (!units) throw new TemplateUserError(`'yaziyla' filtresi bu para birimini desteklemiyor: ${currency}`);
  const p = roundHalfUpParts(n, 2);
  const whole = Number(p.int);
  const cents = Number(p.frac);
  const wholeWords = integerWordsTr(whole);
  if (!wholeWords || whole >= TR_NUMBER_WORDS_LIMIT) throw new TemplateUserError("'yaziyla' filtresi bu büyüklükte tutarı yazamaz");
  const parts: string[] = ["Yalnız"];
  if (p.neg) parts.push("eksi");
  if (whole > 0 || cents === 0) parts.push(...wholeWords, units[0]);
  if (cents > 0) parts.push(...(integerWordsTr(cents) ?? []), units[1]);
  return parts.join(" ");
}

/** CSS dize değişmezi (`content:` için): tırnak, ters bölü, `<`/`>`/`&` ve denetim karakterleri kaçışlı. */
export function cssString(s: string): string {
  let out = '"';
  for (const ch of stripRawMarkers(s)) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (cp < 0x20 || cp === 0x7f || "\"'<>&".includes(ch)) out += `\\${cp.toString(16)} `;
    else out += ch;
  }
  return out + '"';
}

const BARCODE_MAX = 500;

function barcodeFilter(this: FilterThis, v: unknown, kind: unknown = "code128"): SafeHtml | string {
  const value = stripRawMarkers(toText(v));
  if (value === "") return "";
  if (value.length > BARCODE_MAX) throw new TemplateUserError(`Barkod metni ${BARCODE_MAX} karakteri aşamaz`);
  if (kind !== "code128" && kind !== "qr") throw new TemplateUserError("'barkod' filtresinin türü \"code128\" ya da \"qr\" olmalı");
  const st = renderState(this.context);
  const svg = kind === "qr" ? renderQrSvg(value) : renderCode128Svg(value);
  this.context.memoryLimit.use(svg.length);
  const key = `S${++st.counter}`;
  st.svg[key] = svg;
  return new SafeHtml(st.marker(key));
}

// ── Kendi filtrelerimiz (ad → uygulama) ─────────────────────────────────────────────
export const CUSTOM_FILTERS: Readonly<Record<string, FilterFn>> = {
  tarih: (v) => fmtDate(isoText(v), ""),
  tarih_saat: (v) => fmtDateTime(isoText(v), ""),
  takvim: (v) => fmtCalendarDate(isoText(v), ""),
  // fmtDateTime "GG.AA.YYYY SS:DD" — saat kısmı aynı dilim çözümünden.
  saat: (v) => fmtDateTime(isoText(v), "").slice(11),
  sayi: function (this: FilterThis, v: unknown, d?: unknown): string {
    return renderState(this.context).num.tr(toNumber(v), digitsArg("sayi", d, 2));
  },
  metre: unitNumber("metre", "m", 2),
  kg: unitNumber("kg", "kg", 2),
  adet: unitNumber("adet", "adet", 0),
  para: (v, c) => {
    const currency = currencyArg("para", c);
    return currency ? `${moneyText(v)} ${currency}` : moneyText(v);
  },
  yaziyla: (v, c) => amountInWords(v, currencyArg("yaziyla", c) ?? "TRY"),
  barkod: barcodeFilter,
  qr: function (this: FilterThis, v: unknown): SafeHtml | string {
    return barcodeFilter.call(this, v, "qr");
  },
  css_metin: (v) => new SafeHtml(cssString(toText(v))),
  satir_kir: (v) => new SafeHtml(escapeHtml(stripRawMarkers(toText(v))).replace(/\r?\n/g, "<br>")),
  // Yerleşiklerin Türkçe/kaçış ezmeleri:
  upcase: (v) => upperTr(toText(v)),
  downcase: (v) => lowerTr(toText(v)),
  capitalize: (v) => {
    const chars = Array.from(toText(v));
    return chars.length ? upperTr(chars[0]!) + lowerTr(chars.slice(1).join("")) : "";
  },
  escape: (v) => new SafeHtml(escapeHtml(stripRawMarkers(toText(v)))),
};

/** Şablonun kullanabildiği bütün filtre adları (yönerge derleyicisi `data-filtre`yi buna göre denetler). */
export const ALLOWED_FILTER_NAMES: ReadonlySet<string> = new Set([
  ...ALLOWED_BUILTIN_FILTERS,
  ...Object.keys(CUSTOM_FILTERS),
]);
