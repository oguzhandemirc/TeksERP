// =============================================================================
// Şablon HTML belirteçleyicisi — WHATWG belirteçleyicisinin şablon temizliği için
// gereken alt kümesi (veri · etiket · öznitelik · yorum · doctype · ham içerik).
// Belirteçler kaynaktan KOPYALANMAZ, yeniden SERİLEŞTİRİLİR (template-html.sanitize.ts):
// çıktının tarayıcıda nasıl okunacağına bu belirteçleyicinin yorumu karar verir, iç içe
// yerleştirme / ayırıcı oyunları kesilen parçaların birleşmesiyle etiket doğuramaz.
// =============================================================================

export interface HtmlAttr {
  readonly name: string;
  /** Ham değer (varlık referansları ÇÖZÜLMEMİŞ). */
  readonly value: string;
  readonly hasValue: boolean;
}

export type HtmlToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "start"; readonly name: string; readonly attrs: readonly HtmlAttr[] }
  | { readonly kind: "end"; readonly name: string }
  | { readonly kind: "comment"; readonly text: string }
  | { readonly kind: "doctype"; readonly text: string }
  | { readonly kind: "raw"; readonly text: string };

/** İçeriği bitiş etiketine kadar HAM metin okunan elemanlar (etiket tanınmaz). */
export const RAW_CONTENT_ELEMENTS: ReadonlySet<string> = new Set([
  "script", "style", "xmp", "iframe", "noembed", "noframes", "textarea", "title", "plaintext",
]);

const WS = new Set(["\t", "\n", "\f", "\r", " "]);
const isAlpha = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);

interface Cursor {
  readonly s: string;
  i: number;
}

function skipWs(cur: Cursor): void {
  while (cur.i < cur.s.length && WS.has(cur.s[cur.i] ?? "")) cur.i++;
}

function readAttrValue(cur: Cursor): string | null {
  const q = cur.s[cur.i];
  if (q === '"' || q === "'") {
    const end = cur.s.indexOf(q, cur.i + 1);
    if (end < 0) return null;
    const value = cur.s.slice(cur.i + 1, end);
    cur.i = end + 1;
    return value;
  }
  const start = cur.i;
  while (cur.i < cur.s.length && !WS.has(cur.s[cur.i] ?? "") && cur.s[cur.i] !== ">") cur.i++;
  return cur.s.slice(start, cur.i);
}

/** Etiket adından sonrası: öznitelikler + kapanış. Dosya sonunda biterse null (etiket hiç yoktur). */
function readAttrs(cur: Cursor): HtmlAttr[] | null {
  const attrs: HtmlAttr[] = [];
  const seen = new Set<string>();
  for (;;) {
    skipWs(cur);
    const c = cur.s[cur.i];
    if (c === undefined) return null;
    if (c === ">") {
      cur.i++;
      return attrs;
    }
    if (c === "/") {
      cur.i++;
      continue;
    }
    const nameStart = cur.i;
    cur.i++; // ilk karakter '=' bile olsa addır (WHATWG)
    while (cur.i < cur.s.length && !WS.has(cur.s[cur.i] ?? "") && !"/>=".includes(cur.s[cur.i] ?? "")) cur.i++;
    const name = cur.s.slice(nameStart, cur.i).toLowerCase();
    skipWs(cur);
    let value = "";
    let hasValue = false;
    if (cur.s[cur.i] === "=") {
      cur.i++;
      skipWs(cur);
      const v = readAttrValue(cur);
      if (v === null) return null;
      value = v;
      hasValue = true;
    }
    // Yinelenen öznitelikte tarayıcı İLKİNİ tutar.
    if (!seen.has(name)) {
      seen.add(name);
      attrs.push({ name, value, hasValue });
    }
  }
}

function readTagName(cur: Cursor): string {
  const start = cur.i;
  while (cur.i < cur.s.length && !WS.has(cur.s[cur.i] ?? "") && cur.s[cur.i] !== "/" && cur.s[cur.i] !== ">") cur.i++;
  return cur.s.slice(start, cur.i).toLowerCase();
}

