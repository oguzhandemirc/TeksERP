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

const TPL = { code: 'u-g', name: 'Güleçsoy' };

describe('taughtRow', () => {
  it('⭐ form alanları + metre (doğrulanmış) + aday listesindeki parti no + müşteri; runKey sabit (okuma izlemi baştan başlamaz), taught.seq artar', () => {
    const r = taughtRow(row(), { hedefMetraj: '1.200', en: ' 160 ', desen: 'Kar', renk: '', toplamMetre: '2.618,5', partiNo: 'P2618733', not: null }, 'c1', TPL);
    expect(r.runKey).toBe(3);
    expect(r.taught).toEqual({ seq: 1, code: 'u-g', name: 'Güleçsoy' });
    expect(r.detail!.formFields).toEqual({ en: '160', renkText: 'Mavi', hedefMetraj: '1.200', desenText: 'Kar' });
    expect(r.form).toMatchObject({ meters: 2618.5, metersReview: false, ourBatchNo: 'P2618733', ourBatchNoKey: 'hamPartiNo', ownerCustomerId: 'c1', ownerSuggested: null });
  });

  it('aday listesinde olmayan parti no yazılmaz; müşteri eşleşmesi yoksa sahip ve öneri korunur; metre okunamazsa dokunulmaz', () => {
    const r = taughtRow(row(), { partiNo: 'UYDURMA', toplamMetre: 'abc' }, null, TPL);
    expect(r.form).toMatchObject({ ourBatchNo: null, ownerCustomerId: null, ownerSuggested: 'Eski öneri', meters: 100, metersReview: true });
    expect(taughtRow(r, {}, null, TPL).taught?.seq).toBe(2);
  });

  it('anahtarsız aday: parti no yazılır, anahtar null', () => {
    expect(taughtRow(row(), { partiNo: 'X1' }, null, TPL).form).toMatchObject({ ourBatchNo: 'X1', ourBatchNoKey: null });
  });

  it('sonuçlanmış (İE açıldı / taslak) ya da detaysız satır aynen döner', () => {
    const opened = row({ result: { kind: 'OPENED' } as never });
    expect(taughtRow(opened, { en: '1' }, 'c1', TPL)).toBe(opened);
    const draft = row({ result: { kind: 'DRAFT' } as never });
    expect(taughtRow(draft, { en: '1' }, 'c1', TPL)).toBe(draft);
    const bare = row({ detail: null });
    expect(taughtRow(bare, { en: '1' }, 'c1', TPL)).toBe(bare);
  });

  it('formu henüz kurulmamış satırda yalnız belge alanları dolar', () => {
    const r = taughtRow(row({ form: null }), { renk: 'Kırmızı', partiNo: 'P2618733' }, 'c1', TPL);
    expect(r.form).toBeNull();
    expect(r.detail!.formFields).toMatchObject({ renkText: 'Kırmızı' });
  });
});

describe('taughtRow — müşteri parti no (istek 2)', () => {
  it('⭐ tanıtılan parti no aday listesinde olmasa da müşteri parti no olarak dolar (vurgulu)', () => {
    const r = taughtRow(row(), { partiNo: ' 2008-58 ' }, null, TPL);
    expect(r.form).toMatchObject({ customerBatchNo: '2008-58', customerBatchNoFromDoc: true, ourBatchNo: null });
  });
  it('kullanıcı elle düzelttiyse tanıtma ezmez', () => {
    const r = taughtRow(row({ form: { ...FORM, customerBatchNo: 'EL', customerBatchNoEdited: true } }), { partiNo: '2008-58' }, null, TPL);
    expect(r.form).toMatchObject({ customerBatchNo: 'EL' });
  });
});
