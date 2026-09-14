import { UNGROUPED, reconcileSelection, sacksInSelection, selectionName, shipButtonLabel } from './packingGroupSelection';

const havuz = [
  { id: 'a', packingGroupId: 'g1' },
  { id: 'b', packingGroupId: 'g1' },
  { id: 'c', packingGroupId: 'g2' },
  { id: 'd', packingGroupId: null },
  { id: 'e' }, // eski backend: alan yok
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join('');

describe('sacksInSelection — "Hemen Sevk Et" kümesi grup seçimine göre süzülür', () => {
  it('bayrak KAPALI → girdi AYNEN (aynı referans) — bugünkü davranış, seçim olsa bile', () => {
    expect(sacksInSelection(havuz, { kind: 'GROUP', id: 'g1' }, false)).toBe(havuz);
    expect(sacksInSelection(havuz, UNGROUPED, false)).toBe(havuz);
  });
  it('bayrak açık, seçim YOK → havuzun tamamı (aynı referans)', () => {
    expect(sacksInSelection(havuz, null, true)).toBe(havuz);
  });
  it('grup seçili → yalnız o grubun çuvalları', () => {
    expect(ids(sacksInSelection(havuz, { kind: 'GROUP', id: 'g1' }, true))).toBe('ab');
    expect(ids(sacksInSelection(havuz, { kind: 'GROUP', id: 'g2' }, true))).toBe('c');
  });
  it('"Gruplanmamış" → null VE alanı olmayan (eski backend) çuvallar', () => {
    expect(ids(sacksInSelection(havuz, UNGROUPED, true))).toBe('de');
  });
  it('canlı listede olmayan grup seçilirse boş küme (havuzun tamamına DÜŞMEZ)', () => {
    expect(sacksInSelection(havuz, { kind: 'GROUP', id: 'yok' }, true)).toEqual([]);
  });
});

describe('reconcileSelection — seçili grup canlıdan düşünce seçim sıfırlanır', () => {
  it('grup hâlâ canlı → seçim kalır', () => {
    const sel = { kind: 'GROUP', id: 'g1' } as const;
    expect(reconcileSelection(sel, new Set(['g1', 'g2']))).toBe(sel);
  });
  it('grup düştü → null (havuzun tamamı)', () => {
    expect(reconcileSelection({ kind: 'GROUP', id: 'g9' }, new Set(['g1']))).toBeNull();
  });
  it('"Gruplanmamış" ve null seçim canlı listeden bağımsız', () => {
    expect(reconcileSelection(UNGROUPED, new Set())).toBe(UNGROUPED);
    expect(reconcileSelection(null, new Set())).toBeNull();
  });
});

describe('shipButtonLabel / selectionName — operatör NEYİ sevk ettiğini görür', () => {
  const groups = [{ id: 'g1', name: '1. Grup' }];
  it('seçim yok → bugünkü etiket birebir', () => {
    expect(shipButtonLabel({ confirmationEnabled: false, count: 3, selectionName: null })).toBe('Hemen Sevk Et (3)');
    expect(shipButtonLabel({ confirmationEnabled: true, count: 0, selectionName: null })).toBe('Sevkiyat Kur');
  });
  it('grup seçili → ad etikette', () => {
    expect(shipButtonLabel({ confirmationEnabled: false, count: 2, selectionName: selectionName({ kind: 'GROUP', id: 'g1' }, groups) })).toBe('Hemen Sevk Et · 1. Grup (2)');
    expect(selectionName(UNGROUPED, groups)).toBe('Gruplanmamış');
    expect(selectionName({ kind: 'GROUP', id: 'yok' }, groups)).toBeNull();
  });
});
