// S1 (Gülkesim, 2026-11-03): TEKRARLAYAN BÖLÜM — bir kağıtta birden çok parti (fabrika cevabı 17/36). Bölüm başlangıç
// etiketi ("Sipariş No") her geçtiği yerde yeni bölüm açar; bölümün alanları kendi bandından okunur, tablo satırları
// konumla bölüme düşer. Başlıksız başlayan sayfa (devam sayfası) satırları "devam" bölümüdür: taslak onları SON bölüme ekler.
import type { DocumentTemplate, FieldResult, FieldSpec, OcrBlock, OcrLine, OcrRect, OcrResult, SectionSpec, TableResult } from "./types";
import { collectLines } from "./geometry";
import { labelSimilarity, sectionStartLabel } from "./labels";
import { normalizeForMatch } from "./text-normalize";
import { canonicalEquals, sumCanonical } from "./totals";
import { extractFields } from "./extract";

/** Sayfa damgası ("1/2"): satırın TAMAMI n/m; varsayılan desen. */
export const DEFAULT_PAGE_PATTERN = "^\\s*(\\d{1,2})\\s*/\\s*(\\d{1,2})\\s*$";

export interface SectionResult {
  /** Taslak blok no'su (1-tabanlı); devam bölümü varsa o 1'dir. */
  sectionNo: number;
  /** Sayfa bölüm başlığı olmadan başladı: bu satırlar önceki sayfanın son bölümüne aittir. */
  continued: boolean;
  startRect: OcrRect | null;
  fields: Record<string, FieldResult>;
  batchNo: string | null;
  orderNo: string | null;
  /** Bölümde yazan top adedi (sayım alanı). */
  declaredCount: string | null;
  /** Tablo satırları: `blockNo:index` anahtarları (taslak satırı bölüme bu anahtarla bağlanır). */
  rowKeys: string[];
  rowCount: number;
  meterSum: string;
  kgSum: string;
  declared: { count: string | null; kg: string | null; m: string | null } | null;
  warnings: string[];
}

export interface SectionsResult {
  sections: SectionResult[];
  /** Okunan sayfa damgası; yoksa null. */
  page: { no: number; of: number } | null;
  warnings: string[];
}

export const rowKey = (blockNo: number, index: number): string => `${blockNo}:${index}`;

/** Satır merkezi [top, bottom) bandına düşen OCR satırlarıyla sınırlı sonuç (koordinatlar kaymaz). */
export function sliceBand(ocr: OcrResult, top: number, bottom: number): OcrResult {
  const blocks: OcrBlock[] = [];
  for (const b of ocr.blocks) {
    const lines = b.lines.filter((l) => {
      const cy = l.rect.y + l.rect.height / 2;
      return cy >= top && cy < bottom;
    });
    if (lines.length > 0) blocks.push({ ...b, text: lines.map((l) => l.text).join("\n"), lines });
  }
  return { ...ocr, text: blocks.map((b) => b.text).join("\n"), blocks };
}

/**
 * Satır bölüm başlangıcı mı: metin etiketle BAŞLAR ya da (kısa satırda) etikete bulanık benzer. Etiket hem kayıtlı hâliyle
 * hem etiket kısmıyla (`sectionStartLabel`; değeriyle kaydedilmiş eski şablon "Ham PartiNo: P2618733") denenir.
 */
function isStartLine(line: OcrLine, labels: string[]): boolean {
  const norm = normalizeForMatch(line.text);
  if (!norm) return false;
  const all = [...new Set(labels.flatMap((l) => [l, sectionStartLabel(l)]))];
  for (const l of all) {
    const ln = normalizeForMatch(l);
    if (ln && (norm === ln || norm.startsWith(ln + " "))) return true;
  }
  return labelSimilarity(line.text, all) >= 0.85;
}

export function findPageMarker(ocr: OcrResult, pattern = DEFAULT_PAGE_PATTERN): { no: number; of: number } | null {
  let re: RegExp;
  try { re = new RegExp(pattern); } catch { return null; }
  for (const l of collectLines(ocr)) {
    const m = re.exec(l.text);
    if (!m) continue;
    const no = Number(m[1]);
    const of = Number(m[2]);
    if (no >= 1 && of >= 2 && no <= of && of <= 20) return { no, of };
  }
  return null;
}

function sectionLabel(s: SectionResult): string {
  return s.batchNo ?? s.orderNo ?? `bölüm ${s.sectionNo}`;
}

