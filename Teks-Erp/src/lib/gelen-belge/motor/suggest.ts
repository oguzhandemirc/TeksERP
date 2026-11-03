// S1 (Gülkesim, 2026-11-03): BELGE TİPİ TANITMA — şablon önerisi (saf). Kullanıcı fotoğrafta değer kutusuna dokunup alan atar;
// sistem değerin yanındaki BASILI ETİKETİ bulur ve anchor stratejisi üretir (aynı satırda solda → "right", üstte → "below");
// etiket yoksa göreli konum (roi). Kimlik yazıları sınıflandırma anahtarıdır. Belgeler basılıdır (fabrika cevabı 38).
import { TABLE_TOTAL_SOURCE, type DocumentTemplate, type FieldSpec, type FieldType, type MeterSourcesSpec, type OcrElement, type OcrLine, type OcrRect, type OcrResult, type Strategy, type TableColumnSpec } from "./types";
import { collectLines } from "./geometry";
import { isNumericText } from "./labels";
import { validateTemplate } from "./templates";

/** Tanıtmada atanabilen başlık alanları → motor alan anahtarı + tip (taslak eşlemesi bu anahtarları okur). Anahtar KALICIDIR
 *  (kayıtlı şablonlar bunu taşır) — yalnız etiket değişir. K30: iş emri formu alanları (`hedefMetraj`, `hedefKg`, `not`). */
export const ASSIGNABLE_FIELDS = {
  musteri: { label: "Müşteri", type: "text" },
  partiNo: { label: "Parti No", type: "alnum" },
  toplamMetre: { label: "Kurşun metresi", type: "decimal" },
  evrakNo: { label: "Evrak No", type: "alnum" },
  tarih: { label: "Tarih", type: "date" },
  siparisNo: { label: "Sipariş No", type: "alnum" },
  topAdet: { label: "Top adedi", type: "integer" },
  desen: { label: "Hedef kumaş (desen)", type: "text" },
  renk: { label: "Hedef renk", type: "text" },
  en: { label: "En (cm)", type: "decimal" },
  hedefMetraj: { label: "Hedef metraj", type: "decimal" },
  hedefKg: { label: "Hedef kg", type: "decimal" },
  not: { label: "Not", type: "text" },
} as const satisfies Record<string, { label: string; type: FieldType }>;
export type AssignableField = keyof typeof ASSIGNABLE_FIELDS;
/** Zod enum'u için anahtar listesi (uç ↔ motor tek kaynak). */
export const ASSIGNABLE_FIELD_KEYS = Object.keys(ASSIGNABLE_FIELDS) as [AssignableField, ...AssignableField[]];

/** Top tablosu kolonları (başlık yazısına dokunulur). */
export const TABLE_COLUMN_KEYS = { topNo: { label: "Top No", type: "alnum" }, kg: { label: "Kilo", type: "decimal" }, m: { label: "Metre", type: "decimal" }, en: { label: "En", type: "decimal" } } as const;
export type TableColumnKey = keyof typeof TABLE_COLUMN_KEYS;

/** Tanıtılan şablonun kimlik eşiği (şablona yazılır; motor `templateMinScore` ile okur — tek kaynak o). */
export const USER_TEMPLATE_MIN_SCORE = 0.6;

export interface TemplateSuggestInput {
  code: string;
  name: string;
  ocr: OcrResult;
  /** Kutu → alan: `rect` kullanıcının dokunduğu DEĞER kutusu (OCR çerçevesi); `section` = alan bölüm başına okunur. */
  assignments: Array<{ field: AssignableField; rect: OcrRect; section?: boolean }>;
  /** Kimlik yazıları (başlık, firma adı, sütun başlıkları) — sınıflandırma anahtar kelimeleri. */
  identifiers: string[];
  table?: { columns: Array<{ key: TableColumnKey; header: string }>; totalsLabel?: string | null };
  /** Tekrarlayan bölümün başlangıç etiketi (ör. "Sipariş No"); yoksa bölümsüz. */
  sectionStartLabel?: string | null;
}

export interface TemplateSuggestion {
  template: DocumentTemplate;
  /** Alan başına üretilen strateji özeti (ekranda "Parti No ← 'Ham PartiNo' sağında"). */
  explain: Array<{ field: string; strategy: "anchor" | "roi"; label: string | null; direction: string | null }>;
  errors: string[];
}

