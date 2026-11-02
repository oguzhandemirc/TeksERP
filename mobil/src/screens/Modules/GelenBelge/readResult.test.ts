// Okuma sonucu izleme: geçişler (okunuyor → okundu / okunamadı / zaman aşımı / kesin hata) ve kart metni.
// Negatif sonda (2026-11-02): notes'tan `notices` çıkarılınca "okuma uyarıları karta basılır" kırmızı.
import type { ReadSummary } from '../../../services/inboundDoc.service';
import { READ_POLL_TIMEOUT_MS, onPollError, onSummary, readResultView, shouldPoll, startWatch } from './readResult';

const base: ReadSummary = {
  noteId: 'n1',
  noteNo: 'GB-0001',
  noteStatus: 'DRAFT',
  state: 'READING',
  reason: null,
  pages: { total: 1, waiting: 1, read: 0, failed: 0 },
  lineCount: 0,
  reviewCount: 0,
  totals: { declared: false, ok: null, mismatches: [] },
  warnings: [],
};
const sum = (p: Partial<ReadSummary>): ReadSummary => ({ ...base, ...p });
const err = (status: number | undefined, message = 'x', code?: string) => Object.assign(new Error(message), { status, details: code ? { code } : undefined });
const T0 = 1_000_000;

describe('readResult — geçişler', () => {
  it('okunuyor → okunuyor (sorgu sürer) → okundu (sorgu durur)', () => {
    let w = startWatch(T0);
    expect(shouldPoll(w)).toBe(true);
    w = onSummary(w, sum({}), T0 + 2000);
    expect(w.phase).toBe('polling');
    expect(shouldPoll(w)).toBe(true);
    w = onSummary(w, sum({ state: 'READ', lineCount: 21 }), T0 + 4000);
    expect(w.phase).toBe('done');
    expect(shouldPoll(w)).toBe(false);
  });

  it('okunamadı / servis yok / sayfa yok / kısmen → sonuçtur, sorgu durur', () => {
    for (const state of ['FAILED', 'NO_SERVICE', 'NO_PAGES', 'PARTIAL'] as const) {
      const w = onSummary(startWatch(T0), sum({ state }), T0 + 1);
      expect(w.phase).toBe('done');
      expect(shouldPoll(w)).toBe(false);
    }
  });

  it('üst sınır dolunca hâlâ READING → zaman aşımı (sorgu durur); sınırdan önce sürer', () => {
    const w = startWatch(T0);
    expect(onSummary(w, sum({}), T0 + READ_POLL_TIMEOUT_MS - 1).phase).toBe('polling');
    const t = onSummary(w, sum({}), T0 + READ_POLL_TIMEOUT_MS);
    expect(t.phase).toBe('timeout');
    expect(shouldPoll(t)).toBe(false);
  });

  it('ağ/5xx hatası sorguyu kesmez; süre dolunca zaman aşımı', () => {
    const w = startWatch(T0);
    expect(onPollError(w, err(undefined), T0 + 10).phase).toBe('polling');
    expect(onPollError(w, err(503), T0 + 10).phase).toBe('polling');
    expect(onPollError(w, err(undefined), T0 + READ_POLL_TIMEOUT_MS).phase).toBe('timeout');
  });

  it('kesin 4xx → hata, sunucu mesajı; kodsuz 404 (eski sunucu, uç yok) → eski sürüm mesajı', () => {
    const w = startWatch(T0);
    const forbidden = onPollError(w, err(403, 'Yetkiniz yok'), T0);
    expect(forbidden).toMatchObject({ phase: 'error', message: 'Yetkiniz yok' });
    const gone = onPollError(w, err(404, 'Gelen belge taslağı bulunamadı.', 'DELIVERY_NOTE_NOT_FOUND'), T0);
    expect(gone).toMatchObject({ phase: 'error', message: 'Gelen belge taslağı bulunamadı.' });
    const old = onPollError(w, err(404, 'Not found'), T0);
    expect(old).toMatchObject({ phase: 'error' });
    expect(old.phase === 'error' && old.message).toMatch(/eski sürüm/);
  });

  it('bitmiş izlemeye geç gelen yanıt durumu değiştirmez', () => {
    const done = onSummary(startWatch(T0), sum({ state: 'READ' }), T0);
    expect(onSummary(done, sum({ state: 'FAILED' }), T0)).toBe(done);
    expect(onPollError(done, err(403), T0)).toBe(done);
  });
});

