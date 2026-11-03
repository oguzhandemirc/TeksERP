// Belge tipi TANITMA (S1b) — saf çekirdek: kelime kutusu seçimi → alan/sütun ataması → kimlik yazıları → bölüm → şablon önerisi gövdesi.
// Kutular iki çerçevededir: `photoRect` saklanan fotoğrafın üstüne çizim/dokunma, `rect` OCR (dik) çerçevesi — öneri ucuna giden budur.
// Belgeler basılıdır (fabrika cevabı 38): kelime kutusu güvenilir, el yazısı yolu yok. Panel ikizi `Electron/.../GelenBelgeler/tanit/teachDraft.ts` (istemciler kod paylaşmaz; gövde aynı tutulur).
import { lowerTr } from '../../../../utils/trCase';
import type { Rect, ScanWord, ScanWords, SuggestBody, TemplateJson } from '../../../../types/inboundDocTeach';

/** Fotoğraf üstü kutu (panelde `ZoomableScan.ScanMark`). */
export interface ScanMark {
  key: string;
  box: Rect;
  tone: 'word' | 'selected' | 'field' | 'column' | 'section';
  label?: string;
}

export const FIELD_OPTIONS = [
  { key: 'musteri', label: 'Müşteri' },
  { key: 'partiNo', label: 'Parti No' },
  { key: 'toplamMetre', label: 'Metre' },
  { key: 'evrakNo', label: 'Evrak No' },
  { key: 'tarih', label: 'Tarih' },
  { key: 'siparisNo', label: 'Sipariş No' },
  { key: 'topAdet', label: 'Top adedi' },
  { key: 'desen', label: 'Desen' },
  { key: 'renk', label: 'Renk' },
  { key: 'en', label: 'En' },
] as const;
export type FieldKey = (typeof FIELD_OPTIONS)[number]['key'];

export const COLUMN_OPTIONS = [
  { key: 'topNo', label: 'Top No' },
  { key: 'kg', label: 'Kilo' },
  { key: 'm', label: 'Metre' },
  { key: 'en', label: 'En' },
] as const;
export type ColumnKey = (typeof COLUMN_OPTIONS)[number]['key'];

/** Tekrarlayan bölümde varsayılan olarak bölüm başına okunan alanlar (parti künyesi). */
export const SECTION_DEFAULT_FIELDS: readonly FieldKey[] = ['partiNo', 'siparisNo', 'topAdet', 'toplamMetre'];

export interface Identifier {
  text: string;
  on: boolean;
}

export interface TeachState {
  name: string;
  /** Şu an seçili kelimeler (indeks, okuma sırasıyla). */
  selected: number[];
  fields: Partial<Record<FieldKey, number[]>>;
  columns: Partial<Record<ColumnKey, number[]>>;
  totalsLabel: number[] | null;
  identifiers: Identifier[];
  repeats: boolean;
  sectionStart: string;
  sectionFields: FieldKey[];
}

export interface Pt {
  x: number;
  y: number;
}

export const emptyTeach = (name = ''): TeachState => ({
  name, selected: [], fields: {}, columns: {}, totalsLabel: null, identifiers: [], repeats: false, sectionStart: '', sectionFields: [],
});

const PAD = 3;
const area = (w: ScanWord) => w.photoRect.width * w.photoRect.height;

/** Fotoğraf noktasındaki kelime (birkaç kutu çakışırsa en küçüğü); yoksa null. */
export function wordAt(words: readonly ScanWord[], p: Pt): number | null {
  let best: number | null = null;
  words.forEach((w, i) => {
    const r = w.photoRect;
    const hit = p.x >= r.x - PAD && p.x <= r.x + r.width + PAD && p.y >= r.y - PAD && p.y <= r.y + r.height + PAD;
    if (hit && (best === null || area(w) < area(words[best]!))) best = i;
  });
  return best;
}

const byReading = (words: readonly ScanWord[]) => (a: number, b: number) =>
  words[a]!.lineNo - words[b]!.lineNo || words[a]!.rect.x - words[b]!.rect.x;

/** Kelimelerin okuma sırasıyla birleşik yazısı. */
export function textOf(words: readonly ScanWord[], idx: readonly number[]): string {
  return [...idx].sort(byReading(words)).map((i) => words[i]!.text).join(' ').trim();
}

/** Seçili kelimelerin birleşik kutusu (`frame`: 'rect' OCR çerçevesi — öneri ucuna giden; 'photoRect' çizim). */
export function unionRect(words: readonly ScanWord[], idx: readonly number[], frame: 'rect' | 'photoRect' = 'rect') {
  const rs = idx.map((i) => words[i]![frame]);
  if (rs.length === 0) return null;
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.width));
  const y1 = Math.max(...rs.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function toggleWord(s: TeachState, i: number): TeachState {
  return { ...s, selected: s.selected.includes(i) ? s.selected.filter((x) => x !== i) : [...s.selected, i] };
}

const without = <K extends string>(m: Partial<Record<K, number[]>>, idx: readonly number[]) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v as number[]).filter((i) => !idx.includes(i))]).filter(([, v]) => (v as number[]).length > 0)) as Partial<Record<K, number[]>>;

