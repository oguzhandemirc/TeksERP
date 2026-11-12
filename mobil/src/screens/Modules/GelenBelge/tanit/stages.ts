// Üç aşamalı tanıtma (2026-11-09) — saf çekirdek: ① Tanıma (kimlik yazıları + ad) · ② Eşleme (belge alanı → İE karşılığı,
// gruplu) · ③ Kurallar (tekrar eden bölüm, çok parti, toplam satırı). Eksikler aşamasına bağlıdır (`teachIssues`); ileri
// gitmek önceki aşamalar temizse serbest, geri dönmek her zaman. Panel ikizi P2'de bu kuralları aynalar.
import type { MultiPartyRule, ScanWord, SuggestResult } from '../../../../types/inboundDocTeach';
import { FIELD_GROUP_ORDER, FIELD_TARGETS, MAP_FIELD_ORDER, fieldLabel, type FieldGroup } from './fieldTargets';
import { chipStatus, identifierWordSet, toggleFieldWord, toggleHeaderWord } from './guided';
import {
  assignColumn, byReading, clearColumn, COLUMN_OPTIONS, identifierText, isKept, sectionStartText, teachIssues, teachMarks, textOf,
  type ColumnKey, type FieldKey, type ScanMark, type Stage, type TeachIssue, type TeachState,
} from './teachDraft';
import { TERIM } from '../../../../lib/terim';

export type { Stage } from './teachDraft';

export const STAGES: readonly { key: Stage; no: number; label: string }[] = [
  { key: 'TANIMA', no: 1, label: 'Tanıma' },
  { key: 'ESLEME', no: 2, label: 'Eşleme' },
  { key: 'KURALLAR', no: 3, label: 'Kurallar' },
];
export const stageIndex = (s: Stage): number => STAGES.findIndex((x) => x.key === s);

/** Belgeye dokunuşun gideceği yer: ② alan / tablo sütunu, ③ bölüm başlangıcı / toplam satırı. ① her zaman kimlik satırı. */
export type TapTarget = { kind: 'field'; key: FieldKey } | { kind: 'column'; key: ColumnKey } | { kind: 'section' } | { kind: 'totals' } | null;
export interface StagePos {
  stage: Stage;
  target: TapTarget;
}

export function stageIssues(s: TeachState, words: readonly ScanWord[] | undefined, stage: Stage): TeachIssue[] {
  return teachIssues(s, words).filter((i) => i.stage === stage);
}

export function canAdvance(s: TeachState, words: readonly ScanWord[] | undefined, stage: Stage): boolean {
  return stageIssues(s, words, stage).length === 0;
}

/** Aşama şeridinden `to`ya gidilebilir mi: geri her zaman; ileri, aradaki bütün aşamalar temizse. */
export function canReach(s: TeachState, words: readonly ScanWord[] | undefined, current: Stage, to: Stage): boolean {
  const ti = stageIndex(to);
  if (ti <= stageIndex(current)) return true;
  const issues = teachIssues(s, words);
  return STAGES.slice(0, ti).every((st) => !issues.some((i) => i.stage === st.key));
}

/** Şeritte onay işareti: geride kalmış ve sorunsuz aşama. */
export function stageDone(s: TeachState, words: readonly ScanWord[] | undefined, current: Stage, stage: Stage): boolean {
  return stageIndex(stage) < stageIndex(current) && canAdvance(s, words, stage);
}

/** ② listesinde görünür mü: varsayılan görünür ya da bu tanımda işaretli/kayıtlı/kaldırılmış ya da şu an seçili. */
function visibleField(s: TeachState, k: FieldKey, active: FieldKey | null): boolean {
  return FIELD_TARGETS[k].defaultVisible || !!s.fields[k]?.length || s.kept.includes(k) || s.drop.includes(k) || active === k;
}

/** ② gruplar (çerçeveler; başlık satırı yok) + "Diğer alanlar" altındaki kalanlar. */
export function mapGroups(s: TeachState, active: FieldKey | null = null): { groups: { group: FieldGroup; keys: FieldKey[] }[]; more: FieldKey[] } {
  const groups = FIELD_GROUP_ORDER.map((group) => ({ group, keys: MAP_FIELD_ORDER.filter((k) => FIELD_TARGETS[k].group === group && visibleField(s, k, active)) })).filter((g) => g.keys.length > 0);
  return { groups, more: MAP_FIELD_ORDER.filter((k) => !visibleField(s, k, active)) };
}

/** ②'ye girerken seçili satır: görünür ilk atanmamış alan (yoksa ilk görünür). */
export function firstTodo(s: TeachState): FieldKey {
  const keys = mapGroups(s).groups.flatMap((g) => g.keys);
  return keys.find((k) => chipStatus(s, k) === 'todo' && !s.drop.includes(k)) ?? keys[0] ?? 'musteri';
}

