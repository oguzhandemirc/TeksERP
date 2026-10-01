// =============================================================================
// Kullanıcı yazımı belge/etiket HTML'i temizleyicisi — İZİN LİSTESİ (etiket + öznitelik +
// adres şeması) ve YENİDEN SERİLEŞTİRME. Uzman refakat kartı (RAW_HTML) ve etiket
// RASTER_HTML ham kodu buradan geçer: kayıtta, render'da ve DOLDURMA SONRASINDA (alan
// değeri ya da döngü tekrarı yapıyı değiştirse de çıktı yine temiz). Kesilen her şey
// kategoriyle raporlanır (stüdyo uyarısı). Kurallar: docs/kurallar/belge-etiket.md.
// Bilinçli serbest: dış http(s) <img>/<a> (belge kararı); önizleme/PDF'te ağ zaten kapalı.
// =============================================================================
import { RAW_CONTENT_ELEMENTS, tokenizeHtml, type HtmlAttr, type HtmlToken } from "./template-html.tokenizer";
import { classifyResourceUrl, sanitizeCss, stripUrlNoise, type UrlVerdict } from "./template-html.css";
import { decodeAttrEntities, encodeAttrValue } from "./template-html.entities";

export const REMOVED = {
  script: "script etiketi",
  embedded: "gömülü içerik etiketi",
  linkMeta: "link/meta etiketi",
  event: "olay özniteliği",
  scriptUrl: "script şeması",
  dataUrl: "izinsiz data: adresi",
  url: "izinsiz adres",
  form: "form/girdi etiketi",
  media: "medya etiketi",
  svg: "SVG/MathML içeriği",
  tag: "izinsiz etiket",
  attr: "izinsiz öznitelik",
  loopMarker: "yanlış yerde döngü işareti",
} as const;

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "html", "head", "body", "title", "style", "meta",
  "div", "span", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "address", "center",
  "b", "strong", "i", "em", "u", "s", "strike", "small", "big", "sub", "sup", "mark", "code", "kbd", "samp", "var",
  "tt", "font", "q", "cite", "abbr", "acronym", "dfn", "del", "ins", "bdi", "bdo", "wbr", "nobr", "time", "data",
  "ruby", "rt", "rp", "figure", "figcaption", "section", "article", "aside", "header", "footer", "main", "nav",
  "hgroup", "details", "summary", "fieldset", "legend",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col",
  "ul", "ol", "li", "dl", "dt", "dd", "menu", "img", "a",
  // Kâğıt kontrol listesi kutuları (betik yok, form/gönderim yok → zararsız).
  "input", "textarea", "progress", "meter",
]);

const VOID_TAGS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
  "param", "keygen", "basefont", "bgsound", "frame", "image", "isindex",
]);

/** İÇERİĞİYLE atılanlar (kapanışa kadar her şey; kapanış yoksa sona kadar — aşırı kesme güvenli yöndür). */
const DROP_SUBTREE: Readonly<Record<string, string>> = {
  script: REMOVED.script, iframe: REMOVED.embedded, frameset: REMOVED.embedded, object: REMOVED.embedded,
  applet: REMOVED.embedded, noembed: REMOVED.embedded, noframes: REMOVED.embedded, portal: REMOVED.embedded,
  fencedframe: REMOVED.embedded, select: REMOVED.form, datalist: REMOVED.form,
  audio: REMOVED.media, video: REMOVED.media, svg: REMOVED.svg, math: REMOVED.svg, template: REMOVED.tag,
  xmp: REMOVED.tag, plaintext: REMOVED.tag,
};

/** Tek başına atılan boş etiketler. */
const DROP_VOID: Readonly<Record<string, string>> = {
  link: REMOVED.linkMeta, base: REMOVED.linkMeta, meta: REMOVED.linkMeta, embed: REMOVED.embedded,
  frame: REMOVED.embedded, param: REMOVED.embedded, keygen: REMOVED.form,
  isindex: REMOVED.form, source: REMOVED.media, track: REMOVED.media, image: REMOVED.tag, area: REMOVED.tag,
};

/** Etiketi atılıp İÇERİĞİ korunan form ögeleri (diğer tanınmayanlar da böyle, kategori "izinsiz etiket"). */
const UNWRAP_FORM = new Set(["form", "button", "label", "output", "option", "optgroup"]);

const GLOBAL_ATTRS = new Set([
  "class", "id", "style", "title", "lang", "dir", "align", "valign", "width", "height", "bgcolor", "border",
  "bordercolor", "nowrap", "hidden", "translate",
]);

