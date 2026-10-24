// =============================================================================
// Yönerge derleyicisi — görsel kipteki data-* öznitelikleri → Liquid
// =============================================================================
// Görsel editör HTML'i bozmadan döngü/koşul/alan bağlar: `data-each`, `data-if`,
// `data-if-not`, `data-alan` + `data-filtre`, `data-bag-src`. Derleyici kaynağı
// belirteçlere ayırır (konumlu; regex ile HTML ayrıştırmaz), yalnız yönergeli öğelere
// dokunur, geri kalan baytları AYNEN kopyalar ve çıktı→kaynak konum haritası tutar:
// Liquid hatası (ör. data-if'teki tanımsız yol) kaynaktaki özniteliğin satır/sütununa
// düşer. Bu belirteçleyici GÜVENLİK SINIRI DEĞİLDİR — render çıktısı yine izin listesi
// temizleyicisinden (template-html.sanitize.ts) geçer.
// Dilbilgisi: docs/design/BELGE-SABLON-TASARIMCISI-PLAN.md §5 sonu.

import { decodeAttrEntities } from "../../document-render/template-html.entities";
import { compileCondition, compileFilterChain, isPath, LOOP_VAR } from "./yonerge-dilbilgisi";
import { lineStarts, positionOf, tokenize, type Attr, type OpenToken, type SourcePosition } from "./yonerge-belirtec";

export { textPosition, type SourcePosition } from "./yonerge-belirtec";
export { compileCondition, compileFilterChain } from "./yonerge-dilbilgisi";

/** Kullanıcıya dönen konumlu hata — alan adları tel sözleşmesidir (plan §3.3: `{satir, sutun, mesaj}`). */
export interface TemplateIssue {
  readonly satir: number;
  readonly sutun: number;
  readonly mesaj: string;
}

/** "Satır L, sütun C: …" — kullanıcıya gösterilen biçim. */
export function formatIssue(h: TemplateIssue): string {
  return `Satır ${h.satir}, sütun ${h.sutun}: ${h.mesaj}`;
}

export const DIRECTIVE_MAX_DEPTH = 8;
const DIRECTIVE_NAMES = ["data-each", "data-if", "data-if-not", "data-alan", "data-filtre", "data-bag-src"] as const;
type DirectiveName = (typeof DIRECTIVE_NAMES)[number];

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
  "param", "keygen", "basefont", "bgsound", "frame", "image", "isindex",
]);
const FORBIDDEN_ROOTS = new Set(["html", "head", "body"]);

// ── Derleme ────────────────────────────────────────────────────────────────────
interface Segment {
  /** Çıktıdaki başlangıç. */
  readonly out: number;
  readonly length: number;
  /** Kaynaktaki karşılık: kopya parçada aynı ofset, üretilen parçada sabit çapa. */
  readonly source: number;
  readonly generated: boolean;
}

export interface CompileResult {
  readonly liquid: string;
  readonly errors: readonly TemplateIssue[];
  readonly warnings: readonly string[];
  /** Görsel kipte ham `{% %}` görüldü → şablon kod kipine alınmalı. */
  readonly suggestion: { readonly editMode: "CODE" } | null;
  /** Derlenmiş Liquid ofseti → kaynak satır/sütunu. */
  readonly sourcePosition: (outputOffset: number) => SourcePosition;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly anchor: number;
}

interface OpenElement {
  readonly open: OpenToken;
  readonly directive: boolean;
  readonly depth: number;
  /** Kapanış etiketinden SONRA eklenecek Liquid (endfor/endif). */
  readonly closing: string;
  /** data-alan: içerik bu ifadeyle değişir; `anchor` hatanın düşeceği kaynak ofseti. */
  readonly field: { readonly inner: string; readonly anchor: number } | null;
}

type Fail = (offset: number, mesaj: string) => void;
type ValueOf = (a: Attr) => string | null;

/** data-each + data-if/data-if-not → öğeyi saran Liquid; `levels` derinliğe eklenen kat. */
function loopAndCondition(dir: ReadonlyMap<DirectiveName, Attr>, valueOf: ValueOf, fail: Fail): { prefix: string; closing: string; levels: number } {
  let prefix = "";
  let closing = "";
  let levels = 0;
  const each = dir.get("data-each");
  if (each) {
    const d = valueOf(each);
    const m = d === null ? null : /^\s*(\S+)\s+in\s+(\S+)\s*$/.exec(d);
    if (d !== null && (!m || !LOOP_VAR.test(m[1]!) || !isPath(m[2]!))) {
      fail(each.valueStart, "data-each biçimi 'satir in tablolar.kalemler' olmalı");
    } else if (m) {
      prefix += `{% for ${m[1]} in ${m[2]} %}`;
      closing = "{% endfor %}" + closing;
      levels++;
    }
  }
  const ifAttr = dir.get("data-if");
  const ifNotAttr = dir.get("data-if-not");
  if (ifAttr && ifNotAttr) {
    fail(ifNotAttr.start, "data-if ile data-if-not aynı öğede birlikte kullanılamaz");
    return { prefix, closing, levels };
  }
  const k = ifAttr ?? ifNotAttr;
  if (!k) return { prefix, closing, levels };
  const d = valueOf(k);
  const r = d === null ? null : compileCondition(d);
  if (r && "error" in r) fail(k.valueStart, `${k.name}: ${r.error}`);
  else if (r) {
    const tag = ifAttr ? "if" : "unless";
    prefix += `{% ${tag} ${r.liquid} %}`;
    closing = `{% end${tag} %}` + closing;
    levels++;
  }
  return { prefix, closing, levels };
}