/** Dokunulan kelimeyi sütun başlığına ekle / çıkar (başlık birden çok kelime olabilir). */
export function toggleColumnWord(s: TeachState, words: readonly ScanWord[], key: ColumnKey, i: number): TeachState {
  const cur = s.columns[key] ?? [];
  if (cur.includes(i)) {
    const left = cur.filter((x) => x !== i);
    return left.length ? { ...s, columns: { ...s.columns, [key]: left } } : clearColumn(s, key);
  }
  return assignColumn({ ...s, selected: [...cur, i] }, words, key);
}

/** Toplam satırı yazısına kelime ekle / çıkar. */
export function toggleTotalsWord(s: TeachState, words: readonly ScanWord[], i: number): TeachState {
  const cur = s.totalsLabel ?? [];
  const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort(byReading(words));
  return { ...s, totalsLabel: next.length ? next : null };
}

/** Bölüm başlangıç yazısı seçili kelimelerin etiket kısmı (`sectionStartText`): değer her partide değişir, kaydedilmez. */
const sectionTextOf = (words: readonly ScanWord[], idx: readonly number[]) => sectionStartText(textOf(words, idx)).slice(0, 40);

/** Bölüm başlangıç yazısına kelime ekle / çıkar; metin kelimelerin etiket kısmından kurulur. */
export function toggleSectionWord(s: TeachState, words: readonly ScanWord[], i: number): TeachState {
  const next = s.sectionWords.includes(i) ? s.sectionWords.filter((x) => x !== i) : [...s.sectionWords, i].sort(byReading(words));
  return { ...s, sectionWords: next, sectionStart: sectionTextOf(words, next) };
}

/** Kayıtlı alan bu sefer kaldırılsın (`base.drop`) | kaldırma geri alınsın. */
export function dropKept(s: TeachState, k: FieldKey): TeachState {
  return s.kept.includes(k) && !s.drop.includes(k) ? { ...s, drop: [...s.drop, k], sectionFields: s.sectionFields.filter((x) => x !== k) } : s;
}
export function undoDrop(s: TeachState, k: FieldKey): TeachState {
  return { ...s, drop: s.drop.filter((x) => x !== k) };
}

/** Belgeye dokunuş: aşamaya ve seçili hedefe göre durum geçişi. */
export function stageTap(s: TeachState, words: readonly ScanWord[], nav: StagePos, i: number): TeachState {
  const { stage, target } = nav;
  if (stage === 'TANIMA') return toggleHeaderWord(s, words, i);
  if (!target) return s;
  if (stage === 'ESLEME' && target.kind === 'field') return toggleFieldWord(s, words, target.key, i);
  if (stage === 'ESLEME' && target.kind === 'column') return toggleColumnWord(s, words, target.key, i);
  if (stage === 'KURALLAR' && target.kind === 'section' && s.repeats) return toggleSectionWord(s, words, i);
  if (stage === 'KURALLAR' && target.kind === 'totals') return toggleTotalsWord(s, words, i);
  return s;
}

const columnLabel = (k: ColumnKey) => COLUMN_OPTIONS.find((c) => c.key === k)?.label ?? k;

/** Fotoğraf kutuları: ① kimlik satırları; ② seçili alanın/sütunun değeri; ③ bölüm başlangıcı + seçili hedef. */
export function stageMarks(s: TeachState, words: readonly ScanWord[], nav: StagePos, located: Partial<Record<FieldKey, number[]>> = {}): ScanMark[] {
  const { stage, target } = nav;
  const base = teachMarks({ ...s, selected: [] }, words, located);
  if (stage === 'TANIMA') {
    const ids = identifierWordSet(s, words);
    return base.map((m, i) => (ids.has(i) && m.tone === 'word' ? { ...m, tone: 'identifier' as const, label: 'Kimlik yazısı' } : m));
  }
  const paint = (idx: readonly number[], tone: ScanMark['tone'], label: string) => {
    const set = new Set(idx);
    return (m: ScanMark, i: number) => (set.has(i) ? { ...m, tone, label } : m);
  };
  if (stage === 'ESLEME' && target?.kind === 'field') return base.map(paint(s.fields[target.key] ?? located[target.key] ?? [], 'selected', fieldLabel(target.key)));
  if (stage === 'ESLEME' && target?.kind === 'column') return base.map(paint(s.columns[target.key] ?? [], 'selected', `Sütun: ${columnLabel(target.key)}`));
  if (stage !== 'KURALLAR') return base;
  const sectionOk = s.repeats && s.sectionWords.length > 0 && sectionTextOf(words, s.sectionWords) === s.sectionStart;
  // Etiket kısmına düşen seçimde yalnız etiket kelimeleri boyanır; kısa etiket (tam metin) bütün seçimdir.
  const labelOnly = sectionStartText(textOf(words, s.sectionWords)) !== textOf(words, s.sectionWords).trim();
  const sectionPaint = labelOnly ? s.sectionWords.filter((k) => identifierText(words[k]!.text) !== '') : s.sectionWords;
  let out = sectionOk ? base.map(paint(sectionPaint, target?.kind === 'section' ? 'selected' : 'section', 'Bölüm başlangıcı')) : base;
  if (target?.kind === 'totals') out = out.map(paint(s.totalsLabel ?? [], 'selected', 'Toplam satırı'));
  return out;
}

