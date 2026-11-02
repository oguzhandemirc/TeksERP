// =============================================================================
// Belge Tara — okuma sonucu izleme: sorgu geçişleri + görünüm metni (saf; React'siz test)
// =============================================================================
// Durum, neden ve toplam kararı SUNUCUDAN gelir (`okuma-ozeti`); burada yalnız "sormaya devam mı"
// ve "operatöre ne yazılır" vardır. Ağ/5xx hatası sorguyu kesmez (zaman aşımına kadar sürer);
// kesin 4xx keser. Üst sınır dolunca "uzun sürüyor" denir, sonuç panelde görünür.
// =============================================================================
import { isAmbiguousFailure } from '../../../offline/entryAttempt';
import type { ReadSummary } from '../../../services/inboundDoc.service';

export const READ_POLL_INTERVAL_MS = 2000;
export const READ_POLL_TIMEOUT_MS = 3 * 60 * 1000;

export type ReadWatch =
  | { phase: 'polling'; startedAt: number; summary: ReadSummary | null }
  | { phase: 'done'; summary: ReadSummary }
  | { phase: 'timeout'; summary: ReadSummary | null }
  | { phase: 'error'; message: string; summary: ReadSummary | null };

export function startWatch(now: number): ReadWatch {
  return { phase: 'polling', startedAt: now, summary: null };
}

export function shouldPoll(w: ReadWatch): boolean {
  return w.phase === 'polling';
}

function timedOut(w: ReadWatch, now: number): boolean {
  return w.phase === 'polling' && now - w.startedAt >= READ_POLL_TIMEOUT_MS;
}

/** Sunucu özeti geldi: READING dışındaki her durum sonuçtur. */
export function onSummary(w: ReadWatch, summary: ReadSummary, now: number): ReadWatch {
  if (w.phase !== 'polling') return w;
  if (summary.state !== 'READING') return { phase: 'done', summary };
  if (timedOut(w, now)) return { phase: 'timeout', summary };
  return { ...w, summary };
}

/** Sorgu düştü: belirsiz hata (ağ/zaman aşımı/5xx) → sormaya devam; kesin 4xx → dur ve nedeni söyle. */
export function onPollError(w: ReadWatch, error: unknown, now: number): ReadWatch {
  if (w.phase !== 'polling') return w;
  if (isAmbiguousFailure(error)) return timedOut(w, now) ? { phase: 'timeout', summary: w.summary } : w;
  const e = error as { status?: number; message?: string; details?: { code?: string } };
  // Uç yoksa (backend bu sürümden eski) Express'in kodsuz 404'ü gelir: taslak var, yalnız özet yok.
  const oldServer = e.status === 404 && e.details?.code !== 'DELIVERY_NOTE_NOT_FOUND';
  const message = oldServer ? 'Sunucu okuma özetini vermiyor (eski sürüm); sonucu panelden izleyin.' : e.message || 'Okuma durumu alınamadı.';
  return { phase: 'error', message, summary: w.summary };
}

export type ReadTone = 'busy' | 'ok' | 'warn' | 'error';

export interface ReadResultView {
  tone: ReadTone;
  title: string;
  reason: string | null;
  rows: { key: string; label: string; value: string; tone?: ReadTone }[];
  /** Toplam uyuşmazlığı, başlık uyarıları ve okuma uyarıları (sunucu metni; istemci ayrıştırmaz). */
  notes: string[];
}

const STATE_TITLE: Record<ReadSummary['state'], { title: string; tone: ReadTone }> = {
  READING: { title: 'Okunuyor…', tone: 'busy' },
  READ: { title: 'Okundu', tone: 'ok' },
  PARTIAL: { title: 'Kısmen okundu', tone: 'warn' },
  FAILED: { title: 'Okunamadı', tone: 'error' },
  NO_SERVICE: { title: 'Otomatik okuma yok', tone: 'warn' },
  NO_PAGES: { title: 'Okunacak sayfa yok', tone: 'warn' },
};

function totalsValue(t: ReadSummary['totals']): { value: string; tone: ReadTone } {
  if (t.ok === null) return { value: 'Belgede toplam yok', tone: 'warn' };
  return t.ok ? { value: 'Tutuyor', tone: 'ok' } : { value: 'Tutmuyor', tone: 'error' };
}

function summaryRows(s: ReadSummary, noteNo: string): ReadResultView['rows'] {
  const rows: ReadResultView['rows'] = [{ key: 'no', label: 'Taslak', value: noteNo }];
  if (s.state === 'READING') {
    if (s.pages.total > 1) rows.push({ key: 'sayfa', label: 'Sayfa', value: `${s.pages.read + s.pages.failed}/${s.pages.total} bitti` });
    return rows;
  }
  if (s.state !== 'READ' && s.state !== 'PARTIAL') return rows;
  const t = totalsValue(s.totals);
  rows.push(
    { key: 'satir', label: 'Satır', value: String(s.lineCount) },
    { key: 'gozden', label: 'Gözden geçirilecek', value: String(s.reviewCount), tone: s.reviewCount > 0 ? 'warn' : 'ok' },
    { key: 'toplam', label: 'Toplam', value: t.value, tone: t.tone },
  );
  return rows;
}

/** Operatöre basılacak kart içeriği. `noteNo` gönderimden bilinir (özet gelmeden de gösterilir). */
export function readResultView(w: ReadWatch, noteNo: string): ReadResultView {
  const s = w.summary;
  const rows = s ? summaryRows(s, noteNo) : [{ key: 'no', label: 'Taslak', value: noteNo }];
  const notices = s?.notices ?? [];
  const notes = s && (s.state === 'READ' || s.state === 'PARTIAL')
    ? [...s.totals.mismatches, ...s.warnings, ...notices.map((n) => `${n.title}: ${n.detail}`)]
    : [];
  if (w.phase === 'error') return { tone: 'error', title: 'Okuma durumu alınamadı', reason: w.message, rows, notes };
  if (w.phase === 'timeout') {
    return { tone: 'warn', title: 'Okuma uzun sürüyor', reason: 'Sonuç birkaç dakikadır gelmedi; panelde görünecek. "Yeniden bak" ile tekrar sorabilirsiniz.', rows, notes };
  }
  if (!s) return { tone: 'busy', title: 'Okunuyor…', reason: null, rows, notes };
  const head = STATE_TITLE[s.state];
  // Okundu ama gözden geçirme/toplam/neden varsa yeşil değil: operatör panele haber vermeli.
  const tone = head.tone === 'ok' && (s.reason || s.reviewCount > 0 || s.totals.ok !== true || s.warnings.length || notices.length) ? 'warn' : head.tone;
  return { tone, title: head.title, reason: s.reason, rows, notes };
}
