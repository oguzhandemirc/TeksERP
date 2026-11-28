// Devere kabul D3 gövde seçicisi (panel `ReceiveBodyCell.test.tsx` aynası): farklı gövde işareti, alınmış gövde süzgeci, ipucu.
import type { ReceiveBodyOption, ReceiveBodyOptions } from '../../../services/devereKabul.service';
import { availableOptions, bodyFromOption, isDifferentBody, optionHint, sentBodiesText, takenBodyIds } from './bodyOptions';
import type { OrderDraft } from './receiveDocPayload';

const opt = (p: Partial<ReceiveBodyOption> & { id: string; bodyNo: string }): ReceiveBodyOption => ({
  owner: { kind: 'OURS', label: 'Bizim', customer: null },
  sentWith: null,
  statusSince: '2026-11-01T00:00:00.000Z',
  statusAgeDays: 12,
  sentWithOrder: false,
  ...p,
});

const choices: ReceiveBodyOptions = {
  subcontractorId: 's1',
  sent: [{ id: 'b1', bodyNo: 'LG-1', status: 'AT_SUBCONTRACTOR', statusLabel: 'Deverecide', atThisWarper: true, dispatchNo: 'GS-1' }],
  options: [
    opt({ id: 'b1', bodyNo: 'LG-1', sentWithOrder: true }),
    opt({ id: 'b2', bodyNo: 'LG-2', sentWith: { dispatchId: 'd2', dispatchNo: 'GS-2', warpingOrderId: 'o2', orderNo: 'DV-7', at: '2026-11-01T00:00:00.000Z' } }),
    opt({ id: 'b3', bodyNo: 'LG-3', owner: { kind: 'CUSTOMER', label: 'Müşteri', customer: { id: 'c1', code: 'C1', name: 'Akın Tekstil' } } }),
  ],
};

describe('bodyOptions (D3)', () => {
  it('farklı gövde: gönderilen dışında seçilen ve yerinde tanım işaretlenir; gönderilen işaretlenmez', () => {
    expect(isDifferentBody({ kind: 'existing', id: 'b1', bodyNo: 'LG-1', hint: '' }, choices)).toBe(false);
    expect(isDifferentBody({ kind: 'existing', id: 'b2', bodyNo: 'LG-2', hint: '' }, choices)).toBe(true);
    expect(isDifferentBody({ kind: 'new', bodyNo: 'LG-9', ownerKind: 'OURS' }, choices)).toBe(true);
  });

  it('gövde hiç gönderilmediyse, gövdesiz satırda ya da seçenek gelmediyse (eski sunucu) rozet yok', () => {
    expect(isDifferentBody({ kind: 'existing', id: 'b2', bodyNo: 'LG-2', hint: '' }, { ...choices, sent: [] })).toBe(false);
    expect(isDifferentBody(null, choices)).toBe(false);
    expect(isDifferentBody({ kind: 'existing', id: 'b2', bodyNo: 'LG-2', hint: '' }, undefined)).toBe(false);
  });

  it('taslağın herhangi bir siparişinde seçilmiş gövde listeden düşer', () => {
    const orders: OrderDraft[] = [
      { orderId: 'o1', orderNo: 'DV-1', beams: [{ key: 'k1', body: { kind: 'existing', id: 'b2', bodyNo: 'LG-2', hint: '' }, physicalBeamNo: '', lengthM: '1', grossKg: '', tareKg: '' }] },
      { orderId: 'o3', orderNo: 'DV-3', beams: [{ key: 'k2', body: { kind: 'new', bodyNo: 'LG-3', ownerKind: 'OURS' }, physicalBeamNo: '', lengthM: '1', grossKg: '', tareKg: '' }] },
    ];
    expect(availableOptions(choices, takenBodyIds(orders)).map((o) => o.id)).toEqual(['b1', 'b3']);
    expect(availableOptions(undefined, new Set())).toEqual([]);
  });

  it('ipucu: nereden geldi + bizim değilse sahip; seçim kayıtlı gövde taslağı olur', () => {
    expect(optionHint(choices.options[0])).toBe('bu siparişle gönderildi');
    expect(optionHint(choices.options[1])).toBe('DV-7 ile gönderildi');
    expect(optionHint(choices.options[2])).toBe('12 gündür deverecide · Akın Tekstil');
    expect(bodyFromOption(choices.options[0])).toEqual({ kind: 'existing', id: 'b1', bodyNo: 'LG-1', hint: 'bu siparişle gönderildi' });
    expect(sentBodiesText(choices)).toBe('LG-1');
  });
});
