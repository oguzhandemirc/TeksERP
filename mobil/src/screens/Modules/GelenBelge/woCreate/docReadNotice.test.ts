// Belge şeridi dili (§2c tablosu): hap + kısa eylemli ileti; sunucu `reason` metni gösterilmez, "panel" geçmez.
import type { ReadSummary } from '../../../../services/inboundDoc.service';
import type { ReadWatch } from '../readResult';
import { docReadNotices, docReadPill } from './docReadNotice';

const summary = (x: Partial<ReadSummary> = {}): ReadSummary => ({
  noteId: 'n1', noteNo: 'GB-1', noteStatus: 'DRAFT', state: 'READ',
  reason: 'Sayfa okundu ama satır çıkmadı; panelden yeniden okutun ya da satırları elle girin.',
  pages: { total: 1, waiting: 0, read: 1, failed: 0 }, lineCount: 0, reviewCount: 0,
  totals: { declared: false, ok: null, mismatches: [] }, warnings: [], ...x,
});
const done = (x: Partial<ReadSummary> = {}): ReadWatch => ({ phase: 'done', summary: summary(x) });
const all = (w: ReadWatch | null, extra: { formFilled?: boolean; detailFailed?: boolean } = {}) => {
  const n = docReadNotices({ watch: w, ...extra });
  return { pill: docReadPill({ watch: w, ...extra }), notices: n, texts: n.map((x) => x.text) };
};

describe('docReadNotice', () => {
  it('⭐ Gülkesim: READ + satır 0 + müşteri/metre dolu → ileti YOK, hap "Okundu"', () => {
    const r = all(done({ ownerCustomerId: 'c1', kursunMeters: '241' }));
    expect(r.notices).toEqual([]);
    expect(r.pill).toMatchObject({ tone: 'ok', text: 'Okundu' });
    expect(all(done({ formFields: { en: 350 } })).notices).toEqual([]);
    expect(all(done(), { formFilled: true }).notices).toEqual([]);
  });

  it('READ + satır 0 + hiçbir alan yok → sarı "bilgi çıkmadı" + Yeniden okut', () => {
    const r = all(done());
    expect(r.pill).toMatchObject({ tone: 'warn', text: 'Kontrol et' });
    expect(r.notices).toEqual([{ key: 'bos', tone: 'warn', text: 'Belgeden bilgi çıkmadı. Tekrar okutun ya da elle doldurun.', action: 'reread' }]);
  });

  it('satırlı READ → ileti yok', () => {
    expect(all(done({ lineCount: 4 })).notices).toEqual([]);
  });

  it('PARTIAL / FAILED / NO_SERVICE / NO_PAGES', () => {
    expect(all(done({ state: 'PARTIAL', lineCount: 3 }))).toMatchObject({ pill: { text: 'Kontrol et' }, notices: [{ tone: 'warn', action: 'reread' }] });
    expect(all(done({ state: 'FAILED' }))).toMatchObject({ pill: { tone: 'missing', text: 'Okunamadı' }, texts: ['Belge okunamadı. Tekrar okutun ya da elle doldurun.'] });
    expect(all(done({ state: 'NO_SERVICE' }))).toMatchObject({ pill: { tone: 'info', text: 'Elle doldurun' }, texts: ['Otomatik okuma kapalı; bilgileri elle girin.'] });
    expect(all(done({ state: 'NO_PAGES' })).texts).toEqual(['Belgede okunacak fotoğraf yok; bilgileri elle girin.']);
    expect(all(done({ state: 'NO_SERVICE' })).notices[0].action).toBeUndefined();
  });

  it('okunuyor / zaman aşımı / hata / detay hatası', () => {
    expect(all(null).pill.text).toBe('Okunuyor…');
    expect(all({ phase: 'polling', startedAt: 0, summary: null })).toMatchObject({ pill: { tone: 'busy' }, notices: [] });
    expect(all({ phase: 'timeout', summary: null }).notices).toEqual([{ key: 'zaman-asimi', tone: 'warn', text: 'Okuma uzun sürdü.', action: 'recheck' }]);
    expect(all({ phase: 'error', message: 'x', summary: null }).notices[0]).toMatchObject({ tone: 'danger', text: 'Okuma durumu alınamadı.', action: 'recheck' });
    expect(all(done({ lineCount: 2 }), { detailFailed: true }).texts).toEqual(['Belge ayrıntısı alınamadı; özet bilgilerle dolduruldu.']);
  });

  it('⭐ hiçbir metinde "panel" ve "satır çıkmadı" geçmez', () => {
    const watches: ReadWatch[] = [done(), done({ state: 'PARTIAL' }), done({ state: 'FAILED' }), done({ state: 'NO_SERVICE' }), done({ state: 'NO_PAGES' }),
      { phase: 'timeout', summary: null }, { phase: 'error', message: 'panel', summary: null }];
    for (const w of watches) {
      for (const t of all(w, { detailFailed: true }).texts) expect(t).not.toMatch(/panel|satır çıkmadı/i);
    }
  });
});
