import { beamLine, bodyFromResolve, buildDocBody, draftsHaveBody, inputText, nextPlanLength, parseNum, previewBeamName, progressText, validateBeam, type BeamDraft, type OrderDraft } from './receiveDocPayload';
import type { ResolvedBeamBody } from '../../../services/devereKabul.service';

const beam = (p: Partial<BeamDraft> = {}): BeamDraft => ({ key: 'k', body: null, physicalBeamNo: '', lengthM: '1200', grossKg: '', tareKg: '', ...p });
const order = (no: string, beams: BeamDraft[]): OrderDraft => ({ orderId: `id-${no}`, orderNo: no, beams });
const P = { subcontractorId: 's1', deliveryNoteNo: ' 4521 ', weighing: 'OPTIONAL' as const };
const body = (p: Partial<ResolvedBeamBody> = {}): ResolvedBeamBody => ({ id: 'b1', bodyNo: 'LG-00012', status: 'AT_SUBCONTRACTOR', statusLabel: 'Deverecide', isActive: true, owner: { kind: 'OURS', label: 'Bizim' }, currentWarpBeam: null, ...p });

describe('receiveDocPayload — devere dönüş kabulü (M1)', () => {
  it('sayı: virgül/nokta, boş → null', () => {
    expect(parseNum('1.200,5')).toBe(1200.5);
    expect(parseNum('1200.5')).toBe(1200.5);
    expect(parseNum(' ')).toBeNull();
    expect(parseNum('abc')).toBeNull();
    expect(inputText('1200.000')).toBe('1200');
    expect(inputText('512.500')).toBe('512,5');
  });

  it('plan boyu: alınan + taslak sırasındaki satır, taşarsa son boy', () => {
    const o = { beamLines: [{ beamCount: 2, beamLengthM: '1000.000' }, { beamCount: 1, beamLengthM: '800.000' }], receivedBeamCount: 1 };
    expect(nextPlanLength(o, 0)).toBe('1000');
    expect(nextPlanLength(o, 1)).toBe('800');
    expect(nextPlanLength(o, 5)).toBe('800');
    expect(nextPlanLength({ beamLines: [], receivedBeamCount: 0 }, 0)).toBe('');
  });

  it('gövde çözümü: tanımsız → yeni (Bizim), boş → bağla, dolu/pasif → ret metni', () => {
    expect(bodyFromResolve(' YD-22 ', null)).toEqual({ kind: 'new', bodyNo: 'YD-22', ownerKind: 'OURS' });
    expect(bodyFromResolve('x', body())).toEqual({ kind: 'existing', id: 'b1', bodyNo: 'LG-00012', hint: 'Bizim' });
    expect(bodyFromResolve('x', body({ status: 'EMPTY_STOCK' }))).toMatchObject({ kind: 'existing' });
    expect(typeof bodyFromResolve('x', body({ status: 'FULL_STOCK', statusLabel: 'Dolu', currentWarpBeam: { id: 'w', beamNo: 'LV1', status: 'READY' } }))).toBe('string');
    expect(typeof bodyFromResolve('x', body({ isActive: false }))).toBe('string');
  });

  it('tartı kipi: OFF kg göndermez; REQUIRED brüt ister; dara < brüt', () => {
    expect(beamLine(beam({ grossKg: '182', tareKg: '40' }), 'OFF', 's1')).toEqual({ lengthM: 1200, physicalBeamNo: null });
    expect(validateBeam(beam(), 'REQUIRED')).toMatch(/Brüt kg/);
    expect(validateBeam(beam({ grossKg: '182' }), 'REQUIRED')).toBeNull();
    expect(validateBeam(beam({ tareKg: '40' }), 'OPTIONAL')).toMatch(/brüt kg da/);
    expect(validateBeam(beam({ grossKg: '40', tareKg: '40' }), 'OPTIONAL')).toMatch(/küçük/);
    expect(validateBeam(beam({ lengthM: '0' }), 'OFF')).toMatch(/Metre/);
    expect(beamLine(beam({ grossKg: '182,25' }), 'OPTIONAL', 's1')).toEqual({ lengthM: 1200, grossKg: 182.25, tareKg: null, physicalBeamNo: null });
  });

  it('gövde alanı: kayıtlı → beamBodyId; yeni WARPER → seçili devereci; metin no yalnız gövdesizde', () => {
    expect(beamLine(beam({ body: { kind: 'existing', id: 'b1', bodyNo: 'LG', hint: '' }, physicalBeamNo: 'X' }), 'OFF', 's1')).toEqual({ lengthM: 1200, beamBodyId: 'b1' });
    expect(beamLine(beam({ body: { kind: 'new', bodyNo: 'YD-22', ownerKind: 'WARPER' } }), 'OFF', 's1').newBody).toEqual({ bodyNo: 'YD-22', owner: { kind: 'WARPER', subcontractorId: 's1' } });
    expect(beamLine(beam({ body: { kind: 'new', bodyNo: 'YD-22', ownerKind: 'OURS' } }), 'OFF', 's1').newBody?.owner).toEqual({ kind: 'OURS' });
    expect(beamLine(beam({ physicalBeamNo: ' L-12 ' }), 'OFF', 's1').physicalBeamNo).toBe('L-12');
  });

  it('belge: satırsız sipariş girmez, irsaliye kırpılır, toplam metre', () => {
    const r = buildDocBody([order('FDV-1', [beam(), beam({ lengthM: '800,5' })]), order('FDV-2', [])], P);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.deliveryNoteNo).toBe('4521');
    expect(r.body.orders).toHaveLength(1);
    expect(r.beamCount).toBe(2);
    expect(r.totalM).toBe(2000.5);
    expect(buildDocBody([order('FDV-1', [])], P)).toEqual({ ok: false, error: null });
  });

  it('hep-ya-hiç: hatalı satır belgeyi kurmaz (sipariş no + sıra önekli)', () => {
    const r = buildDocBody([order('FDV-1', [beam(), beam({ lengthM: '' })])], P);
    expect(r).toEqual({ ok: false, error: 'FDV-1 2. levent: Metre girin.' });
  });

  it('aynı gövde iki satırda / iki siparişte yasak (harf duyarsız)', () => {
    const a = beam({ body: { kind: 'new', bodyNo: 'yd-22', ownerKind: 'OURS' } });
    const b = beam({ physicalBeamNo: 'YD-22' });
    expect(buildDocBody([order('FDV-1', [a]), order('FDV-2', [b])], P)).toMatchObject({ ok: false, error: expect.stringMatching(/FDV-1 ve FDV-2/) });
    const e = beam({ body: { kind: 'existing', id: 'b1', bodyNo: 'LG', hint: '' } });
    expect(buildDocBody([order('FDV-1', [e, { ...e, key: 'k2' }])], P)).toMatchObject({ ok: false });
  });

  it('sınır: ≤50 levent', () => {
    const many = Array.from({ length: 51 }, (_, i) => beam({ key: String(i) }));
    expect(buildDocBody([order('FDV-1', many)], P)).toMatchObject({ ok: false, error: expect.stringMatching(/50 levent/) });
  });

  it('okutma mükerreri: kimlik ya da no (harf duyarsız)', () => {
    const os = [order('FDV-1', [beam({ body: { kind: 'existing', id: 'b1', bodyNo: 'LG-1', hint: '' } }), beam({ physicalBeamNo: 'yd-22' })])];
    expect(draftsHaveBody(os, { kind: 'existing', id: 'b1', bodyNo: 'X', hint: '' })).toBe(true);
    expect(draftsHaveBody(os, { kind: 'new', bodyNo: 'YD-22', ownerKind: 'OURS' })).toBe(true);
    expect(draftsHaveBody(os, { kind: 'new', bodyNo: 'YD-23', ownerKind: 'OURS' })).toBe(false);
  });

  it('ilerleme metni', () => {
    expect(progressText(3, 4)).toBe('3/4 levent');
    expect(progressText(2, null)).toBe('2 levent');
  });
});