const center = (r: OcrRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const vOverlap = (a: OcrRect, b: OcrRect) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
const hOverlap = (a: OcrRect, b: OcrRect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
const inside = (p: { x: number; y: number }, r: OcrRect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const cleanLabel = (t: string) => t.replace(/[:.\s]+$/u, "").replace(/\s+/g, " ").trim();
const isLabelText = (t: string) => t.length >= 2 && t.length <= 40 && !isNumericText(t) && /\p{L}/u.test(t);

/** Değer kutusunun etiketi: aynı satırda önündeki kelimeler → soldaki satır (aynı hiza) → üstteki satır (yatay çakışan). */
export function findLabelFor(ocr: OcrResult, rect: OcrRect): { label: string; direction: "right" | "below" } | null {
  const lines = collectLines(ocr);
  const c = center(rect);
  const own = lines.find((l) => inside(c, l.rect));
  if (own) {
    const els: OcrElement[] = own.elements ?? [];
    // Değer kelimeleri = kutuyla yatayda yarıdan çok çakışanlar; etiket onların ÖNÜNDEKİ kelimeler (satırın tamamı değerse yok).
    const vals = els.filter((e) => hOverlap(e.rect, rect) > e.rect.width / 2);
    const firstX = vals.length ? Math.min(...vals.map((e) => e.rect.x)) : c.x;
    const before = els.filter((e) => e.rect.x + e.rect.width <= firstX).map((e) => e.text).join(" ");
    const t = cleanLabel(before);
    if (isLabelText(t)) return { label: t, direction: "right" };
  }
  const others = lines.filter((l) => l !== own && !inside(c, l.rect));
  const left = others
    .filter((l) => l.rect.x + l.rect.width <= rect.x + rect.width * 0.25 && vOverlap(l.rect, rect) > Math.min(l.rect.height, rect.height) * 0.4 && isLabelText(cleanLabel(l.text)))
    .sort((a, b) => b.rect.x + b.rect.width - (a.rect.x + a.rect.width))[0];
  if (left) return { label: cleanLabel(left.text), direction: "right" };
  const above = others
    .filter((l: OcrLine) => l.rect.y + l.rect.height <= rect.y + rect.height * 0.25 && hOverlap(l.rect, rect) > 0 && rect.y - (l.rect.y + l.rect.height) < rect.height * 3 && isLabelText(cleanLabel(l.text)))
    .sort((a, b) => b.rect.y - a.rect.y)[0];
  if (above) return { label: cleanLabel(above.text), direction: "below" };
  return null;
}

/** Etiketsiz değer: kutunun çevresi (yarım kutu pay) normalize göreli konum. */
function roiOf(ocr: OcrResult, r: OcrRect): Strategy {
  const px = r.width * 0.5;
  const py = r.height * 0.5;
  const x = Math.max(0, (r.x - px) / ocr.imageWidth);
  const y = Math.max(0, (r.y - py) / ocr.imageHeight);
  return { kind: "roi", roi: { x, y, w: Math.min(1 - x, (r.width + 2 * px) / ocr.imageWidth), h: Math.min(1 - y, (r.height + 2 * py) / ocr.imageHeight) } };
}

/** Öneri: alanlar + (varsa) top tablosu + bölüm + kimlik; doğrulayıcıdan geçmeyen öneri `errors`la döner (kaydedilmez). */
export function suggestTemplate(input: TemplateSuggestInput): TemplateSuggestion {
  const explain: TemplateSuggestion["explain"] = [];
  const fields: FieldSpec[] = [];
  for (const a of input.assignments) {
    if (fields.some((f) => f.key === a.field)) continue;
    const meta = ASSIGNABLE_FIELDS[a.field];
    const found = findLabelFor(input.ocr, a.rect);
    const strategy: Strategy = found ? { kind: "anchor", labels: [found.label], direction: found.direction } : roiOf(input.ocr, a.rect);
    fields.push({ key: a.field, label: meta.label, type: meta.type, strategies: [strategy], ...(meta.type === "text" ? { maxLength: 80, postProcess: ["collapseSpaces", "trimPunct"] } : {}), ...(meta.type === "alnum" ? { postProcess: ["upper", "stripSpaces"] } : {}) });
    explain.push({ field: a.field, strategy: found ? "anchor" : "roi", label: found?.label ?? null, direction: found?.direction ?? null });
  }
  const t: DocumentTemplate = {
    id: input.code, name: input.name, version: 1,
    identifiers: { keywords: [...new Set(input.identifiers.map((s) => s.trim()).filter(Boolean))], minScore: USER_TEMPLATE_MIN_SCORE },
    fields,
  };
  const cols = input.table?.columns ?? [];
  if (cols.length > 0) {
    const columns: TableColumnSpec[] = cols.map((c) => ({ key: c.key, label: TABLE_COLUMN_KEYS[c.key].label, type: TABLE_COLUMN_KEYS[c.key].type, headers: [c.header.trim()], ...(c.key === "m" ? { required: true } : {}) }));
    t.tables = [{ key: "toplar", columns, minHeaderMatches: Math.min(2, columns.length), ...(input.table?.totalsLabel ? { totals: { labels: [input.table.totalsLabel.trim()] } } : {}) }];
  }
  const sectionFields = input.assignments.filter((a) => a.section).map((a) => a.field);
  if (input.sectionStartLabel?.trim() && sectionFields.length > 0) {
    t.sections = {
      startLabels: [input.sectionStartLabel.trim()], fields: [...new Set(sectionFields)],
      ...(sectionFields.includes("partiNo") ? { batchField: "partiNo" } : {}),
      ...(sectionFields.includes("siparisNo") ? { orderField: "siparisNo" } : {}),
      ...(sectionFields.includes("topAdet") ? { countField: "topAdet" } : {}),
      ...(t.tables ? { table: "toplar" } : {}),
    };
  }
  const has = (k: string) => fields.some((f) => f.key === k);
  const batch = (["partiNo", "evrakNo", "siparisNo"] as const).filter(has).map((k) => ({ field: k, kind: k === "partiNo" ? "BATCH" as const : k === "evrakNo" ? "DOC" as const : "ORDER" as const }));
  if (batch.length) t.batchNoCandidates = batch;
  if (t.tables?.[0]?.totals) t.meterSources = { output: ["$tableTotal"], ...(has("toplamMetre") ? { total: ["toplamMetre"] } : {}) };
  else if (has("toplamMetre")) t.meterSources = { total: ["toplamMetre"] };
  const v = validateTemplate(t);
  return { template: t, explain, errors: v.errors };
}

/** "Şablonu güncelle"de eski şablondan taşınabilecek yapılar (yeni öneride yoksa); ekranda kutu olarak sorulur. */
export const UPDATE_KEEP_PARTS = ["tables", "sections"] as const;
export type UpdateKeepPart = (typeof UPDATE_KEEP_PARTS)[number];

/**
 * Güncelleme birleşimi (TEK kaynak; önizleme de kayıt da bunu kullanır): yeniden atanan alan ezilir, atanmamış eski alan korunur;
 * tablo/bölüm yeni öneride varsa onunki, yoksa yalnız `keep`te ise eskisi (yoksa kalkar). Metre kaynakları kalan alan/tabloya süzülür.
 */
export function mergeTemplateForUpdate(old: DocumentTemplate, next: DocumentTemplate, keep: readonly UpdateKeepPart[]): DocumentTemplate {
  const fields = [...next.fields, ...(old.fields ?? []).filter((f) => !next.fields.some((n) => n.key === f.key))];
  const out: DocumentTemplate = { ...old, ...next, fields, identifiers: { ...old.identifiers, ...next.identifiers } };
  delete out.tables;
  delete out.sections;
  delete out.meterSources;
  const tables = next.tables ?? (keep.includes("tables") ? old.tables : undefined);
  if (tables) out.tables = tables;
  const sections = next.sections ?? (keep.includes("sections") ? old.sections : undefined);
  if (sections) {
    out.sections = { ...sections };
    if (!tables) delete out.sections.table;
  }
  const hasField = (k: string) => fields.some((f) => f.key === k);
  const hasTotals = !!tables?.some((t) => t.totals);
  const ms: Record<string, string[]> = {};
  for (const [k, v] of Object.entries({ ...(old.meterSources ?? {}), ...(next.meterSources ?? {}) })) {
    const kept = (v ?? []).filter((s) => (s === TABLE_TOTAL_SOURCE ? hasTotals : hasField(s)));
    if (kept.length) ms[k] = kept;
  }
  if (Object.keys(ms).length) out.meterSources = ms as MeterSourcesSpec;
  const bc = [...(next.batchNoCandidates ?? []), ...(old.batchNoCandidates ?? [])].filter((c) => hasField(c.field));
  const cands = bc.filter((c, i) => bc.findIndex((x) => x.field === c.field) === i);
  if (cands.length) out.batchNoCandidates = cands;
  else delete out.batchNoCandidates;
  return out;
}
