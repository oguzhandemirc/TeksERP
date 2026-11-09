// Kilitli değer okumayı ezer (operatör değeri): form alanları, gelen metre, müşteri parti no; kilitsiz detay aynen döner;
// fotoğraf → not bağı gönderimde kurulur.
import type { InboundNoteDetail } from '../../../../services/inboundDoc.service';
import { initialRowForm } from '../woCreate/woFromDoc';
import { applyLiveLocks, bindLiveLocks, isLiveInfoOnly, liveConflictsOf, liveConflictText, liveFormLocked, liveLocksFor, liveUserKeysFor, rememberLiveLocks, resetLiveLocks } from './liveLocks';

const detail = (over: Partial<InboundNoteDetail> = {}): InboundNoteDetail => ({
  id: 'n1',
  noteNo: 'GB-1',
  status: 'DRAFT',
  ownerCustomerId: null,
  kursunMeters: 980,
  kursunMetersReview: true,
  customerBatchNo: 'OKUNAN',
  formFields: { en: '150', desenText: 'Saten', renkText: 'Mavi', hedefMetraj: '900', not: null },
  suggestions: { targetItem: { id: 'i1', name: 'Saten' }, targetColor: { id: 'c1', name: 'Mavi' } },
  ...over,
});

beforeEach(resetLiveLocks);

describe('applyLiveLocks', () => {
  it('⭐ fotoğraf okuması boş alanlara kilit yazılır; aynı değer çelişki değildir; kilitsiz alan okunduğu gibi kalır', () => {
    const d = applyLiveLocks(detail({ kursunMeters: null, customerBatchNo: null }), { en: '150', hedefKg: '75', not: 'acil', toplamMetre: '1.234,5', partiNo: 'P-77' });
    expect(d.formFields).toEqual({ en: '150', desenText: 'Saten', renkText: 'Mavi', hedefMetraj: '900', hedefKg: '75', not: 'acil' });
    expect(d.kursunMeters).toBe(1234.5);
    expect(d.kursunMetersReview).toBe(false);
    expect(d.customerBatchNo).toBe('P-77');
    expect(liveConflictsOf(d)).toEqual([]);
    const form = initialRowForm(d);
    expect(form).toMatchObject({ meters: 1234.5, metersReview: false, customerBatchNo: 'P-77' });
    // Sayısal alan sayı olarak karşılaştırılır: 1.250 = 1250; metin harf büyüklüğü yok sayılır.
    expect(liveConflictsOf(applyLiveLocks(detail({ formFields: { hedefMetraj: 1250, desenText: 'saten' } }), { hedefMetraj: '1.250', desen: 'SATEN' }))).toEqual([]);
  });

  it('D ⭐ çelişki: oy kilidinde fotoğraf okuması seçilir, iki değer de "Kontrol edin" kaydında', () => {
    const d = applyLiveLocks(detail(), { en: '160', desen: 'TARİH-X', toplamMetre: '1.000', partiNo: 'P-77' });
    expect(d.formFields?.en).toBe('150');
    expect(d.formFields?.desenText).toBe('Saten');
    expect(d.suggestions?.targetItem).toEqual({ id: 'i1', name: 'Saten' }); // fotoğraf kazandı → öneri kalır
    expect(d.kursunMeters).toBe(980);
    expect(d.kursunMetersReview).toBe(true);
    expect(d.customerBatchNo).toBe('OKUNAN');
    const c = liveConflictsOf(d);
    expect(c.map((x) => [x.key, x.live, x.photo, x.chosen])).toEqual([
      ['en', '160', '150', 'photo'], ['desen', 'TARİH-X', 'Saten', 'photo'], ['toplamMetre', '1.000', '980', 'photo'], ['partiNo', 'P-77', 'OKUNAN', 'photo'],
    ]);
    expect(liveConflictText(c[0])).toBe('Kontrol edin — En: fotoğraf "150", canlı okuma "160" (fotoğraftaki seçildi).');
    expect(initialRowForm(d)).toMatchObject({ meters: 980, metersReview: true });
  });

  it('D ⭐ çelişki: elle kilitte kilit seçilir (yine "Kontrol edin" kaydı + metre doğrulaması)', () => {
    const d = applyLiveLocks(detail(), { en: '160', toplamMetre: '1.000' }, ['en', 'toplamMetre']);
    expect(d.formFields?.en).toBe('160');
    expect(d.kursunMeters).toBe(1000);
    expect(d.kursunMetersReview).toBe(true);
    expect(liveConflictsOf(d).map((x) => [x.key, x.chosen])).toEqual([['en', 'live'], ['toplamMetre', 'live']]);
  });

  it('kilitli desen/renk forma girip farklıysa o okumanın katalog önerisi düşer; aynıysa kalır', () => {
    const d = applyLiveLocks(detail(), { desen: 'Kadife', renk: 'Mavi' }, ['desen']);
    expect(d.formFields?.desenText).toBe('Kadife');
    expect(d.suggestions).toEqual({ targetItem: null, targetColor: { id: 'c1', name: 'Mavi' } });
  });

  it('kilit yok / boş → detay aynen; okunamayan metre ezmez; musteri dokunulmaz', () => {
    const base = detail();
    expect(applyLiveLocks(base, null)).toBe(base);
    expect(applyLiveLocks(base, {})).toBe(base);
    const d = applyLiveLocks(base, { toplamMetre: 'yok', musteri: 'Acme', en: '  ' });
    expect(d.kursunMeters).toBe(980);
    expect(d.ownerCustomerId).toBeNull();
    expect(d.formFields).toEqual(base.formFields);
  });

  it('formFields hiç yokken de kurulur', () => {
    expect(applyLiveLocks(detail({ formFields: null }), { hedefMetraj: '500' }).formFields).toEqual({ hedefMetraj: '500' });
  });
});