const TAG_ATTRS: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "name"],
  img: ["src", "alt", "hspace", "vspace"],
  table: ["cellpadding", "cellspacing", "summary", "frame", "rules"],
  td: ["colspan", "rowspan", "scope", "headers", "abbr", "axis", "char", "charoff"],
  th: ["colspan", "rowspan", "scope", "headers", "abbr", "axis", "char", "charoff"],
  col: ["span", "char", "charoff"],
  colgroup: ["span", "char", "charoff"],
  ol: ["start", "type", "reversed", "compact"],
  ul: ["type", "compact"],
  li: ["value", "type"],
  font: ["face", "size", "color"],
  basefont: ["face", "size", "color"],
  hr: ["size", "noshade", "color"],
  br: ["clear"],
  time: ["datetime"],
  del: ["datetime"],
  ins: ["datetime"],
  data: ["value"],
  details: ["open"],
  style: ["media", "type"],
  meta: ["charset"],
  html: ["xmlns"],
  input: ["type", "checked", "disabled", "readonly", "value", "size", "maxlength", "placeholder"],
  textarea: ["rows", "cols", "readonly", "disabled", "placeholder", "wrap"],
  progress: ["value", "max"],
  meter: ["value", "min", "max", "low", "high", "optimum"],
};

/** `<input>` yalnız kâğıt kutusu/satırı olarak: diğer türler (file, image, submit…) atılır. */
const INPUT_TYPES = new Set(["checkbox", "radio", "text"]);

