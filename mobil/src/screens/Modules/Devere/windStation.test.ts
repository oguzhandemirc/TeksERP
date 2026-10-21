// =============================================================================
// windStation — Levent SAR istasyon formunun saf mantığı
// =============================================================================
//   §1 kg: nominal = tel×m×denye÷9e6 · tartıdan metre (`warpLengthFromWeight` ikizi)
//   §2 hedef: kartın EN ESKİ planlı IN_HOUSE leventi; yeni/seçili/kayıp hedef
//   §3 okutma: levent no → hedef; sarılmış/fason → ret; bilinmeyen → gövde no (yalnız yeni planda)
//   §4 doğrulama: kart · kayıp hedef · iş bağı · tartı/nominal kg · makine · lot
//   §5 ⭐ yük: sar gövdesi backend windSchema anahtarlarının alt kümesi; nominal modda iplik kg = nominal
//   §6 plan yükü IN_HOUSE + gövde; plan sonrası hedef = doğan levent; sarım sonrası temizlik
// Negatif sonda (2026-10-21, bir kezlik): `effectiveIssues` nominal dalı `form.weighedKg`a çevrildi → §5 ❌.
// =============================================================================
import type { WarpBeam } from '../../../services/warpBeam.service';
import { buildPlanPayload } from './beamPayload';
import {
  afterPlanCreated,
  afterWind,
  applyStationScan,
  buildStationWindPayload,
  defaultWarpSpecId,
  initialStationForm,
  lengthFromWeight,
  oldestPlannedFor,
  resolveStationScan,
  resolveTarget,
  stationNominalKg,
  stationPlanForm,
  validateStation,
  type StationDeps,
  type StationForm,
  type StationSpec,
} from './windStation';

const spec: StationSpec = { id: 's1', code: 'CZ-1', name: 'Siyah', endsCount: 4000, denier: 150 };
const deps: StationDeps = { defaultWarehouseId: 'w1', soleMachineId: 'm1', soleWeavingOrderId: null, lastWindDefaults: [] };
const rules = { lotRequired: false, beamWeavingLinkRequired: false };

function beam(id: string, over: Partial<WarpBeam> = {}): WarpBeam {
  return {
    id,
    beamNo: `LV-${id}`,
    status: 'PLANNED',
    plannedLengthM: 1200,
    physicalBeamNo: null,
    notes: null,
    originKind: 'IN_HOUSE',
    warpSpec: { id: 's1', code: 'CZ-1', name: 'Siyah', endsCount: 4000, yarnItem: { id: 'y', code: 'Y', name: 'Y', linearDensityDen: 150 } },
    subcontractor: null,
    supplier: null,
    wound: null,
    remainingM: 0,
    createdAt: '2026-10-20T08:00:00Z',
    ...over,
  } as WarpBeam;
}

function filled(over: Partial<StationForm> = {}): StationForm {
  return { ...initialStationForm('s1', deps), lengthM: '1000', weighedKg: '70', ...over };
}

// backend `windSchema` (Teks-Erp/src/routes/warp-beam.routes.ts) anahtarları — `.strict()`: fazlası 400.
const WIND_SCHEMA_KEYS = ['lengthM', 'kgSource', 'machineId', 'yarnIssues', 'yarnReturns', 'sectionCount', 'endsPerSection', 'breakCount', 'startedAt', 'clientToken', 'count', 'physicalBeamNoPrefix', 'dispatchItemId', 'weavingOrderId'];

describe('§1 kg hesabı', () => {
  it('nominal = tel × m × denye ÷ 9e6 (3 hane)', () => {
    expect(stationNominalKg(spec, '1000')).toBe(66.667);
    expect(stationNominalKg(spec, '1000,5')).toBe(66.7);
    expect(stationNominalKg({ ...spec, denier: null }, '1000')).toBeNull();
    expect(stationNominalKg(spec, '')).toBeNull();
  });
  it('tartıdan metre = net kg ÷ (tel × denye ÷ 9e6); denye yoksa null', () => {
    expect(lengthFromWeight(66.667, 4000, 150)).toBe(1000.005);
    expect(lengthFromWeight(60, 4000, null)).toBeNull();
    expect(lengthFromWeight(-1, 4000, 150)).toBeNull();
  });
});

