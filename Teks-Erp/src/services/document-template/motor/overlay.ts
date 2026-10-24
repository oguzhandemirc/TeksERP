// =============================================================================
// Üst katman — filigran (TASLAK/İPTAL/ESKİ KOPYA) + künye; şablon ikisini de gizleyemez
// =============================================================================
// Üç kat koruma: (1) kurallar şablon CSS'inden ÖNCE açılan ilk katmanda (`@layer`) —
// `!important` bildirimde ilk katman hem sonraki katmanları hem katmansız şablon
// kurallarını yener (şablonun kendi `@layer`'ı bu yüzden işe yaramaz); (2) üç kimlikli
// seçici + `!important`; (3) şablon CSS'i `tekserp` adını, `@bottom-left`'i, sözde-işlev
// içinde `#`'yi ve `@page` kenarını YAZAMAZ (doğrulayıcı aşağıda; render anında da koşar,
// çünkü Liquid adı çalışma anında üretebilir). html/body'nin id/class/style'ı boş dolu
// basılır: şablondaki `<body style=…>` öznitelik birleştirmesiyle kök öğeye ulaşamaz.

import { decodeAttrEntities } from "../../document-render/template-html.entities";
import { tokenizeHtml } from "../../document-render/template-html.tokenizer";
import { cssFixed } from "../../document-render/fmt-num";
import { cssString } from "./filtreler";

export type WatermarkKind = "DRAFT" | "VOIDED" | "SUPERSEDED";

export const WATERMARK_TEXT: Readonly<Record<WatermarkKind, string>> = {
  DRAFT: "TASLAK",
  VOIDED: "İPTAL",
  SUPERSEDED: "ESKİ KOPYA",
};

/** Künye: sol-alt sayfa kutusunda her sayfada basılır. */
export interface ImprintInput {
  readonly docNo: string;
  readonly versionNo: number;
  /** Durumun Türkçe adı (ör. "Geçerli", "İptal"). */
  readonly status: string;
  readonly reviseReason?: string | null;
  readonly reconstructed?: boolean;
}

export interface OverlayInput {
  readonly watermark?: WatermarkKind | null;
  readonly imprint?: ImprintInput | null;
}

export const RESERVED_PREFIX = "tekserp";
export const ROOT_IDS = { html: "tekserp-h", body: "tekserp-b", watermark: "tekserp-f" } as const;
const LAYER = "tekserp-o";
/** Künye için alt kenarın en az payı. */
export const IMPRINT_MIN_BOTTOM_MM = 8;

const triple = (id: string): string => `#${id}#${id}#${id}`;

const ROOT_RESET = [
  "display:block", "visibility:visible", "opacity:1", "filter:none", "backdrop-filter:none",
  "transform:none", "translate:none", "scale:none", "rotate:none", "perspective:none",
  "clip-path:none", "mask:none", "-webkit-mask:none", "content-visibility:visible", "zoom:1",
  "contain:none", "container-type:normal", "will-change:auto", "mix-blend-mode:normal",
].map((d) => `${d}!important`).join(";");

function watermarkRule(kind: WatermarkKind): string {
  const color = kind === "VOIDED" ? "rgba(220,38,38,0.16)" : "rgba(100,116,139,0.18)";
  const decl = [
    "position:fixed", "top:42%", "left:0", "right:0", "bottom:auto", "width:auto", "height:auto",
    "min-width:0", "min-height:0", "max-width:none", "max-height:none", "margin:0", "padding:0",
    "display:block", "visibility:visible", "opacity:1", "filter:none", "transform:rotate(-22deg)",
    "translate:none", "scale:none", "rotate:none", "clip-path:none", "mask:none", "-webkit-mask:none",
    "content-visibility:visible", "zoom:1", "z-index:2147483647", "float:none", "overflow:visible",
    "background:none", "border:0", "outline:0", "box-shadow:none", "text-shadow:none",
    `color:${color}`, "-webkit-text-fill-color:currentcolor", "font-family:sans-serif", "font-size:96px",
    "font-weight:800", "font-style:normal", "line-height:1.2", "letter-spacing:8px", "text-indent:0",
    "text-align:center", "text-transform:none", "white-space:nowrap", "writing-mode:horizontal-tb",
    "direction:ltr", "mix-blend-mode:normal", "pointer-events:none",
  ].map((d) => `${d}!important`).join(";");
  const w = triple(ROOT_IDS.watermark);
  return `${w}{${decl}}${w}::before,${w}::after{content:none!important;display:none!important}`;
}

function imprintText(i: ImprintInput): string {
  const parts = [i.docNo, `v${i.versionNo}`, i.status];
  if (i.reviseReason) parts.push(i.reviseReason);
  if (i.reconstructed) parts.push("yeniden kurulmuş kopya");
  return parts.filter((p) => p !== "").join(" · ");
}