/** Ham içerik: `</ad` + (boşluk | / | >) görülene ya da metin bitene kadar. */
function readRawContent(cur: Cursor, name: string): string {
  if (name === "plaintext") {
    const rest = cur.s.slice(cur.i);
    cur.i = cur.s.length;
    return rest;
  }
  const re = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi");
  re.lastIndex = cur.i;
  const m = re.exec(cur.s);
  const end = m ? m.index : cur.s.length;
  const text = cur.s.slice(cur.i, end);
  cur.i = end;
  return text;
}

function readUntil(cur: Cursor, terminator: string): string {
  const end = cur.s.indexOf(terminator, cur.i);
  const stop = end < 0 ? cur.s.length : end;
  const text = cur.s.slice(cur.i, stop);
  cur.i = end < 0 ? cur.s.length : end + terminator.length;
  return text;
}

function readComment(cur: Cursor): HtmlToken {
  cur.i += 4; // "<!--"
  if (cur.s.startsWith(">", cur.i)) {
    cur.i += 1;
    return { kind: "comment", text: "" };
  }
  if (cur.s.startsWith("->", cur.i)) {
    cur.i += 2;
    return { kind: "comment", text: "" };
  }
  const a = cur.s.indexOf("-->", cur.i);
  const b = cur.s.indexOf("--!>", cur.i);
  const candidates = [a, b].filter((x) => x >= 0);
  const end = candidates.length ? Math.min(...candidates) : cur.s.length;
  const text = cur.s.slice(cur.i, end);
  cur.i = end === cur.s.length ? end : end + (end === a ? 3 : 4);
  return { kind: "comment", text };
}

/** `<!` ile başlayan: yorum, doctype ya da sahte yorum (CDATA dahil — HTML içeriğinde yorumdur). */
function readMarkupDeclaration(cur: Cursor): HtmlToken | null {
  if (cur.s.startsWith("<!--", cur.i)) return readComment(cur);
  if (/^<!doctype/i.test(cur.s.slice(cur.i, cur.i + 9))) {
    cur.i += 2;
    return { kind: "doctype", text: readUntil(cur, ">") };
  }
  cur.i += 2;
  readUntil(cur, ">");
  return null;
}

function readEndTag(cur: Cursor): HtmlToken | null {
  cur.i += 2; // "</"
  if (!isAlpha(cur.s[cur.i])) {
    if (cur.s[cur.i] === ">") cur.i++;
    else readUntil(cur, ">");
    return null;
  }
  const name = readTagName(cur);
  return readAttrs(cur) === null ? null : { kind: "end", name };
}

/** Belirteç dizisi; dosya sonunda yarım kalan etiket ATILIR (tarayıcı da onu hiç oluşturmaz). */
export function tokenizeHtml(html: string): HtmlToken[] {
  const cur: Cursor = { s: html, i: 0 };
  const out: HtmlToken[] = [];
  let text = "";
  const flush = (): void => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  while (cur.i < html.length) {
    const c = html[cur.i];
    const next = html[cur.i + 1];
    if (c !== "<") {
      const lt = html.indexOf("<", cur.i);
      const stop = lt < 0 ? html.length : lt;
      text += html.slice(cur.i, stop);
      cur.i = stop;
      continue;
    }
    if (next === "!") {
      flush();
      const tok = readMarkupDeclaration(cur);
      if (tok) out.push(tok);
    } else if (next === "/") {
      flush();
      const tok = readEndTag(cur);
      if (tok) out.push(tok);
    } else if (next === "?") {
      flush();
      readUntil(cur, ">");
    } else if (isAlpha(next)) {
      flush();
      cur.i++;
      const name = readTagName(cur);
      const attrs = readAttrs(cur);
      if (attrs === null) break;
      out.push({ kind: "start", name, attrs });
      if (RAW_CONTENT_ELEMENTS.has(name)) out.push({ kind: "raw", text: readRawContent(cur, name) });
    } else {
      text += "<";
      cur.i++;
    }
  }
  flush();
  return out;
}
