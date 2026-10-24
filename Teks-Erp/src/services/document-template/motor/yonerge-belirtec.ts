// =============================================================================
// Yönerge derleyicisinin KONUMLU belirteçleyicisi + satır/sütun çözümü
// =============================================================================
// template-html.tokenizer.ts ile aynı WHATWG alt kümesi, ama her öznitelik/etiketin
// kaynaktaki ofsetini taşır (derleyici yalnız yönergeli öğelere dokunur, gerisini
// bayt-aynı kopyalar). GÜVENLİK SINIRI DEĞİLDİR — render çıktısı izin listesi
// temizleyicisinden geçer.

export interface SourcePosition {
  readonly satir: number;
  readonly sutun: number;
}

export interface Attr {
  readonly name: string;
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly valueStart: number;
}
export interface OpenToken {
  readonly kind: "open";
  readonly name: string;
  readonly attrs: readonly Attr[];
  readonly start: number;
  readonly end: number;
}
export interface CloseToken {
  readonly kind: "close";
  readonly name: string;
  readonly start: number;
  readonly end: number;
}
export type Token = OpenToken | CloseToken;

const RAW = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "textarea", "title", "plaintext"]);
export const WS: ReadonlySet<string> = new Set(["\t", "\n", "\f", "\r", " "]);

interface Cursor {
  readonly s: string;
  i: number;
}

const isAlpha = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);

function skipPast(cur: Cursor, terminator: string): void {
  const k = cur.s.indexOf(terminator, cur.i);
  cur.i = k < 0 ? cur.s.length : k + terminator.length;
}

function readTagName(cur: Cursor): string {
  const { s } = cur;
  const start = cur.i;
  while (cur.i < s.length && !WS.has(s[cur.i]!) && s[cur.i] !== "/" && s[cur.i] !== ">") cur.i++;
  return s.slice(start, cur.i).toLowerCase();
}

/** Tek öznitelik (ad + isteğe bağlı değer); kapanmamış tırnakta `null`. */
function readAttr(cur: Cursor): Attr | null {
  const { s } = cur;
  const start = cur.i++;
  while (cur.i < s.length && !WS.has(s[cur.i]!) && !"/>=".includes(s[cur.i]!)) cur.i++;
  const name = s.slice(start, cur.i).toLowerCase();
  let j = cur.i;
  while (j < s.length && WS.has(s[j]!)) j++;
  if (s[j] !== "=") return { name, value: "", start, end: cur.i, valueStart: cur.i };
  j++;
  while (j < s.length && WS.has(s[j]!)) j++;
  const q = s[j];
  if (q === '"' || q === "'") {
    const k = s.indexOf(q, j + 1);
    if (k < 0) return null;
    cur.i = k + 1;
    return { name, value: s.slice(j + 1, k), start, end: cur.i, valueStart: j + 1 };
  }
  const valueStart = j;
  while (j < s.length && !WS.has(s[j]!) && s[j] !== ">") j++;
  cur.i = j;
  return { name, value: s.slice(valueStart, j), start, end: j, valueStart };
}

/** Öznitelik listesi `>`e kadar; dosya sonunda yarım kalan etiket `null` (tarayıcı da oluşturmaz). */
function readAttrs(cur: Cursor): Attr[] | null {
  const attrs: Attr[] = [];
  const seen = new Set<string>();
  for (;;) {
    while (cur.i < cur.s.length && WS.has(cur.s[cur.i]!)) cur.i++;
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
    const a = readAttr(cur);
    if (a === null) return null;
    // Tarayıcı gibi: yinelenen öznitelikte İLKİ geçerlidir.
    if (!seen.has(a.name)) {
      seen.add(a.name);
      attrs.push(a);
    }
  }
}

/** Ham içerik: `</ad` + ayırıcı görülene kadar; bitiş etiketi normal yoldan okunur. */
function skipRawContent(cur: Cursor, name: string): void {
  const re = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi");
  re.lastIndex = cur.i;
  const m = re.exec(cur.s);
  cur.i = m ? m.index : cur.s.length;
}

export function tokenize(s: string): Token[] {
  const out: Token[] = [];
  const cur: Cursor = { s, i: 0 };
  while (cur.i < s.length) {
    const lt = s.indexOf("<", cur.i);
    if (lt < 0) break;
    cur.i = lt;
    const n = s[lt + 1];
    if (s.startsWith("<!--", lt)) {
      cur.i += 4;
      if (s.startsWith(">", cur.i)) cur.i += 1;
      else if (s.startsWith("->", cur.i)) cur.i += 2;
      else skipPast(cur, "-->");
    } else if (n === "!" || n === "?") {
      cur.i += 2;
      skipPast(cur, ">");
    } else if (n === "/") {
      cur.i += 2;
      if (!isAlpha(s[cur.i])) {
        skipPast(cur, ">");
        continue;
      }
      const name = readTagName(cur);
      if (readAttrs(cur) === null) break;
      out.push({ kind: "close", name, start: lt, end: cur.i });
    } else if (isAlpha(n)) {
      cur.i++;
      const name = readTagName(cur);
      const attrs = readAttrs(cur);
      if (attrs === null) break;
      out.push({ kind: "open", name, attrs, start: lt, end: cur.i });
      if (RAW.has(name)) skipRawContent(cur, name);
    } else cur.i++;
  }
  return out;
}

// ── Konum ──────────────────────────────────────────────────────────────────────
export function lineStarts(s: string): number[] {
  const b = [0];
  for (let i = 0; i < s.length; i++) if (s[i] === "\n") b.push(i + 1);
  return b;
}

export function positionOf(starts: readonly number[], offset: number): SourcePosition {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { satir: lo + 1, sutun: offset - starts[lo]! + 1 };
}

/** Metindeki ofsetin satır/sütunu (yönergesiz — kod kipi ya da hazır derlenmiş Liquid). */
export function textPosition(text: string, offset: number): SourcePosition {
  return positionOf(lineStarts(text), Math.max(0, Math.min(offset, text.length)));
}