describe('§2 hedef levent', () => {
  const planned = [beam('b2', { createdAt: '2026-10-20T09:00:00Z' }), beam('b1'), beam('f1', { originKind: 'SUBCONTRACT', createdAt: '2026-10-19T00:00:00Z' }), beam('x1', { warpSpec: { ...beam('x').warpSpec, id: 's2' }, createdAt: '2026-10-18T00:00:00Z' })];
  it('otomatik: aynı kartın EN ESKİ planlı İÇERİDE leventi', () => {
    expect(oldestPlannedFor(planned, 's1')?.id).toBe('b1');
    expect(resolveTarget({ warpSpecId: 's1', target: { kind: 'auto' } }, planned)?.id).toBe('b1');
    expect(oldestPlannedFor(planned, 's9')).toBeNull();
  });
  it('yeni → null; seçili → o levent; listeden düşmüş seçili → null', () => {
    expect(resolveTarget({ warpSpecId: 's1', target: { kind: 'new' } }, planned)).toBeNull();
    expect(resolveTarget({ warpSpecId: 's1', target: { kind: 'beam', beamId: 'b2' } }, planned)?.id).toBe('b2');
    expect(resolveTarget({ warpSpecId: 's1', target: { kind: 'beam', beamId: 'gone' } }, planned)).toBeNull();
  });
  it('varsayılan kart: son levent kartı → son sarım önerisi → tek kart', () => {
    const specs = [{ id: 's1' }, { id: 's2' }];
    expect(defaultWarpSpecId('s2', deps, specs)).toBe('s2');
    expect(defaultWarpSpecId('yok', { lastWindDefaults: [{ warpSpecId: 's1', machineId: null, yarnIssues: [], yarnReturns: [] }] }, specs)).toBe('s1');
    expect(defaultWarpSpecId(null, deps, [{ id: 's9' }])).toBe('s9');
    expect(defaultWarpSpecId(null, deps, specs)).toBeNull();
  });
  it('son sarım önerisi: makine + depo/lot gelir, kg BOŞ', () => {
    const f = initialStationForm('s1', { ...deps, lastWindDefaults: [{ warpSpecId: 's1', machineId: 'm7', yarnIssues: [{ warehouseId: 'w9', lotId: 'l1', qtyKg: 80 }], yarnReturns: [] }] });
    expect(f.machineId).toBe('m7');
    expect(f.issues).toEqual([{ key: 'i1', warehouseId: 'w9', qtyKg: '', reasonCode: null, lotId: 'l1' }]);
  });
});

describe('§3 okutma', () => {
  const list = [beam('b1'), beam('r1', { status: 'READY' }), beam('f1', { originKind: 'PURCHASED' })];
  it('levent no (katlanmış) → hedef + metre plandan', () => {
    const s = resolveStationScan(' lv-b1 ', list);
    expect(s.kind).toBe('beam');
    const r = applyStationScan(filled({ lengthM: '' }), s, null);
    expect(r.outcome).toBe('accept');
    expect(r.form.target).toEqual({ kind: 'beam', beamId: 'b1' });
    expect(r.form.lengthM).toBe('1200');
  });
  it('sarılmış ya da fason/hazır levent → ret mesajlı', () => {
    expect(resolveStationScan('LV-r1', list).kind).toBe('beam-blocked');
    const f = resolveStationScan('LV-f1', list);
    expect(f.kind).toBe('beam-blocked');
    expect(applyStationScan(filled(), f, null).outcome).toBe('reject');
  });
  it('bilinmeyen kod → gövde no; yalnız yeni planda yazılır', () => {
    const s = resolveStationScan('g-17', list);
    expect(s).toEqual({ kind: 'body', physicalBeamNo: 'G-17' });
    expect(applyStationScan(filled(), s, null).form.physicalBeamNo).toBe('G-17');
    const planned = applyStationScan(filled(), s, beam('b1'));
    expect(planned.outcome).toBe('reject');
    expect(planned.message).toContain('Yeni levent');
    expect(applyStationScan(filled(), s, beam('b1', { physicalBeamNo: 'g-17' })).outcome).toBe('accept');
  });
  it('boş okutma ret, mesajsız', () => {
    expect(applyStationScan(filled(), resolveStationScan('  ', list), null)).toMatchObject({ outcome: 'reject', message: null });
  });
});

