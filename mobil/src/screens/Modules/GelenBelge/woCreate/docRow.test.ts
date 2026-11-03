// K30-A: tanıtma sonrası sunucu yeniden okuyamazsa (409 satırlı taslak) önizleme değerleri satıra saf olarak dolar.
import { taughtRow, type DocRow } from './docRow';
import type { RowForm } from './woFromDoc';

const FORM: RowForm = {
  ownerCustomerId: null, ownerSuggested: 'Eski öneri', ownerAsk: null, ourBatchNo: null, ourBatchNoKey: null,
  meters: 100, metersReview: true, gramajValueId: null,
};
const row = (over: Partial<DocRow> = {}): DocRow => ({
  noteId: 'n1', noteNo: 'GB-1', runKey: 3, gramajTouched: false, result: null, form: FORM,
  detail: {
    id: 'n1', formFields: { en: 150, renkText: 'Mavi' },
    batchNoCandidates: [{ key: 'hamPartiNo', value: 'P2618733' }, { value: 'X1' }],
  } as never,
  ...over,
});

describe('taughtRow', () => {
  it('⭐ form alanları + metre (doğrulanmış) + aday listesindeki parti no + müşteri; runKey artar', () => {
    const r = taughtRow(row(), { hedefMetraj: '1.200', en: ' 160 ', desen: 'Kar', renk: '', toplamMetre: '2.618,5', partiNo: 'P2618733', not: null }, 'c1');
    expect(r.runKey).toBe(4);
    expect(r.detail!.formFields).toEqual({ en: '160', renkText: 'Mavi', hedefMetraj: '1.200', desenText: 'Kar' });
    expect(r.form).toMatchObject({ meters: 2618.5, metersReview: false, ourBatchNo: 'P2618733', ourBatchNoKey: 'hamPartiNo', ownerCustomerId: 'c1', ownerSuggested: null });
  });

  it('aday listesinde olmayan parti no yazılmaz; müşteri eşleşmesi yoksa sahip ve öneri korunur; metre okunamazsa dokunulmaz', () => {
    const r = taughtRow(row(), { partiNo: 'UYDURMA', toplamMetre: 'abc' }, null);
    expect(r.form).toMatchObject({ ourBatchNo: null, ownerCustomerId: null, ownerSuggested: 'Eski öneri', meters: 100, metersReview: true });
    expect(r.runKey).toBe(4);
  });

  it('anahtarsız aday: parti no yazılır, anahtar null', () => {
    expect(taughtRow(row(), { partiNo: 'X1' }, null).form).toMatchObject({ ourBatchNo: 'X1', ourBatchNoKey: null });
  });

  it('sonuçlanmış (İE açıldı / taslak) ya da detaysız satır aynen döner', () => {
    const opened = row({ result: { kind: 'OPENED' } as never });
    expect(taughtRow(opened, { en: '1' }, 'c1')).toBe(opened);
    const draft = row({ result: { kind: 'DRAFT' } as never });
    expect(taughtRow(draft, { en: '1' }, 'c1')).toBe(draft);
    const bare = row({ detail: null });
    expect(taughtRow(bare, { en: '1' }, 'c1')).toBe(bare);
  });

  it('formu henüz kurulmamış satırda yalnız belge alanları dolar', () => {
    const r = taughtRow(row({ form: null }), { renk: 'Kırmızı', partiNo: 'P2618733' }, 'c1');
    expect(r.form).toBeNull();
    expect(r.detail!.formFields).toMatchObject({ renkText: 'Kırmızı' });
  });
});