describe('readResult — kart metni', () => {
  it('özet gelmeden: Okunuyor… + taslak no', () => {
    const v = readResultView(startWatch(T0), 'GB-0007');
    expect(v).toMatchObject({ tone: 'busy', title: 'Okunuyor…', reason: null });
    expect(v.rows).toEqual([{ key: 'no', label: 'Taslak', value: 'GB-0007' }]);
  });

  it('okundu + toplam tutuyor + gözden geçirme yok → yeşil; satır/gözden/toplam satırları', () => {
    const w = onSummary(startWatch(T0), sum({ state: 'READ', lineCount: 21, totals: { declared: true, ok: true, mismatches: [] } }), T0);
    const v = readResultView(w, 'GB-0001');
    expect(v.tone).toBe('ok');
    expect(v.title).toBe('Okundu');
    expect(v.rows.map((r) => [r.label, r.value])).toEqual([
      ['Taslak', 'GB-0001'],
      ['Satır', '21'],
      ['Gözden geçirilecek', '0'],
      ['Toplam', 'Tutuyor'],
    ]);
    expect(v.notes).toEqual([]);
  });

  it('okundu ama toplam tutmuyor + gözden geçirme var → uyarı tonu, uyuşmazlık metni notlarda', () => {
    const totals = { declared: true, ok: false, mismatches: ['Blok 1: beyan 586 m, satır toplamı 686.000 m.'] };
    const w = onSummary(startWatch(T0), sum({ state: 'READ', lineCount: 5, reviewCount: 2, totals, warnings: ['Belgede 4 top yazıyor, satır sayısı 5.'] }), T0);
    const v = readResultView(w, 'GB-0001');
    expect(v.tone).toBe('warn');
    expect(v.rows.find((r) => r.key === 'toplam')).toMatchObject({ value: 'Tutmuyor', tone: 'error' });
    expect(v.rows.find((r) => r.key === 'gozden')).toMatchObject({ value: '2', tone: 'warn' });
    expect(v.notes).toEqual(['Blok 1: beyan 586 m, satır toplamı 686.000 m.', 'Belgede 4 top yazıyor, satır sayısı 5.']);
  });

  it('okuma uyarıları (notices) karta "başlık: ayrıntı" olarak basılır ve yeşili uyarıya çevirir', () => {
    const notices = [
      { code: 'SECOND_DOCUMENT_TRACE', title: 'Sayfada ikinci belge var', detail: 'Ürün sevk fişi (Sevk No 96399) — ayrı fotoğrafla yükleyin' },
      { code: 'GRID_EMPTY', title: 'El yazısı okunamadı — satırları elle girin', detail: 'Bölge 1: satır çıkmadı' },
    ];
    const w = onSummary(startWatch(T0), sum({ state: 'READ', lineCount: 1, totals: { declared: true, ok: true, mismatches: [] }, notices }), T0);
    const v = readResultView(w, 'GB-0246');
    expect(v.tone).toBe('warn');
    expect(v.notes).toEqual([
      'Sayfada ikinci belge var: Ürün sevk fişi (Sevk No 96399) — ayrı fotoğrafla yükleyin',
      'El yazısı okunamadı — satırları elle girin: Bölge 1: satır çıkmadı',
    ]);
  });

  it('eski sunucu notices göndermez → kart bugünkü gibi (yeşil, not yok); okunurken uyarı basılmaz', () => {
    const old = onSummary(startWatch(T0), sum({ state: 'READ', lineCount: 2, totals: { declared: true, ok: true, mismatches: [] } }), T0);
    expect(readResultView(old, 'GB-1')).toMatchObject({ tone: 'ok', notes: [] });
    const busy = onSummary(startWatch(T0), sum({ notices: [{ code: 'X_Y', title: 't', detail: 'd' }] }), T0);
    expect(readResultView(busy, 'GB-1').notes).toEqual([]);
  });

  it('belgede toplam beyanı yok → "Belgede toplam yok"', () => {
    const w = onSummary(startWatch(T0), sum({ state: 'READ', lineCount: 3 }), T0);
    expect(readResultView(w, 'GB-1').rows.find((r) => r.key === 'toplam')?.value).toBe('Belgede toplam yok');
  });

  it('okunamadı → kırmızı + sunucunun Türkçe nedeni; satır özeti basılmaz', () => {
    const w = onSummary(startWatch(T0), sum({ state: 'FAILED', reason: 'Okuma servisi sayfayı okuyamadı.' }), T0);
    const v = readResultView(w, 'GB-1');
    expect(v).toMatchObject({ tone: 'error', title: 'Okunamadı', reason: 'Okuma servisi sayfayı okuyamadı.' });
    expect(v.rows.map((r) => r.key)).toEqual(['no']);
  });

  it('okunurken yeniden deneme nedeni + çok sayfada ilerleme', () => {
    const w = onSummary(startWatch(T0), sum({ reason: 'yeniden deneniyor (deneme 2/3)', pages: { total: 3, waiting: 2, read: 1, failed: 0 } }), T0);
    const v = readResultView(w, 'GB-1');
    expect(v).toMatchObject({ tone: 'busy', title: 'Okunuyor…', reason: 'yeniden deneniyor (deneme 2/3)' });
    expect(v.rows.find((r) => r.key === 'sayfa')?.value).toBe('1/3 bitti');
  });

  it('zaman aşımı ve kesin hata metinleri', () => {
    const t = onSummary(startWatch(T0), sum({}), T0 + READ_POLL_TIMEOUT_MS);
    expect(readResultView(t, 'GB-1')).toMatchObject({ tone: 'warn', title: 'Okuma uzun sürüyor' });
    expect(readResultView(t, 'GB-1').reason).toMatch(/panelde görünecek/);
    const e = onPollError(startWatch(T0), err(403, 'Yetkiniz yok'), T0);
    expect(readResultView(e, 'GB-1')).toMatchObject({ tone: 'error', title: 'Okuma durumu alınamadı', reason: 'Yetkiniz yok' });
  });
});
