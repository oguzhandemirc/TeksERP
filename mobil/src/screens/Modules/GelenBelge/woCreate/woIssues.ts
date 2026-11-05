// Tek İE formunun engel sözlüğü: her engel bir alana bağlı (`key`) — alt çubuk hapı o alanı açar, şerit tonu ondan
// okunur. Metin uzun cümledir (toplu görünüm maddesi), `short` alt çubuk hapının kısa adıdır.
import type { BandTone } from '../../../../components/form/tone';
import type { WoFieldKey } from './woFieldCatalog';

export type IssueKey = WoFieldKey | 'belge' | 'metreDogrula';

export interface FormIssue {
  key: IssueKey;
  text: string;
}

export interface MissingChip {
  key: IssueKey;
  text: string;
}

const SHORT: Partial<Record<IssueKey, string>> = {
  belge: 'Belge okutulmadı',
  musteri: 'Müşteri seçilmedi',
  kursunMetresi: 'Metre yok',
  metreDogrula: 'Metreyi doğrulayın',
  rota: 'Rota seçilmedi',
  rotaAdimlari: 'Rota adımı yok',
  katTipi: 'Kat tipi',
  en: 'En hatalı',
  hedefMetraj: 'Metraj hatalı',
  hedefKg: 'Kg hatalı',
  planBitis: 'Plan tarihi',
  isEmriTuru: 'Sipariş kalemi',
};

/** Alt çubuk hapları: anahtar başına bir hap (ilk engel sırası korunur). */
export function missingChips(issues: readonly FormIssue[]): MissingChip[] {
  const seen = new Set<IssueKey>();
  const out: MissingChip[] = [];
  for (const i of issues) {
    if (seen.has(i.key)) continue;
    seen.add(i.key);
    out.push({ key: i.key, text: SHORT[i.key] ?? i.text });
  }
  return out;
}

/**
 * Şerit tonu tek kural: şeridin alanlarında engel yoksa `done` ise ✓ (ok), değilse durumsuz (idle); engel varsa
 * `warnKeys` içindekiler sarı (düzeltilecek değer), diğerleri kırmızı (eksik seçim).
 */
export function bandTone(
  issues: readonly FormIssue[],
  opts: { keys: readonly IssueKey[]; warnKeys?: readonly IssueKey[]; done?: boolean },
): BandTone {
  const mine = issues.filter((i) => opts.keys.includes(i.key));
  if (mine.length === 0) return opts.done ? 'ok' : 'idle';
  return mine.some((i) => !(opts.warnKeys ?? []).includes(i.key)) ? 'missing' : 'warn';
}

export const TARGET_ISSUE_KEYS: readonly IssueKey[] = ['en', 'hedefMetraj', 'hedefKg', 'katTipi'];
export const TARGET_WARN_KEYS: readonly IssueKey[] = ['en', 'hedefMetraj', 'hedefKg'];
