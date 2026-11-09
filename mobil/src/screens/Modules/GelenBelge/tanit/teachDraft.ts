// Belge tipi TANITMA (S1b) — saf çekirdek: kelime kutusu seçimi → alan/sütun ataması → kimlik yazıları → bölüm → şablon önerisi gövdesi.
// Kutular iki çerçevededir: `photoRect` saklanan fotoğrafın üstüne çizim/dokunma, `rect` OCR (dik) çerçevesi — öneri ucuna giden budur.
// Belgeler basılıdır (fabrika cevabı 38): kelime kutusu güvenilir, el yazısı yolu yok. Panel ikizi `Electron/.../GelenBelgeler/tanit/teachDraft.ts` (istemciler kod paylaşmaz; gövde aynı tutulur).
import { lowerTr } from '../../../../utils/trCase';
import { clashingPairs } from './olcuCakisma';
import type { MultiPartyRule, Rect, ScanWord, ScanWords, SuggestBody, TemplateJson } from '../../../../types/inboundDocTeach';

/** Fotoğraf üstü kutu (panelde `ZoomableScan.ScanMark`). */
export interface ScanMark {
  key: string;
  box: Rect;
  tone: 'word' | 'selected' | 'field' | 'column' | 'section' | 'identifier';
  label?: string;
}

export const FIELD_OPTIONS = [
  { key: 'musteri', label: 'Müşteri' },
  { key: 'partiNo', label: 'Parti No' },
  { key: 'toplamMetre', label: 'Gelen metre' },
  // 2026-11-09: belgedeki gelen kg (hedef kg DEĞİL); backend ASSIGNABLE_FIELDS aynası.
  { key: 'toplamKg', label: 'Gelen kg' },
  { key: 'evrakNo', label: 'Evrak No' },
  { key: 'tarih', label: 'Tarih' },
  { key: 'siparisNo', label: 'Sipariş No' },
  { key: 'topAdet', label: 'Top adedi' },
  { key: 'desen', label: 'Hedef kumaş (desen)' },
  { key: 'renk', label: 'Hedef renk' },
  { key: 'en', label: 'En (cm)' },
  { key: 'hedefMetraj', label: 'Hedef metraj' },
  { key: 'hedefKg', label: 'Hedef kg' },
  { key: 'not', label: 'Not' },
  // Çok blok (2026-11-06; backend ASSIGNABLE_FIELDS aynası): bölümün işlemi (bilgi) ve müşterinin İE no'su (İE künyesi).
  { key: 'islem', label: 'İşlem (bilgi)' },
  { key: 'gonderenIsEmriNo', label: 'Müşteri İE No' },
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
export const SECTION_DEFAULT_FIELDS: readonly FieldKey[] = ['partiNo', 'siparisNo', 'topAdet', 'toplamMetre', 'islem', 'gonderenIsEmriNo'];

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
  /** 'Tanımı düzenle': yeni öneride yoksa eski şablondan taşınacak yapılar (sunucu birleştirir; önizleme = kaydedilen). */
  keepOld: OldPart[];
  /** 'Tanımı düzenle': eski şablonda kayıtlı alanlar. Yeniden atanmayan aynen korunur (sunucu birleştirir), gövdeye ATAMA olarak gitmez. */
  kept: FieldKey[];
  /** 'Tanımı düzenle': kayıtlı olup bu sefer KALDIRILAN alanlar (gövdede `base.drop`). */
  drop: FieldKey[];
  /** ③ Çok parti kuralı; null = fabrika ayarı (gövdeye `rules` girmez). */
  multiParty: MultiPartyRule | null;
  /** Düzenlenen şablonun kayıtlı kuralı: fabrika ayarına dönüş ancak bu varken `multiParty: null` olarak gider. */
  oldMultiParty: MultiPartyRule | null;
  /** Bölüm başlangıç yazısının belgedeki kelimeleri (yalnız işaret; gövdeye `sectionStart` metni gider). */
  sectionWords: number[];
}