/**
 * Şablon CSS'inden ÖNCE gelen `<style>` içeriği. İlk ifade katman bildirimidir —
 * katman sırası ilk görülüşle belirlenir, bu yüzden şablon önüne geçemez.
 */
export function overlayHeadCss(o: OverlayInput, bottomMarginMm: number): string {
  const h = triple(ROOT_IDS.html);
  const b = triple(ROOT_IDS.body);
  let layer = `${h},${b}{${ROOT_RESET}}`;
  layer += `${h}::before,${h}::after,${b}::before,${b}::after{content:none!important;display:none!important}`;
  if (o.watermark) layer += watermarkRule(o.watermark);
  let css = `@layer ${LAYER};@layer ${LAYER}{${layer}}`;
  if (o.imprint) {
    const box = `@bottom-left{content:${cssString(imprintText(o.imprint))};font-family:sans-serif;font-size:7pt;color:#555;vertical-align:bottom}`;
    const bottom = cssFixed(Math.max(bottomMarginMm, IMPRINT_MIN_BOTTOM_MM), 1);
    css += `@page{margin-bottom:${bottom}mm!important;${box}}@page :first{${box}}`;
  }
  return css;
}

/** `<body>` sonuna eklenen filigran öğesi (yoksa ""). Metin sabittir, kaçış gerekmez. */
export function overlayBodyHtml(o: OverlayInput): string {
  return o.watermark ? `<div id="${ROOT_IDS.watermark}" class="" style="" aria-hidden="true">${WATERMARK_TEXT[o.watermark]}</div>` : "";
}

// ── Doğrulayıcı (yayında 400, render'da 422) ─────────────────────────────────────

/** Yorumları atar, CSS kaçışlarını çözer, küçük harfe indirir (`@bottom-\6c eft` → `@bottom-left`). */
export function normalizeCssForCheck(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, " ")
    .replace(/\\\r?\n/g, "")
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "�";
    })
    .replace(/\\([\s\S])/g, "$1")
    .toLowerCase();
}

const PSEUDO_FUNCTIONS = /:(?:is|where|not|has|matches|any|-webkit-any|-moz-any|nth-child|nth-last-child|nth-of-type|nth-last-of-type|host|host-context)\(/g;

function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return s.length;
}

function closingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return s.length;
}

/** Şablon CSS'inde üst katmanı hedefleyebilecek yapılar — Türkçe mesaj listesi (boş = temiz). */
export function cssViolations(css: string): string[] {
  const n = normalizeCssForCheck(css);
  const out = new Set<string>();
  if (n.includes(RESERVED_PREFIX)) out.add("'tekserp' adı sisteme ayrılmıştır; şablon CSS'inde kullanılamaz");
  if (n.includes("@bottom-left")) out.add("'@bottom-left' sayfa kutusu künyeye ayrılmıştır");
  PSEUDO_FUNCTIONS.lastIndex = 0;
  for (let m = PSEUDO_FUNCTIONS.exec(n); m; m = PSEUDO_FUNCTIONS.exec(n)) {
    const open = m.index + m[0].length - 1;
    if (n.slice(open, closingParen(n, open)).includes("#")) {
      out.add("Sözde-sınıf içinde kimlik seçicisi (#) kullanılamaz (:is, :where, :not, :has, :nth-child …)");
    }
  }
  for (let at = n.indexOf("@page"); at >= 0; at = n.indexOf("@page", at + 5)) {
    const open = n.indexOf("{", at);
    if (open < 0) break;
    const block = n.slice(open, closingBrace(n, open) + 1);
    if (/(?:^|[;{\s])margin(?:-[a-z-]+)?\s*:/.test(block)) {
      out.add("Sayfa kenarı (@page margin) şablon CSS'inde yazılamaz; sayfa ayarlarından verilir");
    }
  }
  return [...out];
}

/** Temizlenmiş HTML'de `tekserp` kimlik/sınıf adı ve gömülü CSS ihlalleri. */
export function htmlViolations(html: string): string[] {
  const out = new Set<string>();
  let inStyle = false;
  for (const t of tokenizeHtml(html)) {
    if (t.kind === "start") {
      inStyle = t.name === "style";
      for (const a of t.attrs) {
        const value = (decodeAttrEntities(a.value) ?? a.value).toLowerCase();
        if ((a.name === "id" || a.name === "class") && value.includes(RESERVED_PREFIX)) {
          out.add("'tekserp' adı sisteme ayrılmıştır; kimlik ya da sınıf adında kullanılamaz");
        }
        if (a.name === "style") cssViolations(value).forEach((v) => out.add(v));
      }
    } else if (t.kind === "raw" && inStyle) {
      cssViolations(t.text).forEach((v) => out.add(v));
    } else if (t.kind === "end") inStyle = false;
  }
  return [...out];
}