/** data-alan (+ data-filtre) → iç içerik ifadesi; data-bag-src → `src` özniteliği. */
function fieldAndSource(t: OpenToken, dir: ReadonlyMap<DirectiveName, Attr>, valueOf: ValueOf, fail: Fail): { inner: string | null; src: string } {
  const field = dir.get("data-alan");
  const filter = dir.get("data-filtre");
  let inner: string | null = null;
  if (filter && !field) fail(filter.start, "data-filtre yalnız data-alan ile birlikte kullanılır");
  if (field) {
    if (VOID.has(t.name)) fail(field.start, `data-alan <${t.name}> üzerinde kullanılamaz (içeriği olan öğe gerekir)`);
    const d = valueOf(field);
    if (d !== null && !isPath(d.trim())) fail(field.valueStart, `data-alan: geçersiz alan yolu '${d}'`);
    let f = "";
    if (filter) {
      const fd = valueOf(filter);
      const r = fd === null ? null : compileFilterChain(fd);
      if (r && "error" in r) fail(filter.valueStart, `data-filtre: ${r.error}`);
      else if (r) f = r.liquid;
    }
    if (d !== null) inner = `{{ ${d.trim()}${f} }}`;
  }
  const bind = dir.get("data-bag-src");
  let src = "";
  if (bind) {
    const d = valueOf(bind);
    if (t.name !== "img") fail(bind.start, "data-bag-src yalnız <img> üzerinde kullanılır");
    else if (d !== null && !isPath(d.trim())) fail(bind.valueStart, `data-bag-src: geçersiz alan yolu '${d}'`);
    else if (d !== null) src = ` src="{{ ${d.trim()} }}"`;
  }
  return { inner, src };
}

/** Başlangıç etiketi: yönerge (ve bağlanan src) öznitelikleri çıkarılır, kalan baytlar aynen. */
function rewriteOpenTag(source: string, t: OpenToken, dir: ReadonlyMap<DirectiveName, Attr>, src: string): string {
  const drop = new Set<Attr>(dir.values());
  if (dir.has("data-bag-src")) for (const a of t.attrs) if (a.name === "src") drop.add(a);
  let tagText = "";
  let p = t.start;
  for (const a of [...drop].sort((x, y) => x.start - y.start)) {
    tagText += source.slice(p, a.start);
    p = a.end;
  }
  let tail = source.slice(p, t.end);
  if (src) {
    const closeAt = tail.endsWith("/>") ? tail.length - 2 : tail.length - 1;
    tail = tail.slice(0, closeAt).replace(/\s+$/, "") + src + tail.slice(closeAt);
  }
  return tagText.replace(/[ \t]+$/, "") + tail.replace(/^[ \t]+(?=\/?>)/, "");
}