/** Bölüm denetimleri: yazan top ≠ satır (son bölüm eksik sayfada "sürüyor"), ara toplam ≠ Σ satır. */
function sectionWarnings(s: SectionResult, isLast: boolean, page: SectionsResult["page"]): string[] {
  const out: string[] = [];
  const name = sectionLabel(s);
  const n = s.declaredCount !== null ? Number(s.declaredCount) : null;
  const pageOpen = page !== null && page.no < page.of;
  if (n !== null && Number.isFinite(n) && n !== s.rowCount) {
    if (isLast && pageOpen && n > s.rowCount) {
      out.push(`SECTION_CONTINUES: Parti ${name}: belgede ${n} TOP yazıyor, bu sayfada ${s.rowCount} satır (sayfa ${page!.no}/${page!.of}) — kalan satırlar sonraki sayfada; sayfaları aynı belgeye birlikte okutun`);
    } else {
      out.push(`SECTION_COUNT_MISMATCH: Parti ${name}: belgede ${n} TOP yazıyor, ${s.rowCount} satır okundu`);
    }
  } else if (isLast && pageOpen) {
    out.push(`SECTION_CONTINUES: Parti ${name}: sayfa ${page!.no}/${page!.of} — bölüm sonraki sayfada sürebilir; sayfaları birlikte okutun`);
  }
  if (s.declared?.m && s.rowCount > 0 && !canonicalEquals(s.declared.m, s.meterSum)) {
    out.push(`SECTION_SUBTOTAL_MISMATCH: Parti ${name}: ara toplam ${s.declared.m} m, satırların toplamı ${s.meterSum} m`);
  }
  return out;
}

const METER_COLS = ["m", "metre", "mt"];
const SEQ_COLS = ["siraNo", "sira"];

type PlacedRow = { b: TableResult["blocks"][number]; r: TableResult["blocks"][number]["rows"][number]; cy: number };

/**
 * Satırın bölümü (2026-11-06, V6): konum bandı + basılı SIRA NO. Her bölümün sınırı, konumla düşen satırlarının en küçük sıra
 * no'sudur; sütuna taşmış (`spill`) satır bölümünü sıra no'dan alır (konumu anlamsız). Konum ile sıra çelişirse ya da taşma
 * satırının sırası okunamazsa konum/blok kalır + `SECTION_ROW_ORDER_AMBIGUOUS` (OCR tek rakam düşürebilir, R1).
 */