/** Kaydedilecek alan sayısı: işaretli + kayıtlı (kaldırılmamış, yeniden işaretlenmemiş). */
export function fieldCount(s: TeachState): number {
  return MAP_FIELD_ORDER.filter((k) => !!s.fields[k]?.length || isKept(s, k)).length;
}

/** Tabloya bağlı kural (toplam satırı) yalnız sütun varken gövdeye girer. */
export const hasTable = (s: TeachState): boolean => Object.values(s.columns).some((v) => (v?.length ?? 0) > 0);

export function ruleCount(s: TeachState): number {
  return (s.multiParty ? 1 : 0) + (s.repeats ? 1 : 0) + (s.totalsLabel?.length && hasTable(s) ? 1 : 0);
}

/** ③ Kaydet çubuğu özeti: "3 kimlik yazısı · 7 alan · 2 kural". */
export function saveSummary(s: TeachState): string {
  return `${s.identifiers.filter((d) => d.on).length} kimlik yazısı · ${fieldCount(s)} alan · ${ruleCount(s)} kural`;
}

export const MULTI_PARTY_TEXT: Record<MultiPartyRule, string> = { PER_PARTY: 'Her parti ayrı İE', SINGLE: 'Tek İE' };

/** ③ çok parti seçenekleri (null = fabrika ayarı = gövdede kural yok). */
export function multiPartyChoices(factory: MultiPartyRule | undefined): { value: MultiPartyRule | null; label: string; hint?: string }[] {
  return [
    { value: null, label: 'Fabrika ayarı', hint: factory ? `Şu an: ${MULTI_PARTY_TEXT[factory]}` : 'Ayarlar sayfasındaki seçim uygulanır' },
    { value: 'PER_PARTY', label: MULTI_PARTY_TEXT.PER_PARTY, hint: `Her parti için ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} açılır` },
    { value: 'SINGLE', label: MULTI_PARTY_TEXT.SINGLE, hint: `Tek ${TERIM.terbiyeIsEmri.tekilKucuk}; partiler ayrı top olur` },
  ];
}

/** ③ bölüm önizlemesi: "‘PARTİ NO’ ile başlıyor · 3 bölüm bulundu" (önizleme yoksa yalnız başlangıç). */
export function sectionPreviewText(s: TeachState, result: SuggestResult | null): string | null {
  if (!s.repeats || !s.sectionStart.trim()) return null;
  const n = result?.preview?.blocks?.length ?? 0;
  return `‘${s.sectionStart.trim()}’ ile başlıyor${n > 0 ? ` · ${n} bölüm bulundu` : ''}`;
}

/** ③ "Gelen metre kaynağı" salt bilgi satırı — sunucunun önerdiği `meterSources`tan (istemci karar vermez). */
export function meterSourceText(result: SuggestResult | null): string | null {
  const t = result?.template;
  if (!t) return null;
  const ms = (t.meterSources ?? {}) as { output?: unknown; total?: unknown };
  const has = (v: unknown, x: string) => Array.isArray(v) && v.includes(x);
  if (has(ms.output, '$tableTotal')) return 'Toplam satırından';
  if (has(ms.total, 'toplamMetre')) {
    const v = result?.preview?.fields.toplamMetre;
    return v != null && String(v).trim() !== '' ? `"Gelen metre" alanından (${String(v)} m)` : '"Gelen metre" alanından';
  }
  if (Array.isArray(t.tables) && t.tables.length > 0) return 'Tablo satırlarının toplamından';
  return `Belgeden okunmuyor — ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} elle girilir`;
}

/** ① canlı tanıma satırı (önizlemeden). */
export function recognitionText(result: SuggestResult | null): { ok: boolean; text: string } | null {
  const p = result?.preview;
  if (!p) return null;
  const pct = Math.round(Math.max(0, Math.min(1, p.score)) * 100);
  return p.matched ? { ok: true, text: `Bu yazılarla tanınıyor: %${pct}` } : { ok: false, text: `Bu yazılarla tanınmıyor (%${pct}); başka bir sabit yazıya da dokunun.` };
}
