import { addCode, firstTab, fixBody, heroFigure, linesFor, scopeFromKey, scopeOptions, tabCounts } from './beamBodyCount';
import type { CountLine, CountPreview } from '../../../services/beamBodyCount.service';

const line = (id: string, extra: Partial<CountLine> = {}): CountLine => ({ id, bodyNo: `LG-${id}`, status: 'EMPTY_STOCK', statusLabel: 'Depoda boş', placeLabel: 'Merkez', suggestion: null, ...extra });
const preview = (p: Partial<CountPreview> = {}): CountPreview => ({
  scope: { kind: 'WAREHOUSE', id: null, label: 'Bütün depolar' }, expectedCount: 2, matched: [], missing: [], unexpected: [], unknown: [], ...p,
});

describe('beamBodyCount — saf mantık', () => {
  it('addCode: kırpar, harf farkı tekrarını ve boşu almaz', () => {
    const a = addCode([], ' LG-1 ');
    expect(a).toEqual({ codes: ['LG-1'], added: true });
    expect(addCode(a.codes, 'lg-1').added).toBe(false);
    expect(addCode(a.codes, '   ').added).toBe(false);
    expect(addCode(a.codes, 'LG-2').codes).toEqual(['LG-1', 'LG-2']);
  });

  it('kapsam: seçenekler + anahtar → sunucu kapsamı', () => {
    const opts = scopeOptions({ warehouses: [{ id: 'w1', name: 'Merkez', expectedCount: 3 }], subcontractors: [{ id: 's1', name: 'Devereci A', expectedCount: 2 }], stockTotal: 4 });
    expect(opts.map((o) => o.value)).toEqual(['ALL', 'W:w1', 'S:s1']);
    expect(scopeOptions(undefined)).toEqual([]);
    expect(scopeFromKey('ALL')).toEqual({ warehouseId: null });
    expect(scopeFromKey('W:w1')).toEqual({ warehouseId: 'w1' });
    expect(scopeFromKey('S:s1')).toEqual({ subcontractorId: 's1' });
  });

  it('kahraman sayı: okunan/beklenen; fark yokken tamam', () => {
    expect(heroFigure(undefined).value).toBe('— / —');
    expect(heroFigure(preview({ matched: [line('1')], missing: [line('2')] }))).toMatchObject({ value: '1 / 2', done: false });
    expect(heroFigure(preview({ matched: [line('1'), line('2')] })).done).toBe(true);
    expect(heroFigure(preview({ matched: [line('1'), line('2')], unknown: [{ code: 'x', candidates: [] }] })).done).toBe(false);
  });

  it('sekmeler: sayılar + ilk sekme önce başka yerde, sonra tanımsız, sonra eksik', () => {
    const p = preview({ missing: [line('2')], unexpected: [line('3')] });
    expect(tabCounts(p)).toEqual({ missing: 1, unexpected: 1, unknown: 0, matched: 0 });
    expect(firstTab(p)).toBe('unexpected');
    expect(firstTab(preview({ missing: [line('2')], unknown: [{ code: 'x', candidates: [] }] }))).toBe('unknown');
    expect(firstTab(preview({ missing: [line('2')] }))).toBe('missing');
    expect(linesFor('unknown', p)).toEqual([]);
    expect(linesFor('missing', p).map((l) => l.id)).toEqual(['2']);
  });

  it('fixBody: öneriden elle geçiş gövdesi; öneri yoksa null', () => {
    expect(fixBody(line('1'))).toBeNull();
    expect(fixBody(line('1', { suggestion: { kind: 'RETURN_EMPTY', label: 'Boş döndü', warehouseId: 'w1', reason: 'sayım' } }))).toEqual({ kind: 'RETURN_EMPTY', warehouseId: 'w1', reason: 'sayım' });
    expect(fixBody(line('1', { suggestion: { kind: 'SHIP_EMPTY', label: 'Boş gönderildi', subcontractorId: 's1' } }))).toEqual({ kind: 'SHIP_EMPTY', subcontractorId: 's1' });
  });
});
