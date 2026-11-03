// Rehberli (adım adım) tanıtma — saf çekirdek. Adım 0 başlık (kimlik yazısı), sonra alanlar sırayla, son adım ad + kaydet.
// Sunucu etiketi DEĞER kutusundan bulur (suggest.ts findLabelFor) → kullanıcı yalnız değere dokunur.
import type { ScanWord, ScanWords, SuggestResult } from '../../../../types/inboundDocTeach';
export type { FieldKey } from './teachDraft';
import { addIdentifier, assignField, clearField, FIELD_OPTIONS, lineTexts, suggestIdentifiers, teachMarks, type FieldKey, type ScanMark, type TeachState } from './teachDraft';
import { lowerTr } from '../../../../utils/trCase';

/** İlk sürümün alan sırası (K30-T sözleşmesi madde 5; anahtarlar backend ASSIGNABLE_FIELDS). */
export const GUIDED_FIELDS: readonly FieldKey[] = ['musteri', 'partiNo', 'hedefMetraj', 'toplamMetre', 'en', 'desen', 'renk'];

/** Rehberde günlük dil etiketleri (Gelişmiş'teki FIELD_OPTIONS etiketinden kısa). */
const GUIDED_LABEL: Partial<Record<FieldKey, string>> = { partiNo: 'Parti no', desen: 'Desen', renk: 'Renk', en: 'En' };
export const fieldLabel = (k: FieldKey): string => GUIDED_LABEL[k] ?? FIELD_OPTIONS.find((f) => f.key === k)?.label ?? k;

/** Adımlar: 0 = başlık, 1..n = alanlar, n+1 = bitir. */
export const FINISH_STEP = GUIDED_FIELDS.length + 1;
export const stepField = (step: number): FieldKey | null => (step >= 1 && step <= GUIDED_FIELDS.length ? GUIDED_FIELDS[step - 1]! : null);

const norm = (t: string) => lowerTr(t).replace(/\s+/g, ' ').trim();
const clean = (t: string) => t.replace(/[:.\s]+$/u, '').trim();

/** Ad önerisi: belgenin başlığı (ilk kimlik önerisi). */
export function suggestName(scan: ScanWords): string {
  return suggestIdentifiers(scan, 1)[0] ?? '';
}

function lineOf(words: readonly ScanWord[], i: number) {
  return lineTexts(words).find((l) => l.idx.includes(i)) ?? null;
}

/** Başlık adımı: dokunulan kelimenin SATIRI kimlik yazısı olarak eklenir / çıkarılır. */
export function toggleHeaderWord(s: TeachState, words: readonly ScanWord[], i: number): TeachState {
  const line = lineOf(words, i);
  if (!line) return s;
  const text = clean(line.text);
  const hit = s.identifiers.find((d) => norm(d.text) === norm(text.slice(0, 60)));
  if (hit) return { ...s, identifiers: s.identifiers.map((d) => (d === hit ? { ...d, on: !d.on } : d)) };
  return addIdentifier(s, text);
}

/** Alan adımı: dokunulan kelime bu alanın değerine eklenir / çıkarılır (çok kelimeli değer olabilir). */
export function toggleFieldWord(s: TeachState, words: readonly ScanWord[], key: FieldKey, i: number): TeachState {
  const cur = s.fields[key] ?? [];
  if (cur.includes(i)) {
    const left = cur.filter((x) => x !== i);
    return left.length ? { ...s, fields: { ...s.fields, [key]: left } } : clearField(s, key);
  }
  return assignField({ ...s, selected: [...cur, i] }, words, key);
}

/** Fotoğraf kutuları: başlık adımında kimlik satırları, alan adımında o alanın değeri "seçili" görünür. */
export function guidedMarks(s: TeachState, words: readonly ScanWord[], step: number): ScanMark[] {
  const base = teachMarks({ ...s, selected: [] }, words);
  const key = stepField(step);
  if (key) {
    const mine = new Set(s.fields[key] ?? []);
    return base.map((m, i) => (mine.has(i) ? { ...m, tone: 'selected' as const, label: fieldLabel(key) } : m));
  }
  if (step !== 0) return base;
  const on = new Set(s.identifiers.filter((d) => d.on).map((d) => norm(d.text)));
  const idLines = new Set(lineTexts(words).filter((l) => on.has(norm(clean(l.text).slice(0, 60)))).flatMap((l) => l.idx));
  return base.map((m, i) => (idLines.has(i) && m.tone === 'word' ? { ...m, tone: 'identifier' as const, label: 'Başlık' } : m));
}

export type Readout =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; value: string; label: string | null }
  | { kind: 'empty' }
  | { kind: 'error'; text: string };

/** Seçili alanın önizleme sonucu: tazeyse okunan değer ya da "okunamadı"; değilse "okunuyor". */
export function fieldReadout(
  s: TeachState,
  key: FieldKey,
  p: { result: SuggestResult | null; fresh: boolean; error: string | null },
): Readout {
  if (!(s.fields[key]?.length)) return { kind: 'idle' };
  if (p.error && !p.fresh) return { kind: 'error', text: p.error };
  if (!p.fresh || !p.result) return { kind: 'loading' };
  if (p.result.errors.length) return { kind: 'error', text: p.result.errors[0]! };
  const v = p.result.preview?.fields[key];
  if (v == null || String(v).trim() === '') return { kind: 'empty' };
  const ex = p.result.explain.find((e) => e.field === key);
  return { kind: 'ok', value: String(v), label: ex?.strategy === 'anchor' ? ex.label : null };
}

export type ChipStatus = 'done' | 'skipped' | 'todo';
export function chipStatus(s: TeachState, key: FieldKey, skipped: readonly FieldKey[]): ChipStatus {
  if (s.fields[key]?.length) return 'done';
  return skipped.includes(key) ? 'skipped' : 'todo';
}
