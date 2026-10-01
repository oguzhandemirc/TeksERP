// =============================================================================
// Şablon CSS'i — `<style>` içeriği ve `style` özniteliği için. CSS kod çalıştıramaz ama
// KAYNAK YÜKLETİR: `url(//sunucu/pay)` önizleme çerçevesinde dosya ağ yoluna (UNC)
// çözülebilir, `@import` dış stil getirir. Kesilen: izinsiz adresli `url()`, `@import`,
// kaynak yükleyen diğer işlevler (image-set, cross-fade…). İşlev adları CSS kaçışı
// çözülerek okunur (`u\72l(` = `url(`).
// =============================================================================

export const CSS_REMOVED = {
  import: "dış stil (@import)",
  fn: "izinsiz CSS işlevi",
  url: "izinsiz adres",
  script: "script şeması",
  data: "izinsiz data: adresi",
} as const;

/** Kaynak yükleyen ve url() dışında adres taşıyan işlevler — hepsi `none` olur. */
const BLOCKED_FUNCTIONS = new Set([
  "image-set", "-webkit-image-set", "cross-fade", "-webkit-cross-fade", "element", "-moz-element",
  "image", "src", "expression",
]);

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml)[;,]/i;

export type UrlVerdict = "ok" | "url" | "script" | "data";

/** URL ayrıştırıcılarının yok saydığı boşluk/denetim karakterleri (`java\tscript:` = `javascript:`). */
export function stripUrlNoise(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

/** Görsel/dış kaynak adresi kararı (HTML `src` ve CSS `url()` ORTAK). Göreli adres HAYIR. */
export function classifyResourceUrl(decoded: string): UrlVerdict {
  const u = stripUrlNoise(decoded);
  if (u === "") return "ok";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return "ok";
  if (scheme === "data") return SAFE_DATA_IMAGE.test(u) ? "ok" : "data";
  if (scheme === "javascript" || scheme === "vbscript") return "script";
  return "url";
}

const HEX = /[0-9a-fA-F]/;

/** `\` kaçışını çözer; dönen [karakter, yeni konum]. */
function readEscape(css: string, i: number): [string, number] {
  let j = i + 1;
  let hex = "";
  while (j < css.length && hex.length < 6 && HEX.test(css[j] ?? "")) hex += css[j++];
  if (hex) {
    if (/[ \t\n\r\f]/.test(css[j] ?? "")) j++;
    const cp = parseInt(hex, 16);
    return [cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp), j];
  }
  if (j >= css.length) return ["�", j];
  if (css[j] === "\n") return ["", j + 1];
  return [css[j] ?? "", j + 1];
}

const isNameChar = (c: string | undefined): boolean => c !== undefined && (/[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) > 0x7f);

/** Ad (ident) okur; dönen [ham, çözülmüş, yeni konum]. */
function readName(css: string, i: number): [string, string, number] {
  let j = i;
  let decoded = "";
  while (j < css.length) {
    const c = css[j];
    if (c === "\\" && css[j + 1] !== "\n") {
      const [ch, k] = readEscape(css, j);
      decoded += ch;
      j = k;
    } else if (isNameChar(c)) {
      decoded += c;
      j++;
    } else break;
  }
  return [css.slice(i, j), decoded, j];
}

function skipString(css: string, i: number): number {
  const q = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== q && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, css.length);
}

/** `(`dan başlayıp eşleşen `)`ın SONRASI; kapanmıyorsa -1 (dize ve kaçış farkında). */
function matchParen(css: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < css.length) {
    const c = css[j];
    if (c === '"' || c === "'") {
      j = skipString(css, j);
      continue;
    }
    if (c === "\\") j += 2;
    else {
      if (c === "(") depth++;
      if (c === ")" && --depth === 0) return j + 1;
      j++;
    }
  }
  return -1;
}

/** Kapanmayan işlev metin sonuna kadar sürer (tarayıcı da öyle okur). */
function skipParens(css: string, i: number): number {
  const end = matchParen(css, i);
  return end < 0 ? css.length : end;
}

/** `url(` argümanını çözer (tırnaklı ya da tırnaksız). */
function decodeUrlArg(raw: string): string {
  const t = raw.trim();
  const body = (t.startsWith('"') || t.startsWith("'")) ? t.slice(1, t.endsWith(t[0] ?? "") && t.length > 1 ? -1 : undefined) : t;
  let out = "";
  for (let j = 0; j < body.length; ) {
    if (body[j] === "\\") {
      const [ch, k] = readEscape(body, j);
      out += ch;
      j = k;
    } else out += body[j++];
  }
  return out;
}

export interface CssResult {
  readonly css: string;
  readonly removed: readonly string[];
}

function skipAtImport(css: string, i: number): number {
  let j = i;
  while (j < css.length && css[j] !== ";") {
    if (css[j] === '"' || css[j] === "'") j = skipString(css, j);
    else if (css[j] === "(") j = skipParens(css, j);
    else j++;
  }
  return Math.min(j + 1, css.length);
}

/** Bir CSS metnini temizler; değişmeyen girdi BAYT-BAYT aynı döner. */
export function sanitizeCss(css: string): CssResult {
  const removed = new Set<string>();
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i] ?? "";
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      const stop = skipString(css, i);
      out += css.slice(i, stop);
      i = stop;
    } else if (c === "@") {
      const [raw, name, j] = readName(css, i + 1);
      if (name.toLowerCase() === "import") {
        removed.add(CSS_REMOVED.import);
        i = skipAtImport(css, j);
      } else {
        out += "@" + raw;
        i = j;
      }
    } else if (isNameChar(c) || c === "\\") {
      const [raw, name, j] = readName(css, i);
      if (raw === "") {
        out += c;
        i++;
        continue;
      }
      const fn = name.toLowerCase();
      if (css[j] === "(" && fn === "url") {
        const close = matchParen(css, j);
        const stop = close < 0 ? css.length : close;
        // Kapanmayan url( metin sonuna kadar sürer — argümanın son karakteri KESİLMEZ.
        const verdict = classifyResourceUrl(decodeUrlArg(css.slice(j + 1, close < 0 ? stop : stop - 1)));
        if (verdict === "ok") out += css.slice(i, stop);
        else {
          removed.add(CSS_REMOVED[verdict]);
          out += "none";
        }
        i = stop;
      } else if (css[j] === "(" && BLOCKED_FUNCTIONS.has(fn)) {
        removed.add(CSS_REMOVED.fn);
        out += "none";
        i = skipParens(css, j);
      } else {
        out += raw;
        i = j;
      }
    } else {
      out += c;
      i++;
    }
  }
  return { css: out, removed: [...removed] };
}
