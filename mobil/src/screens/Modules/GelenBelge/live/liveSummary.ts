// Canlı okuma alan özeti — saf. Yan panel başlığının "x/y tamam" sayımı ile dar ekran özet şeridi AYNI yerden türer
// (alan durumu `liveFieldStatus` + `liveSuggestion`); şerit ikinci bir durum hesabı yapmaz. Bilgi alanı (müşteri) sayılmaz.
import { isLiveInfoOnly } from './liveLocks';
import { isLiveSettled, liveFieldStatus, liveSuggestion, type LiveField, type LiveVoteState } from './liveVote';

/** Şerit işareti: okundu (oy kilidi) · elle kilitli · okunuyor · uyarı (son kareler farklı) · belgede yok. */
export type LiveStripMark = 'read' | 'userLocked' | 'reading' | 'warn' | 'absent';

export interface LiveStripItem {
  key: string;
  label: string;
  mark: LiveStripMark;
}

const countable = (f: LiveField) => !isLiveInfoOnly(f.key);

/** Tamamlanan / toplam (bilgi alanları hariç) — panel başlığı ve şerit aynı sayıyı gösterir. */
export function liveProgress(vote: LiveVoteState): { settled: number; total: number } {
  const fields = vote.fields.filter(countable);
  return { settled: fields.filter(isLiveSettled).length, total: fields.length };
}

export function liveStripMark(f: LiveField): LiveStripMark {
  if (liveSuggestion(f) !== null) return 'warn';
  const status = liveFieldStatus(f);
  if (status === 'locked') return f.lock?.by === 'user' ? 'userLocked' : 'read';
  return status === 'absent' ? 'absent' : 'reading';
}

export function liveStripItems(vote: LiveVoteState): LiveStripItem[] {
  return vote.fields.filter(countable).map((f) => ({ key: f.key, label: f.label, mark: liveStripMark(f) }));
}

/** Şeride sığanlar: uyarılılar öne; karakter bütçesi dolunca kalan "+N" olur (en az bir alan görünür). */
export function fitLiveStrip(items: readonly LiveStripItem[], budgetChars: number): { shown: LiveStripItem[]; hidden: number } {
  const ordered = [...items.filter((i) => i.mark === 'warn'), ...items.filter((i) => i.mark !== 'warn')];
  const shown: LiveStripItem[] = [];
  let used = 0;
  for (const item of ordered) {
    const cost = item.label.length + 3; // ikon + ayraç
    if (shown.length > 0 && used + cost > budgetChars) break;
    shown.push(item);
    used += cost;
  }
  return { shown, hidden: ordered.length - shown.length };
}