const LOOP_MARKER = /\{\{\s*[#/]\s*[a-zA-Z0-9_]+\s*\}\}/g;
const HAS_LOOP_MARKER = /\{\{\s*[#/]\s*[a-zA-Z0-9_]+\s*\}\}/;
const ANY_PLACEHOLDER = /\{\{[^{}]*\}\}/g;

function isAllowedAttr(tag: string, name: string): boolean {
  return GLOBAL_ATTRS.has(name) || (TAG_ATTRS[tag]?.includes(name) ?? false) || /^(?:data|aria)-[a-z0-9_.-]+$/.test(name);
}

function linkVerdict(decoded: string): UrlVerdict {
  const u = stripUrlNoise(decoded);
  if (u.startsWith("#")) return "ok";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u)?.[1]?.toLowerCase();
  if (scheme === "mailto" || scheme === "tel") return "ok";
  // Bağlantıda data: hiç yok (görsel türü de) — gezinme hedefi olarak anlamı yok.
  if (scheme === "data") return "data";
  return classifyResourceUrl(decoded);
}

const VERDICT_REMOVED: Readonly<Record<Exclude<UrlVerdict, "ok">, string>> = {
  url: REMOVED.url,
  script: REMOVED.scriptUrl,
  data: REMOVED.dataUrl,
};

class TemplateSanitizer {
  readonly removed = new Set<string>();
  private out = "";
  private skip: { name: string; depth: number } | null = null;
  private pendingRaw: { name: string; tag: string } | null = null;
  private swallowEnd: string | null = null;

  run(tokens: readonly HtmlToken[]): string {
    for (const tok of tokens) this.visit(tok);
    if (this.pendingRaw) this.out += this.pendingRaw.tag + `</${this.pendingRaw.name}>`;
    return this.out;
  }

  private visit(tok: HtmlToken): void {
    if (this.skip) {
      if (tok.kind === "start" && tok.name === this.skip.name && !VOID_TAGS.has(tok.name)) this.skip.depth++;
      if (tok.kind === "end" && tok.name === this.skip.name && --this.skip.depth === 0) this.skip = null;
      return;
    }
    const swallow = this.swallowEnd;
    this.swallowEnd = null;
    if (tok.kind === "raw") return this.rawContent(tok.text);
    if (this.pendingRaw) {
      this.out += this.pendingRaw.tag + `</${this.pendingRaw.name}>`;
      this.pendingRaw = null;
    }
    if (tok.kind === "text") this.out += tok.text.replace(/</g, "&lt;");
    else if (tok.kind === "comment") this.out += this.comment(tok.text);
    else if (tok.kind === "doctype") this.out += `<!${tok.text}>`;
    else if (tok.kind === "start") this.startTag(tok.name, tok.attrs);
    else if (tok.name !== swallow) this.endTag(tok.name);
  }

  private comment(text: string): string {
    // Yorumdaki yer tutucu doldurulunca yorumu erken kapatabilirdi ("-->"); yorum zaten görünmez.
    if (HAS_LOOP_MARKER.test(text)) this.removed.add(REMOVED.loopMarker);
    let body = text.replace(ANY_PLACEHOLDER, "");
    while (body.includes("--")) body = body.replace(/--/g, "- -");
    // "<!-->" ve "<!--->" tarayıcıda BOŞ yorumdur: veri '>'/'->' ile başlarsa kalanı işaretleme olurdu.
    while (/^-?>/.test(body)) body = body.replace(/^-?>/, "");
    return `<!--${body}-->`;
  }

  private startTag(name: string, attrs: readonly HtmlAttr[]): void {
    const subtree = DROP_SUBTREE[name];
    if (subtree) {
      this.removed.add(subtree);
      if (!VOID_TAGS.has(name)) this.skip = { name, depth: 1 };
      return;
    }
    if (name === "meta" && !(attrs.length === 1 && attrs[0]?.name === "charset")) {
      this.removed.add(REMOVED.linkMeta);
      return;
    }
    const voidDrop = name === "meta" ? undefined : DROP_VOID[name];
    if (voidDrop) {
      this.removed.add(voidDrop);
      return;
    }
    if (!ALLOWED_TAGS.has(name)) {
      this.removed.add(UNWRAP_FORM.has(name) ? REMOVED.form : REMOVED.tag);
      return;
    }
    if (name === "input" && !INPUT_TYPES.has((attrs.find((a) => a.name === "type")?.value ?? "text").trim().toLowerCase())) {
      this.removed.add(REMOVED.form);
      return;
    }
    const tag = `<${name}${this.attrs(name, attrs)}>`;
    if (RAW_CONTENT_ELEMENTS.has(name)) this.pendingRaw = { name, tag };
    else this.out += tag;
  }

  private endTag(name: string): void {
    if (name === "br") this.out += "<br>"; // tarayıcı </br>'yi <br> okur
    else if (ALLOWED_TAGS.has(name) && !VOID_TAGS.has(name)) this.out += `</${name}>`;
  }

  /** Ham içerik (style/title): döngü işareti ayıklanır, CSS temizlenir, erken kapanış imkânsız kılınır. */
  private rawContent(text: string): void {
    const pending = this.pendingRaw;
    this.pendingRaw = null;
    if (!pending) return;
    let body = this.stripLoopMarkers(text);
    if (pending.name === "style") {
      const r = sanitizeCss(body);
      r.removed.forEach((x) => this.removed.add(x));
      body = r.css.replace(/<\/(style)/gi, "\\3c /$1");
    } else body = body.replace(/</g, "&lt;");
    this.out += `${pending.tag}${body}</${pending.name}>`;
    this.swallowEnd = pending.name;
  }

  private stripLoopMarkers(value: string): string {
    if (!HAS_LOOP_MARKER.test(value)) return value;
    this.removed.add(REMOVED.loopMarker);
    return value.replace(LOOP_MARKER, "");
  }

  private attrs(tag: string, attrs: readonly HtmlAttr[]): string {
    let out = "";
    for (const a of attrs) {
      if (a.name.startsWith("on")) this.removed.add(REMOVED.event);
      else if (!isAllowedAttr(tag, a.name)) this.removed.add(REMOVED.attr);
      else {
        const value = this.attrValue(tag, a);
        if (value !== null) out += a.hasValue ? ` ${a.name}="${value}"` : ` ${a.name}`;
      }
    }
    return out;
  }

  /** Öznitelik değeri: adres → çöz + şema kararı + yeniden kodla · style → CSS · diğerleri ham (tırnağa hapis). */
  private attrValue(tag: string, a: HtmlAttr): string | null {
    const raw = this.stripLoopMarkers(a.value);
    const isUrl = (tag === "a" && a.name === "href") || (tag === "img" && a.name === "src");
    if (!isUrl && a.name !== "style") return raw.replace(/"/g, "&quot;");
    const decoded = decodeAttrEntities(raw);
    if (decoded === null) {
      this.removed.add(isUrl ? REMOVED.url : REMOVED.attr);
      return null;
    }
    if (a.name === "style") {
      const r = sanitizeCss(decoded);
      r.removed.forEach((x) => this.removed.add(x));
      return r.css === decoded ? raw.replace(/"/g, "&quot;") : encodeAttrValue(r.css);
    }
    // Yer tutucuyla BAŞLAYAN adres doldurulunca şemayı veri belirlerdi.
    const verdict = stripUrlNoise(decoded).startsWith("{{") ? "url" : tag === "a" ? linkVerdict(decoded) : classifyResourceUrl(decoded);
    if (verdict !== "ok") {
      this.removed.add(VERDICT_REMOVED[verdict]);
      return null;
    }
    return encodeAttrValue(decoded);
  }
}

export interface TemplateSanitizeResult {
  readonly html: string;
  readonly removed: readonly string[];
}

/** Temizlenmiş HTML + kesilen kategoriler. İdempotent: ikinci geçiş aynı metni verir. */
export function sanitizeUserHtml(html: string): TemplateSanitizeResult {
  const s = new TemplateSanitizer();
  const out = s.run(tokenizeHtml(html));
  return { html: out, removed: [...s.removed] };
}

// ── Doldurma: sunucu SVG'si (QR/barkod) temizlikten SONRA, işaretle yerine konur ──
const RAW_OPEN = "";
const RAW_CLOSE = "";
const RAW_MARK = /([A-Za-z0-9_]+)/g;

/** Kullanıcı değerinden işaret karakterlerini ayıklar (sahte işaret üretilemesin). */
export function stripRawMarkers(value: string): string {
  return value.replace(/[]/g, "");
}

/**
 * Şablonu temizler → `fill` ile doldurur → DOLU metni yeniden temizler → ham sunucu
 * değerlerini (SVG) işaret yerlerine koyar. `fill` ham anahtar için `marker(key)` döndürmeli.
 */
export function renderUserTemplate(
  template: string,
  fill: (safeTemplate: string, marker: (key: string) => string) => string,
  rawValues: Readonly<Record<string, string>>,
): string {
  const safe = sanitizeUserHtml(template).html;
  const filled = fill(safe, (key) => RAW_OPEN + key + RAW_CLOSE);
  return sanitizeUserHtml(filled).html.replace(RAW_MARK, (_m, key: string) => rawValues[key] ?? "");
}
