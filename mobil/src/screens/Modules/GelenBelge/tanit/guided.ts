// Rehberli (üç aşamalı) tanıtma — dokunuş çekirdeği: ① kimlik satırı aç/kapa, ② alan değerine kelime ekle/çıkar, okunan değer durumu.
// Sunucu etiketi DEĞER kutusundan bulur (suggest.ts findLabelFor) → kullanıcı yalnız değere dokunur. Aşama kuralları `stages.ts`.
import type { ScanWord, ScanWords, SuggestResult } from '../../../../types/inboundDocTeach';
import { addIdentifier, assignField, clearField, isKept, lineTexts, suggestIdentifiers, type FieldKey, type TeachState } from './teachDraft';
import { lowerTr } from '../../../../utils/trCase';

export type { FieldKey } from './teachDraft';
export { fieldLabel } from './fieldTargets';

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

/** Satırı kimlik yazısı olarak açık mı (① işaretlerinde satır kelimeleri boyanır). */
export function identifierWordSet(s: TeachState, words: readonly ScanWord[]): Set<number> {
  const on = new Set(s.identifiers.filter((d) => d.on).map((d) => norm(d.text)));
  return new Set(lineTexts(words).filter((l) => on.has(norm(clean(l.text).slice(0, 60)))).flatMap((l) => l.idx));
}

export type Readout =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; value: string; label: string | null; kept?: boolean }
  | { kind: 'empty' }
  | { kind: 'error'; text: string };

/** Seçili alanın önizleme sonucu: tazeyse okunan değer ya da "okunamadı"; değilse "okunuyor". */
export function fieldReadout(
  s: TeachState,
  key: FieldKey,
  p: { result: SuggestResult | null; fresh: boolean; error: string | null; blocked?: string | null },
): Readout {
  // Kayıtlı (eski şablondan korunan) alan: okuma kuralı değişmez → son önizleme bayat olsa da değeri geçerlidir.
  if (isKept(s, key)) {
    const v = p.result?.preview?.fields[key];
    if (v != null && String(v).trim() !== '') return { kind: 'ok', value: String(v), label: null, kept: true };
    return p.result?.preview ? { kind: 'empty' } : p.blocked || p.error ? { kind: 'error', text: p.blocked ?? p.error! } : { kind: 'loading' };
  }
  if (!(s.fields[key]?.length)) return { kind: 'idle' };
  // Önizleme eksik varken hiç istenmez; "okunuyor" demek sonsuz bekletir (2026-11-04 cihaz denemesi: başlık atlanmıştı).
  if (p.blocked && !p.fresh) return { kind: 'error', text: `Değer, şu eksik tamamlanınca okunur: ${p.blocked}` };
  if (p.error && !p.fresh) return { kind: 'error', text: p.error };
  if (!p.fresh || !p.result) return { kind: 'loading' };
  if (p.result.errors.length) return { kind: 'error', text: p.result.errors[0]! };
  const v = p.result.preview?.fields[key];
  if (v == null || String(v).trim() === '') return { kind: 'empty' };
  const ex = p.result.explain.find((e) => e.field === key);
  return { kind: 'ok', value: String(v), label: ex?.strategy === 'anchor' ? ex.label : null };
}

export type ChipStatus = 'done' | 'skipped' | 'todo';
export function chipStatus(s: TeachState, key: FieldKey, skipped: readonly FieldKey[] = []): ChipStatus {
  if (s.fields[key]?.length || isKept(s, key)) return 'done';
  return skipped.includes(key) ? 'skipped' : 'todo';
}