/** Eski şablondan taşınabilen yapılar (backend `UPDATE_KEEP_PARTS` aynası). */
export const OLD_PARTS = [
  { key: 'tables', label: 'Top tablosu', hint: 'yeni sütun işaretlerseniz yenisi geçer' },
  { key: 'sections', label: 'Tekrar eden bölüm', hint: 'bölümü yeniden tanımlarsanız yenisi geçer' },
] as const;
export type OldPart = (typeof OLD_PARTS)[number]['key'];

export interface Pt {
  x: number;
  y: number;
}

export const emptyTeach = (name = ''): TeachState => ({
  name, selected: [], fields: {}, columns: {}, totalsLabel: null, identifiers: [], repeats: false, sectionStart: '', sectionFields: [], keepOld: [], kept: [],
  drop: [], multiParty: null, oldMultiParty: null, sectionWords: [],
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

export const byReading = (words: readonly ScanWord[]) => (a: number, b: number) =>
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

/** Satır yazıları (OCR satır no'suyla gruplu). */
export function lineTexts(words: readonly ScanWord[]): { lineNo: number; text: string; y: number; idx: number[] }[] {
  const map = new Map<number, number[]>();
  words.forEach((w, i) => map.set(w.lineNo, [...(map.get(w.lineNo) ?? []), i]));
  return [...map.entries()].map(([lineNo, idx]) => ({ lineNo, idx, text: textOf(words, idx), y: Math.min(...idx.map((i) => words[i]!.rect.y)) }));
}

/** Satır yazısının kimlik metni: rakamlı kelime (değer, belgeden belgeye değişir) atılır, yapışık 'No:123' → 'No'; öneri + ① dokunuş + ① boyama tek kaynak; backend `motor/labels.ts` aynası (bekçi `test_gelen_belge_motor` §12i). */
export const identifierText = (text: string): string =>
  text.split(/\s+/).map((x) => (/\d/.test(x) ? (/^[^\d:]+:/.exec(x)?.[0] ?? '') : x)).filter(Boolean).join(' ').replace(/^[\s:.,;|/#–-]+|[\s:.,;|/#–-]+$/gu, '');

/** Bölüm başlangıç yazısı: etiket kısmı (`identifierText`) ≥3 harfse o, değilse tam metin — backend `sectionStartLabel` aynası. */
export const sectionStartText = (text: string, part = identifierText(text)): string => ((part.match(/\p{L}/gu)?.length ?? 0) >= 3 ? part : text.trim());

/** Kimlik yazısı önerisi: sayfanın üst üçte birindeki yazı satırlarının etiket kısmı (`identifierText`, 3–40 karakter, ≥3 harf), en çok `max` tane. */
export function suggestIdentifiers(scan: ScanWords, max = 5): string[] {
  const out: string[] = [];
  for (const l of lineTexts(scan.words).sort((a, b) => a.y - b.y)) {
    const t = identifierText(l.text);
    if (l.y > scan.imageHeight / 3 || t.length < 3 || t.length > 40 || letters(t) < 3) continue;
    if (!out.some((o) => norm(o) === norm(t))) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Ekran açılınca: ad + hazır seçili kimlik önerileri. */
type OldTeach = { keepOld?: readonly OldPart[]; kept?: readonly FieldKey[]; multiParty?: MultiPartyRule | null };
export function initialTeach(scan: ScanWords, name = '', keep: readonly string[] = [], old: OldTeach = {}): TeachState {
  const rule = old.multiParty ?? null;
  let s: TeachState = { ...emptyTeach(name), keepOld: [...(old.keepOld ?? [])], kept: [...(old.kept ?? [])], multiParty: rule, oldMultiParty: rule };
  for (const t of [...keep, ...suggestIdentifiers(scan)]) s = addIdentifier(s, t);
  return s;
}

/** Kimlik yazısı tavanı — backend `MAX_TEMPLATE_IDENTIFIERS` (Teks-Erp/src/lib/gelen-belge/motor/suggest.ts) aynası. */
export const MAX_TEMPLATE_IDENTIFIERS = 30;

/** Önizle/kaydet hatasının ekran metni: 400 doğrulamada ilk alan mesajı (jenerik "Validasyon hatası" yerine). */
export function teachErrText(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  const first = (e as Error & { validationErrors?: { message?: string }[] }).validationErrors?.find((x) => typeof x?.message === 'string' && x.message);
  return first?.message || e.message;
}

/** Tanıtmanın üç aşaması (① kimlik · ② eşleme · ③ kurallar); her eksik düzeltileceği aşamaya bağlanır. */
export type Stage = 'TANIMA' | 'ESLEME' | 'KURALLAR';
export type TeachIssue = { stage: Stage; text: string };

/** Kaydetmeden/önizlemeden önce eksikler, aşamasıyla (Türkçe); boş = hazır. */
export function teachIssues(s: TeachState, words?: readonly ScanWord[]): TeachIssue[] {
  const p: TeachIssue[] = [];
  const add = (stage: Stage, text: string) => p.push({ stage, text });
  if (!s.identifiers.some((d) => d.on)) add('TANIMA', 'En az bir kimlik yazısı işaretleyin (başlık, firma adı).');
  const onCount = s.identifiers.filter((d) => d.on).length;
  if (onCount > MAX_TEMPLATE_IDENTIFIERS) add('TANIMA', `En çok ${MAX_TEMPLATE_IDENTIFIERS} kimlik yazısı seçilebilir (şu an ${onCount}); fazlasının işaretini kaldırın.`);
  if (s.name.trim().length < 2) add('TANIMA', 'Belge tipine bir ad verin (en az 2 karakter).');
  if (Object.keys(s.fields).length === 0 && !s.kept.some((k) => !s.drop.includes(k))) add('ESLEME', 'En az bir alan atayın (ör. Parti No).');
  if (words && meterOnCountRow(s, words)) add('ESLEME', '"Gelen metre" adet satırına atanmış (T.Adet\'in sağındaki sayı top adedidir) — tablonun Metre sütununu işaretleyin, "Gelen metre"yi kaldırın.');
  if (words) for (const c of meterKgClashes(s, words)) add('ESLEME', `Aynı kutu hem "${fieldOptionLabel(c.meter)}" hem "${fieldOptionLabel(c.kg)}" olamaz — kg için belgedeki kg değerine dokunun.`);
  if (s.repeats && !s.sectionStart.trim()) add('KURALLAR', 'Tekrar eden bölümün başlangıç yazısını seçin.');
  if (s.repeats && s.sectionFields.length === 0) add('KURALLAR', 'Tekrar eden bölümde en az bir alan bölüm başına okunmalı.');
  // Çok blok: her bölümün satırları ve metresi tablodan okunur ('Tanımı düzenle' eski tabloyu taşıyabilir).
  if (s.repeats && !s.columns.m?.length && !s.keepOld.includes('tables')) add('KURALLAR', 'Tekrar eden bölümde top tablosu gerekli: tablonun Metre sütun başlığını işaretleyin.');
  return p;
}

/** Kaydetmeden/önizlemeden önce eksikler (Türkçe); boş = hazır. */
export function teachProblems(s: TeachState, words?: readonly ScanWord[]): string[] {
  return teachIssues(s, words).map((i) => i.text);
}

const fieldOptionLabel = (k: FieldKey): string => FIELD_OPTIONS.find((f) => f.key === k)?.label ?? k;

/** Metre ailesi ile kg ailesi alanı aynı kutuya (≥ %50 kesişim) işaretlenmiş mi (`olcuCakisma.ts`). */
export function meterKgClashes(s: TeachState, words: readonly ScanWord[]): { meter: FieldKey; kg: FieldKey }[] {
  return clashingPairs((k) => (s.fields[k]?.length ? unionRect(words, s.fields[k]!) : null));
}

/** Backend `suggest.ts` `teachErrors` aynası: "Gelen metre" adet/toplam satırının sağındaki TAM SAYIYA atanmış mı (T.Adet 16 → 16 top). */
export function meterOnCountRow(s: TeachState, words: readonly ScanWord[]): boolean {
  const idx = s.fields.toplamMetre;
  if (!idx?.length || !/^\d+$/.test(textOf(words, idx).trim())) return false;
  const line = words[idx[0]!]!.lineNo;
  const x = Math.min(...idx.map((i) => words[i]!.rect.x));
  return words.some((w) => w.lineNo === line && w.rect.x < x && /adet/i.test(w.text));
}

/** `POST /gelen-belge/sablonlar/oneri` gövdesi — kutular OCR çerçevesinde. */
export function suggestBody(s: TeachState, words: readonly ScanWord[], scanId: string, baseCode: string | null = null): SuggestBody {
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
  if (s.repeats && s.sectionStart.trim()) body.sectionStartLabel = sectionStartText(s.sectionStart).slice(0, 40);
  if (baseCode) {
    // Yeniden işaretlenen alan drop'a girmez: sunucu drop'u birleşimden SONRA uygular, yeni atamayı da silerdi.
    const drop = s.drop.filter((k) => s.kept.includes(k) && !s.fields[k]?.length);
    body.base = { code: baseCode, keep: OLD_PARTS.map((p) => p.key).filter((k) => s.keepOld.includes(k)), ...(drop.length ? { drop } : {}) };
  }
  // Fabrika ayarı = alan yok (bugünkü davranış); kayıtlı kuralı fabrikaya döndürmek yalnız düzenlemede `null` ile.
  if (s.multiParty) body.rules = { multiParty: s.multiParty };
  else if (baseCode && s.oldMultiParty) body.rules = { multiParty: null };
  return body;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Eski şablonda bulunan, taşınabilir yapılar (güncelle kipinde varsayılan: hepsi korunur = önceki davranış). */
export function oldParts(t: TemplateJson | null | undefined): OldPart[] {
  if (!t) return [];
  return OLD_PARTS.map((p) => p.key).filter((k) => (k === 'tables' ? arr(t.tables).length > 0 : !!t.sections && typeof t.sections === 'object'));
}

export function toggleKeepOld(s: TeachState, part: OldPart): TeachState {
  return { ...s, keepOld: s.keepOld.includes(part) ? s.keepOld.filter((k) => k !== part) : [...s.keepOld, part] };
}

/** Eski şablonda olup bu ekranda yeniden atanmayan alanlar — güncellemede aynen korunur (ekranda listelenir). */
export function keptOldFields(t: TemplateJson | null | undefined, s: TeachState): string[] {
  const own = new Set([...FIELD_OPTIONS.filter((f) => s.fields[f.key]?.length).map((f) => f.key as string), ...s.drop]);
  return arr(t?.fields)
    .map((f) => f as { key?: unknown; label?: unknown })
    .filter((f) => typeof f.key === 'string' && !own.has(f.key))
    .map((f) => (typeof f.label === 'string' ? f.label : String(f.key)));
}

const FIELD_KEYS = new Set<string>(FIELD_OPTIONS.map((f) => f.key));

/** Eski şablonda kayıtlı, bu ekranda atanabilen alanlar (güncelle kipinde "kayıtlı" görünür; şablon sırası). */
export function templateFieldKeys(t: TemplateJson | null | undefined): FieldKey[] {
  const out: FieldKey[] = [];
  for (const f of arr(t?.fields)) {
    const k = (f as { key?: unknown }).key;
    if (typeof k === 'string' && FIELD_KEYS.has(k) && !out.includes(k as FieldKey)) out.push(k as FieldKey);
  }
  return out;
}

/** Alan eski şablondan aynen korunuyor mu (kayıtlı ve bu ekranda yeniden atanmadı)? */
export const isKept = (s: TeachState, k: FieldKey): boolean => s.kept.includes(k) && !s.fields[k]?.length && !s.drop.includes(k);

/** Şablonun çok parti kuralı (bilinmeyen değer yok sayılır → fabrika ayarı). */
export function templateMultiParty(t: TemplateJson | null | undefined): MultiPartyRule | null {
  const v = (t?.rules as { multiParty?: unknown } | undefined)?.multiParty;
  return v === 'SINGLE' || v === 'PER_PARTY' ? v : null;
}

/** Korunan alanların belge üstündeki kelimeleri: önizlemenin okuduğu değer kutusuna (OCR çerçevesi) merkezi düşen kelimeler. */
export function locateKept(s: TeachState, words: readonly ScanWord[], rects: Record<string, Rect> | undefined): Partial<Record<FieldKey, number[]>> {
  const out: Partial<Record<FieldKey, number[]>> = {};
  if (!rects) return out;
  for (const k of s.kept) {
    const r = rects[k];
    if (!r || !isKept(s, k)) continue;
    const idx = words.flatMap((w, i) => {
      const cx = w.rect.x + w.rect.width / 2;
      const cy = w.rect.y + w.rect.height / 2;
      return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height ? [i] : [];
    });
    if (idx.length) out[k] = idx;
  }
  return out;
}

/** Eski şablonun kimlik yazıları (güncelle kipinde hazır seçili gelir). */
export function templateKeywords(t: TemplateJson | null | undefined): string[] {
  return arr((t?.identifiers as TemplateJson | undefined)?.keywords).filter((k): k is string => typeof k === 'string');
}

/** Fotoğraf üstü kutular: kelimeler + seçim + atanmış alan/sütun/toplam etiketi. */
export function teachMarks(s: TeachState, words: readonly ScanWord[], located: Partial<Record<FieldKey, number[]>> = {}): ScanMark[] {
  const tone = new Map<number, { tone: ScanMark['tone']; label: string }>();
  for (const f of FIELD_OPTIONS) for (const i of located[f.key] ?? []) tone.set(i, { tone: 'field', label: `${f.label} (kayıtlı)` });
  for (const f of FIELD_OPTIONS) for (const i of s.fields[f.key] ?? []) tone.set(i, { tone: s.repeats && s.sectionFields.includes(f.key) ? 'section' : 'field', label: f.label });
  for (const c of COLUMN_OPTIONS) for (const i of s.columns[c.key] ?? []) tone.set(i, { tone: 'column', label: `Sütun: ${c.label}` });
  for (const i of s.totalsLabel ?? []) tone.set(i, { tone: 'column', label: 'Toplam satırı' });
  for (const i of s.selected) tone.set(i, { tone: 'selected', label: 'Seçili' });
  return words.map((w, i) => ({ key: String(i), box: w.photoRect, tone: tone.get(i)?.tone ?? 'word', label: tone.get(i)?.label ?? w.text }));
}

/** "Aynı tip (güncelle)": işaretlemeyi koru, seçilen şablonun kimlik yazılarını + taşınabilir yapılarını + adını al. */
// Kural: kullanıcı bu ekranda seçtiyse o kalır, seçmediyse şablonunki gelir. Bilinmeyen alan anahtarı (yeni sunucu) yok sayılır.
export function adoptTemplate(s: TeachState, t: { name: string; template: TemplateJson }): TeachState {
  const rule = templateMultiParty(t.template);
  let out: TeachState = { ...s, name: t.name, keepOld: oldParts(t.template), kept: templateFieldKeys(t.template), drop: [], multiParty: s.multiParty ?? rule, oldMultiParty: rule };
  for (const k of templateKeywords(t.template)) out = addIdentifier(out, k);
  return out;
}