const norm = (t: string) => lowerTr(t).replace(/\s+/g, ' ').trim();

/** Seçimi alana ata: aynı kelimeler başka alandan düşer; değer belgeden belgeye değişir → kapsayan kimlik yazısı kapanır. */
export function assignField(s: TeachState, words: readonly ScanWord[], key: FieldKey): TeachState {
  if (s.selected.length === 0) return s;
  const idx = [...s.selected].sort(byReading(words));
  const value = norm(textOf(words, idx));
  const sectionFields = s.repeats && SECTION_DEFAULT_FIELDS.includes(key) && !s.sectionFields.includes(key) ? [...s.sectionFields, key] : s.sectionFields;
  return {
    ...s,
    selected: [],
    fields: { ...without(s.fields, idx), [key]: idx },
    columns: without(s.columns, idx),
    identifiers: s.identifiers.map((d) => (value && norm(d.text).includes(value) ? { ...d, on: false } : d)),
    sectionFields,
  };
}

/** Seçimi top tablosu sütun BAŞLIĞI yap; başlık yazısı kimlik adayıdır (hazır seçili). */
export function assignColumn(s: TeachState, words: readonly ScanWord[], key: ColumnKey): TeachState {
  if (s.selected.length === 0) return s;
  const idx = [...s.selected].sort(byReading(words));
  return addIdentifier({ ...s, selected: [], columns: { ...without(s.columns, idx), [key]: idx }, fields: without(s.fields, idx) }, textOf(words, idx));
}

export function assignTotals(s: TeachState, words: readonly ScanWord[]): TeachState {
  if (s.selected.length === 0) return s;
  return { ...s, selected: [], totalsLabel: [...s.selected].sort(byReading(words)) };
}

export function clearField(s: TeachState, key: FieldKey): TeachState {
  const fields = { ...s.fields };
  delete fields[key];
  return { ...s, fields, sectionFields: s.sectionFields.filter((k) => k !== key) };
}

export function clearColumn(s: TeachState, key: ColumnKey): TeachState {
  const columns = { ...s.columns };
  delete columns[key];
  return { ...s, columns };
}

export function addIdentifier(s: TeachState, text: string): TeachState {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (t.length < 2) return s;
  const i = s.identifiers.findIndex((d) => norm(d.text) === norm(t));
  if (i >= 0) return { ...s, identifiers: s.identifiers.map((d, j) => (j === i ? { ...d, on: true } : d)) };
  return { ...s, identifiers: [...s.identifiers, { text: t, on: true }] };
}

export function toggleIdentifier(s: TeachState, text: string): TeachState {
  return { ...s, identifiers: s.identifiers.map((d) => (d.text === text ? { ...d, on: !d.on } : d)) };
}

/** 'Bu bölüm tekrar eder' aç/kapa; açılınca atanmış parti künyesi alanları bölüm başına işaretlenir. */
export function setRepeats(s: TeachState, on: boolean): TeachState {
  if (!on) return { ...s, repeats: false };
  const auto = SECTION_DEFAULT_FIELDS.filter((k) => s.fields[k]?.length && !s.sectionFields.includes(k));
  return { ...s, repeats: true, sectionFields: [...s.sectionFields, ...auto] };
}

export function toggleSectionField(s: TeachState, key: FieldKey): TeachState {
  return { ...s, sectionFields: s.sectionFields.includes(key) ? s.sectionFields.filter((k) => k !== key) : [...s.sectionFields, key] };
}

// Hermes'te Unicode özellik kaçışına (\p{L}) güvenilmez: Latin + Türkçe harf sınıfı (belgeler Türkçe basılı).
const letters = (t: string) => (t.match(/[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]/g) ?? []).length;
const digits = (t: string) => (t.match(/\d/g) ?? []).length;

/** Satır yazıları (OCR satır no'suyla gruplu). */
export function lineTexts(words: readonly ScanWord[]): { lineNo: number; text: string; y: number; idx: number[] }[] {
  const map = new Map<number, number[]>();
  words.forEach((w, i) => map.set(w.lineNo, [...(map.get(w.lineNo) ?? []), i]));
  return [...map.entries()].map(([lineNo, idx]) => ({ lineNo, idx, text: textOf(words, idx), y: Math.min(...idx.map((i) => words[i]!.rect.y)) }));
}

