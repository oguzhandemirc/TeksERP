// Negatif sonda (2026-09-26): `slotAfterFailure` belirsiz hatada da düşürünce anahtar testi kırmızı.
import { addBatchOutcome, addBatchPreview, serverRejects, slotAfterFailure, tokenFor } from './addBatch';
import type { Roll } from '../../../types/models';

const roll = (over: Partial<Roll> & { sackId?: string | null } = {}) =>
  ({ id: 'r1', barcode: 'B-1', itemId: 'i1', status: 'STOCK', currentQty: 100, width: 180, ...over }) as Roll & { sackId?: string | null };

describe('Parti Ekle — saf kurallar', () => {
  it('stok ve depo topu girer; aynı top ikinci kez girmez', () => {
    expect(addBatchOutcome([], roll(), 'i1')).toEqual({ kind: 'added', roll: { id: 'r1', barcode: 'B-1', qty: 100, width: 180 } });
    expect(addBatchOutcome([], roll({ status: 'A1_STOCK' }), 'i1').kind).toBe('added');
    expect(addBatchOutcome([{ id: 'r1', barcode: 'B-1', qty: 100 }], roll(), 'i1')).toEqual({ kind: 'duplicate' });
  });

  it('farklı kumaş, üretimdeki, çuvaldaki ve iptal edilmiş top reddedilir', () => {
    expect(addBatchOutcome([], roll({ itemId: 'i2' }), 'i1')).toEqual({ kind: 'reject', reason: 'Farklı ürün' });
    expect(addBatchOutcome([], roll({ status: 'IN_PRODUCTION' }), 'i1').kind).toBe('reject');
    expect(addBatchOutcome([], roll({ sackId: 's1' }), 'i1').kind).toBe('reject');
    expect(addBatchOutcome([], roll({ status: 'CANCELLED' }), 'i1')).toEqual({ kind: 'reject', reason: 'İptal edilmiş top — önce iptali geri alın' });
  });

  it('önizleme: parti sayısı, metraj, ilk adım', () => {
    expect(addBatchPreview([{ id: 'a', barcode: 'A', qty: 1200 }, { id: 'b', barcode: 'B', qty: 40.4 }], 'Kurşun'))
      .toBe('Yeni parti açılacak · 2 top · 1.240 m · ilk adım: Kurşun');
    expect(addBatchPreview([{ id: 'a', barcode: 'A', qty: 10 }], null)).toBe('Yeni parti açılacak · 1 top · 10 m');
  });

  it('sunucu ret listesi satır satır; biçimsiz ayrıntı boş liste', () => {
    expect(serverRejects({ details: { rejects: [{ barcode: 'X', reason: 'Farklı kumaş' }, { barcode: 1 }] } })).toEqual([{ barcode: 'X', reason: 'Farklı kumaş' }]);
    expect(serverRejects(new Error('x'))).toEqual([]);
  });

  it('istek anahtarı: aynı küme aynı anahtar; küme değişince ya da kesin hatada yeni', () => {
    let n = 0;
    const fresh = () => `t${++n}`;
    const a = tokenFor(null, ['B', 'A'], fresh);
    expect(tokenFor(a, ['A', 'B'], fresh)).toBe(a);
    expect(tokenFor(a, ['A'], fresh).token).toBe('t2');
    expect(slotAfterFailure(a, { status: 503 })).toBe(a);
    expect(slotAfterFailure(a, new Error('ağ'))).toBe(a);
    expect(slotAfterFailure(a, { status: 400 })).toBeNull();
  });
});
