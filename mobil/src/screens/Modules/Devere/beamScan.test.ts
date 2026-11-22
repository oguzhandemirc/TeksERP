// =============================================================================
// beamScan — levent tak okutma çözücüsü (S3c)
// =============================================================================
import type { WarpBeam } from '../../../services/warpBeam.service';
import { mountScanOutcome, resolveMountScan, slotNeedsInput } from './beamScan';

function beam(id: string, over: Partial<WarpBeam> = {}): WarpBeam {
  return { id, beamNo: `LV261021-000${id}`, status: 'READY', physicalBeamNo: null, remainingM: 900, ...over } as WarpBeam;
}
const machines = [
  { id: 'm7', code: 'T-07', name: 'Tezgah 7' },
  { id: 'm8', code: 'T-08', name: 'Tezgah 8' },
];
const beams = [beam('1'), beam('2', { physicalBeamNo: 'G-12' }), beam('3', { status: 'MOUNTED', currentMachine: { id: 'm8', code: 'T-08', name: 'Tezgah 8' }, currentPosition: 1 }), beam('4', { status: 'EXHAUSTED' })];

describe('resolveMountScan', () => {
  it('⭐ levent etiketi (beamNo) büyük/küçük harf duyarsız → hazır levent', () => {
    const r = resolveMountScan(' lv261021-0001 ', beams, machines);
    expect(r).toMatchObject({ kind: 'beam', beam: { id: '1' } });
  });

  it('gövde no (physicalBeamNo) da leventi bulur', () => {
    expect(resolveMountScan('g-12', beams, machines)).toMatchObject({ kind: 'beam', beam: { id: '2' } });
  });

  it('⭐ tezgah etiketi (makine kodu) → makine', () => {
    expect(resolveMountScan('t-07', beams, machines)).toMatchObject({ kind: 'machine', machine: { id: 'm7' } });
  });

  it('takılı / bitmiş levent → ret metniyle', () => {
    const m = resolveMountScan('LV261021-0003', beams, machines);
    expect(m).toMatchObject({ kind: 'beam-blocked' });
    expect(m.kind === 'beam-blocked' && m.message).toMatch(/zaten takılı \(T-08 yuva 1\)/);
    const e = resolveMountScan('LV261021-0004', beams, machines);
    expect(e.kind === 'beam-blocked' && e.message).toMatch(/Bitti/);
  });

  it('bilinmeyen kod uydurulmaz; boş kod boş', () => {
    expect(resolveMountScan('XYZ', beams, machines)).toEqual({ kind: 'unknown', code: 'XYZ' });
    expect(resolveMountScan('  ', beams, machines)).toEqual({ kind: 'empty' });
  });
});

describe('resolveMountScan esnek gövde no (S3)', () => {
  const pool = [beam('5', { physicalBeamNo: 'LG-0012' }), beam('6', { beamBody: { id: 'b6', bodyNo: 'LG-0034' } }), beam('7', { physicalBeamNo: 'MX-34' })];

  it('⭐ ayar kapalı → "012" bulunmaz (bugünkü birebir)', () => {
    expect(resolveMountScan('012', pool, machines)).toEqual({ kind: 'unknown', code: '012' });
    expect(resolveMountScan('lg 12', pool, machines, { looseBodyNo: false }).kind).toBe('unknown');
  });

  it('⭐ ayar açık + tek aday → levent (physicalBeamNo ya da gövde no)', () => {
    expect(resolveMountScan('012', pool, machines, { looseBodyNo: true })).toMatchObject({ kind: 'beam', beam: { id: '5' } });
    expect(resolveMountScan('lg 34', pool, machines, { looseBodyNo: true })).toMatchObject({ kind: 'beam', beam: { id: '6' } });
  });

  it('⭐ iki aday → ambiguous, ret metni adayları sayar', () => {
    const r = resolveMountScan('34', pool, machines, { looseBodyNo: true });
    expect(r).toEqual({ kind: 'ambiguous', code: '34', beamNos: ['LV261021-0006', 'LV261021-0007'] });
    expect(mountScanOutcome(r, 'beam')).toEqual({ ok: false, message: '34 birden çok levente uyuyor (LV261021-0006, LV261021-0007) — levent etiketini okutun.' });
  });

  it('birebir eşleşme esnekten önce gelir', () => {
    expect(resolveMountScan('MX-34', pool, machines, { looseBodyNo: true })).toMatchObject({ kind: 'beam', beam: { id: '7' } });
  });
});

describe('mountScanOutcome adım kuralı', () => {
  it('⭐ levent adımında tezgah etiketi ret; tezgah adımında levent etiketi ret', () => {
    expect(mountScanOutcome(resolveMountScan('T-07', beams, machines), 'beam')).toEqual({ ok: false, message: 'Bu tezgah etiketi — önce leventin etiketini okutun.' });
    expect(mountScanOutcome(resolveMountScan('LV261021-0001', beams, machines), 'machine').ok).toBe(false);
    expect(mountScanOutcome(resolveMountScan('LV261021-0001', beams, machines), 'beam')).toEqual({ ok: true });
    expect(mountScanOutcome(resolveMountScan('T-07', beams, machines), 'machine')).toEqual({ ok: true });
  });

  it('yuva sorusu yalnız çok yuvalıda', () => {
    expect(slotNeedsInput(1)).toBe(false);
    expect(slotNeedsInput(null)).toBe(false);
    expect(slotNeedsInput(2)).toBe(true);
  });
});