/** Kimlik yazısı önerisi: sayfanın üst üçte birindeki yazı satırları (rakamdan çok harf, 3–40 karakter), en çok `max` tane. */
export function suggestIdentifiers(scan: ScanWords, max = 5): string[] {
  const out: string[] = [];
  for (const l of lineTexts(scan.words).sort((a, b) => a.y - b.y)) {
    const t = l.text.replace(/[:.\s]+$/u, '').trim();
    if (l.y > scan.imageHeight / 3 || t.length < 3 || t.length > 40 || letters(t) < 3 || digits(t) > letters(t)) continue;
    if (!out.some((o) => norm(o) === norm(t))) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Ekran açılınca: ad + hazır seçili kimlik önerileri. */
export function initialTeach(scan: ScanWords, name = '', keep: readonly string[] = []): TeachState {
  let s = emptyTeach(name);
  for (const t of [...keep, ...suggestIdentifiers(scan)]) s = addIdentifier(s, t);
  return s;
}

/** Kaydetmeden/önizlemeden önce eksikler (Türkçe); boş = hazır. */
export function teachProblems(s: TeachState): string[] {
  const p: string[] = [];
  if (s.name.trim().length < 2) p.push('Belge tipine bir ad verin (en az 2 karakter).');
  if (Object.keys(s.fields).length === 0) p.push('En az bir alan atayın (ör. Parti No).');
  if (!s.identifiers.some((d) => d.on)) p.push('En az bir kimlik yazısı işaretleyin (başlık, firma adı).');
  if (s.repeats && !s.sectionStart.trim()) p.push('Tekrar eden bölümün başlangıç yazısını seçin.');
  if (s.repeats && s.sectionFields.length === 0) p.push('Tekrar eden bölümde en az bir alan bölüm başına okunmalı.');
  return p;
}

/** `POST /gelen-belge/sablonlar/oneri` gövdesi — kutular OCR çerçevesinde. */
export function suggestBody(s: TeachState, words: readonly ScanWord[], scanId: string): SuggestBody {
  const assignments = FIELD_OPTIONS.filter((f) => s.fields[f.key]?.length).map((f) => ({
    field: f.key,
    rect: unionRect(words, s.fields[f.key]!)!,
    ...(s.repeats && s.sectionFields.includes(f.key) ? { section: true } : {}),
  }));
  const columns = COLUMN_OPTIONS.filter((c) => s.columns[c.key]?.length).map((c) => ({ key: c.key, header: textOf(words, s.columns[c.key]!).slice(0, 40) }));
  const body: SuggestBody = {
    scanId,
    name: s.name.trim(),
    assignments,
    identifiers: s.identifiers.filter((d) => d.on).map((d) => d.text),
  };
  if (columns.length) body.table = { columns, totalsLabel: s.totalsLabel?.length ? textOf(words, s.totalsLabel).slice(0, 40) : null };
  if (s.repeats && s.sectionStart.trim()) body.sectionStartLabel = s.sectionStart.trim().slice(0, 40);
  return body;
}

type Keyed = { key?: unknown; field?: unknown };
const keyOf = (x: unknown) => ((x as Keyed)?.key ?? (x as Keyed)?.field) as string | undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * 'Şablonu güncelle': yeniden atanan alan ezilir, atanmamış eski alanlar korunur; tablo/bölüm/metre kaynağı yeni öneride varsa
 * onunki, yoksa eskisi. Kimlik yazıları ekrandaki listedir (eskiler hazır seçili gelir, kullanıcı çıkarabilir). Kod/ad/sürümü sunucu mühürler.
 */
export function mergeForUpdate(old: TemplateJson, next: TemplateJson): TemplateJson {
  const nf = arr(next.fields);
  const fields = [...nf, ...arr(old.fields).filter((f) => !nf.some((n) => keyOf(n) === keyOf(f)))];
  const out: TemplateJson = { ...old, ...next, fields, identifiers: { ...(old.identifiers as object), ...(next.identifiers as object) } };
  for (const k of ['tables', 'sections', 'meterSources'] as const) out[k] = next[k] ?? old[k];
  const bc = [...arr(next.batchNoCandidates), ...arr(old.batchNoCandidates)];
  const cands = bc.filter((c, i) => bc.findIndex((x) => keyOf(x) === keyOf(c)) === i);
  if (cands.length) out.batchNoCandidates = cands;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  delete out.id;
  delete out.version;
  return out;
}

/** Eski şablonun kimlik yazıları (güncelle kipinde hazır seçili gelir). */
export function templateKeywords(t: TemplateJson | null | undefined): string[] {
  return arr((t?.identifiers as TemplateJson | undefined)?.keywords).filter((k): k is string => typeof k === 'string');
}

/** Fotoğraf üstü kutular: kelimeler + seçim + atanmış alan/sütun/toplam etiketi. */
export function teachMarks(s: TeachState, words: readonly ScanWord[]): ScanMark[] {
  const tone = new Map<number, { tone: ScanMark['tone']; label: string }>();
  for (const f of FIELD_OPTIONS) for (const i of s.fields[f.key] ?? []) tone.set(i, { tone: s.repeats && s.sectionFields.includes(f.key) ? 'section' : 'field', label: f.label });
  for (const c of COLUMN_OPTIONS) for (const i of s.columns[c.key] ?? []) tone.set(i, { tone: 'column', label: `Sütun: ${c.label}` });
  for (const i of s.totalsLabel ?? []) tone.set(i, { tone: 'column', label: 'Toplam satırı' });
  for (const i of s.selected) tone.set(i, { tone: 'selected', label: 'Seçili' });
  return words.map((w, i) => ({ key: String(i), box: w.photoRect, tone: tone.get(i)?.tone ?? 'word', label: tone.get(i)?.label ?? w.text }));
}