function placeRows(rows: PlacedRow[], idxOf: (cy: number) => number): { rows: Array<PlacedRow & { at: number }>; warnings: string[] } {
  const seqOf = (x: PlacedRow): number | null => {
    const v = SEQ_COLS.map((c) => x.r.cells[c]?.value).find((y) => y);
    const n = v ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const pos = (x: PlacedRow) => Math.max(0, idxOf(x.cy));
  // Taşma satırının konum yedeği: kendi bloğunun konumla düşen son satırının bölümü (yoksa blok başlığının).
  const blockAt = new Map<unknown, number>();
  for (const x of rows) if (!x.r.spill) blockAt.set(x.b, pos(x));
  const startOf = new Map<number, number>();
  for (const x of rows) {
    const n = seqOf(x);
    if (x.r.spill || n === null) continue;
    const k = pos(x);
    startOf.set(k, Math.min(startOf.get(k) ?? Infinity, n));
  }
  const bounds = [...startOf.entries()].sort((a, c) => a[0] - c[0]);
  const monotone = bounds.every((e, i) => i === 0 || e[1] > bounds[i - 1]![1]);
  const bySeq = (n: number): number | null => {
    if (!monotone || bounds.length === 0) return null;
    let at: number | null = null;
    for (const [k, start] of bounds) if (n >= start) at = k;
    return at;
  };
  const warnings: string[] = [];
  const out = rows.map((x) => {
    const n = seqOf(x);
    const seqAt = n !== null ? bySeq(n) : null;
    const fallback = x.r.spill ? (blockAt.get(x.b) ?? Math.max(0, idxOf(x.b.headerRect.y))) : pos(x);
    const at = x.r.spill ? (seqAt ?? fallback) : fallback;
    if ((x.r.spill && seqAt === null) || (!x.r.spill && seqAt !== null && seqAt !== at)) {
      warnings.push(`SECTION_ROW_ORDER_AMBIGUOUS: sıra ${n ?? "?"} satırının partisi sıra no ile konumdan kesin çıkmadı — satırın partisini kontrol edin`);
    }
    return { ...x, at };
  });
  return { rows: out, warnings };
}

/** Alanın konumsuz kopyası (anchor `window` ve sayfa konumlu roi yedeği düşer; öteki stratejiler aynen). */
function unpinned(f: FieldSpec): FieldSpec {
  const strategies = f.strategies.filter((st) => !(st.kind === "roi" && st.fallback)).map((st) => {
    if (st.kind !== "anchor" || !st.window) return st;
    const copy = { ...st };
    delete copy.window;
    return copy;
  });
  return { ...f, strategies };
}

/**
 * Bölümlere ayırır. Tablo blokları ve satırları KONUMLA (satır merkezi ≥ bölüm bandının üstü) en son açılan bölüme düşer;
 * bloğun beyanı (T.Adet) satırlarının çoğunun düştüğü bölüme gider. Başlangıç etiketi yoksa tek bölüm (bugünkü davranış).
 */
export function extractSections(ocr: OcrResult, template: DocumentTemplate, spec: SectionSpec, tables: TableResult[]): SectionsResult {
  const page = findPageMarker(ocr, spec.pagePattern);
  const starts = collectLines(ocr).filter((l) => isStartLine(l, spec.startLabels)).sort((a, b) => a.rect.y - b.rect.y);
  // Bant üstü bir satır yukarıdan: değer başlığın biraz üstüne basılmış olabilir ("96967  4 TOP" / "Sipariş No").
  const tops = starts.map((l) => l.rect.y - l.rect.height);
  const table = (spec.table ? tables.find((t) => t.key === spec.table) : tables[0]) ?? null;
  const rows = (table?.blocks ?? []).flatMap((b) => b.rows.map((r) => ({ b, r, cy: r.rect.y + r.rect.height / 2 })));
  // Başlangıç etiketinden önce satır varsa (ya da hiç etiket yoksa) ilk bölüm "devam"dır.
  const offset = tops.length === 0 || rows.some((x) => x.cy < tops[0]!) ? 1 : 0;
  const idxOf = (cy: number): number => {
    let i = -1;
    for (let k = 0; k < tops.length; k++) if (cy >= tops[k]!) i = k;
    return i + offset;
  };
  const count = tops.length + offset;
  // Bölüm alanı her bantta ayrı okunur: etiket penceresi (tanıtmada başlık alanına konur) onu ilk bölüme çivilemesin.
  const sub: DocumentTemplate = { ...template, fields: template.fields.filter((f) => spec.fields.includes(f.key)).map(unpinned) };
  const sections: SectionResult[] = Array.from({ length: count }, (_, i) => {
    const k = i - offset;
    const fields = k >= 0 ? extractFields(sliceBand(ocr, tops[k]!, tops[k + 1] ?? Infinity), sub).fields : {};
    const v = (key: string | undefined) => (key ? fields[key]?.value ?? null : null);
    return {
      // Başlangıç etiketi hiç yoksa sayfanın tamamı önceki sayfanın devamıdır (tek sayfalık belgede etkisiz: önceki blok yok).
      sectionNo: i + 1, continued: k < 0, startRect: k >= 0 ? starts[k]!.rect : null, fields,
      batchNo: v(spec.batchField), orderNo: v(spec.orderField), declaredCount: v(spec.countField),
      rowKeys: [], rowCount: 0, meterSum: "0", kgSum: "0", declared: null, warnings: [],
    };
  });
  const placed = placeRows(rows, idxOf);
  const meters = new Map<number, Array<string | null>>();
  const kgs = new Map<number, Array<string | null>>();
  for (const { b, r, at } of placed.rows) {
    const s = sections[at]!;
    s.rowKeys.push(rowKey(b.blockNo, r.index));
    s.rowCount++;
    (meters.get(s.sectionNo) ?? meters.set(s.sectionNo, []).get(s.sectionNo)!).push(METER_COLS.map((c) => r.cells[c]?.value).find((x) => x) ?? null);
    (kgs.get(s.sectionNo) ?? kgs.set(s.sectionNo, []).get(s.sectionNo)!).push(r.cells.kg?.value ?? null);
  }
  for (const b of table?.blocks ?? []) {
    if (!b.declared || b.rows.length === 0) continue;
    const votes = new Map<number, number>();
    for (const x of placed.rows) if (x.b === b) votes.set(x.at, (votes.get(x.at) ?? 0) + 1);
    const best = [...votes.entries()].sort((a, c) => c[1] - a[1])[0]![0];
    const s = sections[best]!;
    if (!s.declared) s.declared = { count: b.declared.count, kg: b.declared.kg, m: b.declared.m };
  }
  for (const s of sections) {
    s.meterSum = sumCanonical(meters.get(s.sectionNo) ?? []);
    s.kgSum = sumCanonical(kgs.get(s.sectionNo) ?? []);
  }
  sections.forEach((s, i) => s.warnings.push(...sectionWarnings(s, i === sections.length - 1, page)));
  const warnings = [...placed.warnings, ...sections.flatMap((s) => s.warnings)];
  if (page && page.no < page.of && !warnings.some((w) => w.startsWith("SECTION_CONTINUES"))) {
    warnings.push(`PAGE_INCOMPLETE: sayfa ${page.no}/${page.of} — belgenin ${page.of} sayfası var; diğer sayfaları aynı belgeye okutun`);
  }
  return { sections, page, warnings };
}
