// sessionEntriesStore — "bu oturumda girilenler" kovası: pending/onay/başarısızlık
// akışı + logout temizliği. Liste ekran değil GİRİŞ OTURUMU ömürlüdür.
import { sessionBucketKey, useSessionEntriesStore } from './sessionEntriesStore';
import type { Roll } from '../types/models';

const roll = (id: string): Roll =>
  ({ id, barcode: `TEKS-${id}`, itemId: 'i1', initialQty: 10, currentQty: 10 }) as Roll;

describe('sessionEntriesStore', () => {
  beforeEach(() => useSessionEntriesStore.getState().clearAll());

  it('addPending sayaç artırır; confirmRoll pending→onaylı kayda çevirir', () => {
    const s = useSessionEntriesStore.getState();
    s.addPending('RAW_QC');
    s.addPending('RAW_QC');
    let b = useSessionEntriesStore.getState().buckets.RAW_QC;
    expect(b.pending).toBe(2);
    expect(b.rolls).toHaveLength(0);

    s.confirmRoll('RAW_QC', roll('a'));
    b = useSessionEntriesStore.getState().buckets.RAW_QC;
    expect(b.pending).toBe(1);
    expect(b.rolls.map((r) => r.id)).toEqual(['a']);
  });

  it('failPending sayacı geri alır (şişme yok, negatife düşmez)', () => {
    const s = useSessionEntriesStore.getState();
    s.addPending('RAW_QC');
    s.failPending('RAW_QC');
    s.failPending('RAW_QC'); // fazladan çağrı güvenli
    expect(useSessionEntriesStore.getState().buckets.RAW_QC.pending).toBe(0);
  });

  it('aynı top iki kez onaylanırsa tekrar etmez, en yeni başa gelir', () => {
    const s = useSessionEntriesStore.getState();
    s.confirmRoll('RAW_QC', roll('a'));
    s.confirmRoll('RAW_QC', roll('b'));
    s.confirmRoll('RAW_QC', roll('a'));
    expect(useSessionEntriesStore.getState().buckets.RAW_QC.rolls.map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('kovalar bölüm-başına ayrı; clearAll hepsini boşaltır (logout)', () => {
    const s = useSessionEntriesStore.getState();
    s.confirmRoll('RAW_QC', roll('a'));
    s.confirmRoll('TAMBUR', roll('t'));
    expect(Object.keys(useSessionEntriesStore.getState().buckets).sort()).toEqual([
      'RAW_QC',
      'TAMBUR',
    ]);
    s.clearAll();
    expect(useSessionEntriesStore.getState().buckets).toEqual({});
  });

  it('liste 200 kayıtla sınırlı (en eskiler düşer)', () => {
    const s = useSessionEntriesStore.getState();
    for (let i = 0; i < 205; i++) s.confirmRoll('RAW_QC', roll(String(i)));
    const b = useSessionEntriesStore.getState().buckets.RAW_QC;
    expect(b.rolls).toHaveLength(200);
    expect(b.rolls[0].id).toBe('204'); // en yeni başta
  });
});

describe('sessionBucketKey — istasyon kimliği kovaları ayırır (2026-08-12)', () => {
  it('⭐ iki ham giriş istasyonunun kayıtları AYRI kovalarda', () => {
    // Eski anahtar yalnız türdü ('RAW_QC') — ikinci istasyon açıldığında iki
    // istasyonun listeleri tek kovaya karışırdı.
    const k1 = sessionBucketKey('RAW_QC', 'st-1');
    const k2 = sessionBucketKey('RAW_QC', 'st-2');
    expect(k1).not.toBe(k2);
    const s = useSessionEntriesStore.getState();
    s.addPending(k1);
    s.addPending(k2);
    s.addPending(k2);
    const b = useSessionEntriesStore.getState().buckets;
    expect(b[k1]?.pending).toBe(1);
    expect(b[k2]?.pending).toBe(2);
  });

  it('istasyon kimliği yoksa tür tek başına — bugünkü davranış birebir', () => {
    expect(sessionBucketKey('RAW_QC', null)).toBe('RAW_QC');
    expect(sessionBucketKey('RAW_QC', undefined)).toBe('RAW_QC');
  });
});