describe('kilit deposu', () => {
  it('fotoğraf sha → not bağı; bağlanmayan fotoğrafın kilidi nota gitmez', () => {
    rememberLiveLocks('sha-a', { en: '160' });
    rememberLiveLocks('sha-x', { en: '999' });
    expect(liveLocksFor('n1')).toBeNull();
    bindLiveLocks('n1', ['sha-a', 'sha-b']);
    expect(liveLocksFor('n1')).toEqual({ en: '160' });
    bindLiveLocks('n1', ['sha-a']);
    expect(liveLocksFor('n1')).toEqual({ en: '160' });
  });

  it('elle kilit anahtarları fotoğraftan nota taşınır; sonraki fotoğraf ezdiği anahtarın bilgisini yeniler', () => {
    rememberLiveLocks('sha-1', { en: '160', not: 'x' }, ['en']);
    bindLiveLocks('n3', ['sha-1']);
    expect(liveUserKeysFor('n3')).toEqual(['en']);
    rememberLiveLocks('sha-2', { en: '170' }, []);
    bindLiveLocks('n3', ['sha-2']);
    expect(liveUserKeysFor('n3')).toEqual([]);
    expect(liveUserKeysFor('yok')).toEqual([]);
  });

  it('boş kilit kaydedilmez', () => {
    rememberLiveLocks('sha-e', {});
    bindLiveLocks('n2', ['sha-e']);
    expect(liveLocksFor('n2')).toBeNull();
  });
});

describe('liveFormLocked — otomatik çekim koşulu', () => {
  const lock = { value: 'x', by: 'vote' as const };
  it('⭐ müşteri yalnız bilgi: kilitsiz müşteri otomatik çekimi bekletmez', () => {
    expect(isLiveInfoOnly('musteri')).toBe(true);
    expect(liveFormLocked([{ key: 'musteri', lock: null }, { key: 'hedefMetraj', lock }])).toBe(true);
  });
  it('B ⭐ "Belgede yok" alan (son 5 yanıt boş) tamam sayılır; 5ten az boş yanıt sayılmaz', () => {
    const none = [null, null, null, null, null];
    expect(liveFormLocked([{ key: 'cins', lock: null, history: none }, { key: 'hedefMetraj', lock }])).toBe(true);
    expect(liveFormLocked([{ key: 'cins', lock: null, history: none.slice(1) }, { key: 'hedefMetraj', lock }])).toBe(false);
    expect(liveFormLocked([{ key: 'cins', lock: null, history: [...none.slice(1), 'a'] }, { key: 'hedefMetraj', lock }])).toBe(false);
  });
  it('kilitsiz form alanı ya da yalnız bilgi alanı → hayır', () => {
    expect(liveFormLocked([{ key: 'en', lock: null }, { key: 'hedefMetraj', lock }])).toBe(false);
    expect(liveFormLocked([{ key: 'musteri', lock }])).toBe(false);
    expect(liveFormLocked([])).toBe(false);
  });
});
