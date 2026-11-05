// Kilitli değer okumayı ezer (operatör değeri): form alanları, gelen metre, müşteri parti no; kilitsiz detay aynen döner;
// fotoğraf → not bağı gönderimde kurulur.
import type { InboundNoteDetail } from '../../../../services/inboundDoc.service';
import { initialRowForm } from '../woCreate/woFromDoc';
import { applyLiveLocks, bindLiveLocks, isLiveInfoOnly, liveFormLocked, liveLocksFor, rememberLiveLocks, resetLiveLocks } from './liveLocks';

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
  it('⭐ kilitli değer okumayı ezer; kilitsiz alan okunduğu gibi kalır', () => {
    const d = applyLiveLocks(detail(), { en: '160', hedefKg: '75', not: 'acil', toplamMetre: '1.234,5', partiNo: 'P-77' });
    expect(d.formFields).toEqual({ en: '160', desenText: 'Saten', renkText: 'Mavi', hedefMetraj: '900', hedefKg: '75', not: 'acil' });
    expect(d.kursunMeters).toBe(1234.5);
    expect(d.kursunMetersReview).toBe(false);
    expect(d.customerBatchNo).toBe('P-77');
    const form = initialRowForm(d);
    expect(form).toMatchObject({ meters: 1234.5, metersReview: false, customerBatchNo: 'P-77' });
  });

  it('kilitli desen/renk farklıysa o okumanın katalog önerisi düşer; aynıysa kalır', () => {
    const d = applyLiveLocks(detail(), { desen: 'Kadife', renk: 'Mavi' });
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
  it('kilitsiz form alanı ya da yalnız bilgi alanı → hayır', () => {
    expect(liveFormLocked([{ key: 'en', lock: null }, { key: 'hedefMetraj', lock }])).toBe(false);
    expect(liveFormLocked([{ key: 'musteri', lock }])).toBe(false);
    expect(liveFormLocked([])).toBe(false);
  });
});