describe('receiveDocPayload — önizleme satır adı', () => {
  it('önizleme satır adı: gövde no > gönderilen elle no > gövdesiz', () => {
    const sent = { subcontractorId: 's1', deliveryNoteNo: null, orders: [{ warpingOrderId: 'o1', beams: [{ lengthM: 1480, physicalBeamNo: ' TEST-G1 ' }, { lengthM: 1500, physicalBeamNo: null }] }] };
    expect(previewBeamName(sent, 'o1', 0, { bodyNo: 'LG-1', isNew: true })).toBe('LG-1 (yeni gövde)');
    expect(previewBeamName(sent, 'o1', 0, null)).toBe('TEST-G1 (gövdesiz)');
    expect(previewBeamName(sent, 'o1', 1, null)).toBe('gövdesiz');
    expect(previewBeamName(null, 'o1', 0, null)).toBe('gövdesiz');
  });
});

describe('receiveDocPayload — yeniden sarım adayı (ek-2 r)', () => {
  it('seçili aday gövdeye gider; aynı aday iki satırda yasak', () => {
    expect(beamLine(beam({ reworkOfBeamId: 'wb1' }), 'OFF', 's1')).toEqual({ lengthM: 1200, physicalBeamNo: null, reworkOfBeamId: 'wb1' });
    expect(beamLine(beam(), 'OFF', 's1')).not.toHaveProperty('reworkOfBeamId');
    const r = buildDocBody([order('FDV-1', [beam({ reworkOfBeamId: 'wb1' }), beam({ key: 'k2', reworkOfBeamId: 'wb1' })])], P);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/yeniden sarım/) });
    expect(buildDocBody([order('FDV-1', [beam({ reworkOfBeamId: 'wb1' }), beam({ key: 'k2', reworkOfBeamId: 'wb2' })])], P).ok).toBe(true);
  });
});