/** Düzenlemeleri uygular; çıktı→kaynak konum haritası döner. */
function applyEdits(source: string, starts: readonly number[], edits: Edit[]): { liquid: string; sourcePosition: (o: number) => SourcePosition } {
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Segment[] = [];
  let out = "";
  let p = 0;
  const copy = (start: number, end: number): void => {
    if (end <= start) return;
    segments.push({ out: out.length, length: end - start, source: start, generated: false });
    out += source.slice(start, end);
  };
  for (const e of edits) {
    if (e.start < p) continue; // çakışan düzenleme (hata zaten raporlandı)
    copy(p, e.start);
    if (e.text) {
      segments.push({ out: out.length, length: e.text.length, source: e.anchor, generated: true });
      out += e.text;
    }
    p = e.end;
  }
  copy(p, source.length);

  const sourcePosition = (o: number): SourcePosition => {
    let lo = 0;
    let hi = segments.length - 1;
    let found: Segment | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const sg = segments[mid]!;
      if (sg.out <= o) {
        found = sg;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (!found) return positionOf(starts, 0);
    const offset = found.generated ? found.source : found.source + Math.min(o - found.out, found.length);
    return positionOf(starts, Math.min(offset, source.length));
  };
  return { liquid: out, sourcePosition };
}

interface CompileState {
  readonly source: string;
  readonly edits: Edit[];
  readonly stack: OpenElement[];
  readonly fail: Fail;
  insideField: number;
}

function compileOpenToken(st: CompileState, t: OpenToken): void {
  const dir = new Map<DirectiveName, Attr>();
  for (const a of t.attrs) if ((DIRECTIVE_NAMES as readonly string[]).includes(a.name)) dir.set(a.name as DirectiveName, a);
  const parentDepth = st.stack.length ? st.stack[st.stack.length - 1]!.depth : 0;
  const isVoid = VOID.has(t.name);
  if (dir.size === 0) {
    if (!isVoid) st.stack.push({ open: t, directive: false, depth: parentDepth, closing: "", field: null });
    return;
  }
  if (FORBIDDEN_ROOTS.has(t.name)) {
    st.fail(t.start, `<${t.name}> üzerinde yönerge kullanılamaz`);
    return;
  }
  if (st.insideField > 0) st.fail(t.start, "data-alan içeriği değiştirilen öğenin içinde başka yönerge olamaz");

  const valueOf: ValueOf = (a) => {
    const d = decodeAttrEntities(a.value);
    if (d === null) st.fail(a.valueStart, `${a.name}: değer çözülemedi`);
    return d;
  };
  const { prefix, closing, levels } = loopAndCondition(dir, valueOf, st.fail);
  const { inner, src } = fieldAndSource(t, dir, valueOf, st.fail);
  const depth = parentDepth + levels;
  if (depth > DIRECTIVE_MAX_DEPTH) st.fail(t.start, `yönerge iç içe derinliği ${DIRECTIVE_MAX_DEPTH}'i aşıyor`);

  const anchor = ([...dir.values()][0] ?? t.attrs[0])?.start ?? t.start;
  st.edits.push({ start: t.start, end: t.end, text: prefix + rewriteOpenTag(st.source, t, dir, src), anchor });
  if (isVoid) {
    if (closing) st.edits.push({ start: t.end, end: t.end, text: closing, anchor: t.start });
    return;
  }
  // data-alan içeriği kapanış görülünce [açılış sonu, kapanış başı) aralığında değişir.
  const field = dir.get("data-alan");
  const fieldRecord = inner !== null && field ? { inner, anchor: field.valueStart } : null;
  if (fieldRecord) st.insideField++;
  st.stack.push({ open: t, directive: true, depth, closing, field: fieldRecord });
}

function closeElement(st: CompileState, o: OpenElement, closeStart: number, closeEnd: number): void {
  if (o.field) {
    st.insideField--;
    st.edits.push({ start: o.open.end, end: closeStart, text: o.field.inner, anchor: o.field.anchor });
  }
  if (o.closing) st.edits.push({ start: closeEnd, end: closeEnd, text: o.closing, anchor: closeStart });
}

const unclosedMessage = (o: OpenElement): string => `<${o.open.name}> öğesinin kapanışı yok (yönergeli öğe açıkça kapatılmalı)`;

export function compileDirectives(source: string, mode: "VISUAL" | "CODE" = "VISUAL"): CompileResult {
  const starts = lineStarts(source);
  const errors: TemplateIssue[] = [];
  const warnings: string[] = [];
  const st: CompileState = {
    source,
    edits: [],
    stack: [],
    fail: (offset, mesaj) => errors.push({ ...positionOf(starts, offset), mesaj }),
    insideField: 0,
  };

  for (const t of tokenize(source)) {
    if (t.kind === "open") {
      compileOpenToken(st, t);
      continue;
    }
    let k = st.stack.length - 1;
    while (k >= 0 && st.stack[k]!.open.name !== t.name) k--;
    if (k < 0) continue; // başıboş kapanış: tarayıcı da yok sayar
    for (let x = st.stack.length - 1; x > k; x--) {
      const o = st.stack[x]!;
      if (o.directive) st.fail(o.open.start, unclosedMessage(o));
      if (o.field) st.insideField--;
    }
    const o = st.stack[k]!;
    st.stack.length = k;
    closeElement(st, o, t.start, t.end);
  }
  for (const o of st.stack) if (o.directive) st.fail(o.open.start, unclosedMessage(o));

  // Ham Liquid etiketi görsel kipte → kod kipi önerisi.
  let suggestion: CompileResult["suggestion"] = null;
  const rawTag = source.indexOf("{%");
  if (mode === "VISUAL" && rawTag >= 0) {
    const p = positionOf(starts, rawTag);
    warnings.push(`Satır ${p.satir}, sütun ${p.sutun}: ham Liquid etiketi var — şablon kod kipine alınmalı; görsel düzenleme kısıtlı`);
    suggestion = { editMode: "CODE" };
  }

  const { liquid, sourcePosition } = applyEdits(source, starts, st.edits);
  errors.sort((a, b) => a.satir - b.satir || a.sutun - b.sutun);
  return { liquid, errors, warnings, suggestion, sourcePosition };
}