describe('§4 doğrulama', () => {
  it('kart yok / seçili levent kayıp / iş bağı zorunlu', () => {
    expect(validateStation(filled(), null, null, rules)).toEqual({ ok: false, message: 'Çözgü kartı seçin.' });
    expect(validateStation(filled({ target: { kind: 'beam', beamId: 'gone' } }), spec, null, rules).ok).toBe(false);
    expect(validateStation(filled(), spec, null, { ...rules, beamWeavingLinkRequired: true }).ok).toBe(false);
    expect(validateStation(filled(), spec, beam('b1'), { ...rules, beamWeavingLinkRequired: true }).ok).toBe(true);
  });
  it('tartı kg boş → ret; nominal + denye yok → ret; nominal + denye → geçer', () => {
    expect(validateStation(filled({ weighedKg: '' }), spec, null, rules)).toEqual({ ok: false, message: 'Tartı kg 0’dan büyük olmalı.' });
    expect(validateStation(filled({ kgSource: 'THEORETICAL' }), { ...spec, denier: null }, null, rules).ok).toBe(false);
    expect(validateStation(filled({ kgSource: 'THEORETICAL', weighedKg: '' }), spec, null, rules)).toEqual({ ok: true });
  });
  it('makine ve lot sayfalı formun zincirinden', () => {
    expect(validateStation(filled({ machineId: null }), spec, null, rules)).toEqual({ ok: false, message: 'Devere makinesi seçin.' });
    expect(validateStation(filled(), spec, null, { ...rules, lotRequired: true })).toEqual({ ok: false, message: 'Lot zorunlu: her iplik çıkış satırında lot seçin.' });
  });
});

describe('§5 ⭐ sar yükü', () => {
  it('anahtarlar windSchema alt kümesi; tartı modunda iplik kg = tartı', () => {
    const p = buildStationWindPayload(filled(), spec, 'tok');
    for (const k of Object.keys(p)) expect(WIND_SCHEMA_KEYS).toContain(k);
    expect(p).toEqual({ lengthM: 1000, kgSource: 'WEIGHED', machineId: 'm1', yarnIssues: [{ warehouseId: 'w1', qtyKg: 70, lotId: null }], yarnReturns: [], breakCount: null, clientToken: 'tok' });
  });
  it('nominal modda iplik kg = nominal hesap (tartı alanı yok sayılır)', () => {
    const p = buildStationWindPayload(filled({ kgSource: 'THEORETICAL', weighedKg: '999' }), spec, 'tok');
    expect(p.kgSource).toBe('THEORETICAL');
    expect(p.yarnIssues).toEqual([{ warehouseId: 'w1', qtyKg: 66.667, lotId: null }]);
  });
  it('çok satırda satırların kendi kg’si gider', () => {
    const issues = [
      { key: 'a', warehouseId: 'w1', qtyKg: '30', reasonCode: null, lotId: null },
      { key: 'b', warehouseId: 'w2', qtyKg: '40', reasonCode: null, lotId: 'l2' },
    ];
    const p = buildStationWindPayload(filled({ issues, kgSource: 'THEORETICAL' }), spec, 'tok');
    expect(p.yarnIssues.map((l) => l.qtyKg)).toEqual([30, 40]);
  });
});

describe('§6 plan + zincir', () => {
  it('plan yükü IN_HOUSE, planlanan metre = sarılacak, gövde planda', () => {
    const p = buildPlanPayload(stationPlanForm(filled({ physicalBeamNo: 'G-17', weavingOrderId: 'wo1' })), 'tok');
    expect(p).toEqual({ warpSpecId: 's1', plannedLengthM: 1000, originKind: 'IN_HOUSE', subcontractorId: null, supplierId: null, physicalBeamNo: 'G-17', notes: null, weavingOrderId: 'wo1', clientToken: 'tok' });
  });
  it('plan doğunca hedef o levent (tekrar SAR ikinci plan açmaz)', () => {
    expect(afterPlanCreated(filled(), 'nb').target).toEqual({ kind: 'beam', beamId: 'nb' });
  });
  it('sarım sonrası ölçümler temizlenir, kart/makine/metre/depo kalır', () => {
    const f = afterWind(filled({ physicalBeamNo: 'G', breakCount: '2', target: { kind: 'beam', beamId: 'b1' } }));
    expect(f).toMatchObject({ warpSpecId: 's1', machineId: 'm1', lengthM: '1000', weighedKg: '', physicalBeamNo: '', breakCount: '', target: { kind: 'auto' } });
    expect(f.issues[0]).toMatchObject({ warehouseId: 'w1', qtyKg: '' });
  });
});
