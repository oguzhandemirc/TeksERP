import { buildPlanPayload, buildWindPayload, classifyBeamFailure, initialWindForm, isSameLocalDay, theoreticalKg, validatePlan, validateWind, EMPTY_PLAN, type WindForm } from './beamPayload';

const line = (qtyKg: string, reasonCode: string | null = null, warehouseId: string | null = 'w1') => ({ key: `k${qtyKg}`, warehouseId, qtyKg, reasonCode });

// ⭐ NEGATİF SONDA (ölçüldü 2026-09-14): köken XOR dalı kaldırılınca §plan/3 KIRMIZI · `returnKg > issueKg`
//    kapısı kaldırılınca §wind/4 KIRMIZI · fason kökende `yarnIssues` gönderilince §wind/6 KIRMIZI.
describe('validatePlan / buildPlanPayload — createSchema aynası, köken XOR', () => {
  const base = { ...EMPTY_PLAN, warpSpecId: 's1', plannedLengthM: '1200' };
  it('1 çözgü kartı ve pozitif metre zorunlu', () => {
    expect(validatePlan({ ...base, warpSpecId: null }).ok).toBe(false);
    expect(validatePlan({ ...base, plannedLengthM: '0' }).ok).toBe(false);
    expect(validatePlan(base).ok).toBe(true);
  });
  it('2 IN_HOUSE → taraf yok; taraf verilirse red', () => {
    expect(validatePlan({ ...base, subcontractorId: 'f1' }).ok).toBe(false);
  });
  it('3 ⭐ SUBCONTRACT yalnız fasoncu; PURCHASED tedarikçi XOR fasoncu (ikisi de / hiçbiri red)', () => {
    expect(validatePlan({ ...base, originKind: 'SUBCONTRACT' }).ok).toBe(false);
    expect(validatePlan({ ...base, originKind: 'SUBCONTRACT', subcontractorId: 'f1' }).ok).toBe(true);
    expect(validatePlan({ ...base, originKind: 'PURCHASED' }).ok).toBe(false);
    expect(validatePlan({ ...base, originKind: 'PURCHASED', supplierId: 'c1', subcontractorId: 'f1' }).ok).toBe(false);
    expect(validatePlan({ ...base, originKind: 'PURCHASED', supplierId: 'c1' }).ok).toBe(true);
    expect(validatePlan({ ...base, originKind: 'PURCHASED', subcontractorId: 'f1' }).ok).toBe(true);
  });
  it('4 yük: virgüllü metre sayıya, boş metin null, taraf kökene göre budanır, token aynen', () => {
    const p = buildPlanPayload({ ...base, plannedLengthM: '1200,5', originKind: 'IN_HOUSE', subcontractorId: 'f1', physicalBeamNo: '  ', notes: 'n' }, 'tok');
    expect(p).toEqual({ warpSpecId: 's1', plannedLengthM: 1200.5, originKind: 'IN_HOUSE', subcontractorId: null, supplierId: null, physicalBeamNo: null, notes: 'n', clientToken: 'tok' });
    expect(Object.keys(p).sort()).toEqual(['clientToken', 'notes', 'originKind', 'physicalBeamNo', 'plannedLengthM', 'subcontractorId', 'supplierId', 'warpSpecId']);
  });
});

describe('validateWind / buildWindPayload — windSchema aynası', () => {
  const inHouse: WindForm = { lengthM: '1180', kgSource: 'WEIGHED', machineId: 'm1', issues: [line('50')], returns: [], breakCount: '' };
  it('1 başlangıç: metre plandan, kg kaynağı kökene göre, IN_HOUSE ilk çıkış satırı varsayılan depoyla', () => {
    const f = initialWindForm({ plannedLengthM: 900, originKind: 'IN_HOUSE' }, 'w1');
    expect(f.lengthM).toBe('900');
    expect(f.kgSource).toBe('WEIGHED');
    expect(f.issues).toHaveLength(1);
    expect(f.issues[0]!.warehouseId).toBe('w1');
    const g = initialWindForm({ plannedLengthM: 900, originKind: 'PURCHASED' }, 'w1');
    expect(g.kgSource).toBe('THEORETICAL');
    expect(g.issues).toHaveLength(0);
  });
  it('2 IN_HOUSE: makine ve ≥1 çıkış satırı zorunlu', () => {
    expect(validateWind({ ...inHouse, machineId: null }, 'IN_HOUSE').ok).toBe(false);
    expect(validateWind({ ...inHouse, issues: [] }, 'IN_HOUSE').ok).toBe(false);
    expect(validateWind(inHouse, 'IN_HOUSE').ok).toBe(true);
  });
  it('3 dip iadesi satırında sebep zorunlu; depo/kg boş red', () => {
    expect(validateWind({ ...inHouse, returns: [line('5')] }, 'IN_HOUSE').ok).toBe(false);
    expect(validateWind({ ...inHouse, returns: [line('5', 'DEPOYA_IADE')] }, 'IN_HOUSE').ok).toBe(true);
    expect(validateWind({ ...inHouse, issues: [line('50', null, null)] }, 'IN_HOUSE').ok).toBe(false);
    expect(validateWind({ ...inHouse, issues: [line('0')] }, 'IN_HOUSE').ok).toBe(false);
  });
  it('4 ⭐ Σ dip iadesi ≤ Σ brüt çıkış — istemcide de (sunucu WARP_RETURN_EXCEEDS_ISSUE ikizi)', () => {
    expect(validateWind({ ...inHouse, returns: [line('51', 'TELEF')] }, 'IN_HOUSE').ok).toBe(false);
    expect(validateWind({ ...inHouse, returns: [line('50', 'TELEF')] }, 'IN_HOUSE').ok).toBe(true);
  });
  it('5 fason/hazır: yalnız metre; makine/satır sorulmaz', () => {
    expect(validateWind({ ...inHouse, machineId: null, issues: [] }, 'SUBCONTRACT').ok).toBe(true);
    expect(validateWind({ ...inHouse, lengthM: '' }, 'PURCHASED').ok).toBe(false);
  });
  it('6 ⭐ yük: fason kökende makine null + satırlar BOŞ (sunucu 400 vermesin); IN_HOUSE satırlar sayıya', () => {
    const fason = buildWindPayload({ ...inHouse, returns: [line('5', 'TELEF')] }, 'SUBCONTRACT', 'tok');
    expect(fason.machineId).toBeNull();
    expect(fason.yarnIssues).toEqual([]);
    expect(fason.yarnReturns).toEqual([]);
    expect(fason.breakCount).toBeNull();
    const ic = buildWindPayload({ ...inHouse, lengthM: '1180,5', returns: [line('5', 'TELEF')], breakCount: '3' }, 'IN_HOUSE', 'tok');
    expect(ic).toEqual({ lengthM: 1180.5, kgSource: 'WEIGHED', machineId: 'm1', yarnIssues: [{ warehouseId: 'w1', qtyKg: 50 }], yarnReturns: [{ warehouseId: 'w1', qtyKg: 5, reasonCode: 'TELEF' }], breakCount: 3, clientToken: 'tok' });
  });
  it('7 nominal kg sunucu formülünün aynası: 4000 tel × 150 den × 1000 m / 9.000.000 = 66,667', () => {
    expect(theoreticalKg(4000, 150, 1000)).toBe(66.667);
    expect(theoreticalKg(4000, null, 1000)).toBeNull();
    expect(theoreticalKg(4000, 150, 0)).toBeNull();
  });
});

describe('classifyBeamFailure — details.code → eylem (kod uydurulmaz)', () => {
  const err = (code: string, modul?: string) => ({ message: 'm', details: { code, modul } });
  it('durum çakışmaları listeyi tazeler', () => {
    for (const c of ['WARP_BEAM_STATE', 'WARP_BEAM_NOT_PLANNED', 'WARP_BEAM_NOT_WOUND', 'WARP_BEAM_CANCELLED']) expect(classifyBeamFailure(err(c), 'f').kind).toBe('refresh-list');
  });
  it('bağlam kusurları bağlamı tazeler; sebep kodu katalogu tazeler', () => {
    expect(classifyBeamFailure(err('WARP_BEAM_MACHINE_NOT_DEVERE'), 'f').kind).toBe('refresh-context');
    expect(classifyBeamFailure(err('WARP_DENIER_MISSING'), 'f').kind).toBe('refresh-context');
    expect(classifyBeamFailure(err('REASON_CODE_INVALID'), 'f').kind).toBe('refresh-presets');
  });
  it('⭐ MODULE_DISABLED modülü ADIYLA taşır (devere ↔ iplik ayrı anlatılır); çakışma modal', () => {
    expect(classifyBeamFailure(err('MODULE_DISABLED', 'iplik'), 'f')).toEqual({ kind: 'module-off', modul: 'iplik', message: 'm' });
    expect(classifyBeamFailure(err('MODULE_DISABLED'), 'f')).toMatchObject({ kind: 'module-off', modul: 'devere' });
    expect(classifyBeamFailure(err('CLIENT_TOKEN_COLLISION'), 'f').kind).toBe('token-collision');
  });
  it('bilinmeyen kod / kodsuz hata düz mesaj, mesaj boşsa fallback', () => {
    expect(classifyBeamFailure(err('X'), 'f').kind).toBe('plain');
    expect(classifyBeamFailure({ message: '  ' }, 'f').message).toBe('f');
    expect(classifyBeamFailure(undefined, 'f')).toEqual({ kind: 'plain', message: 'f' });
  });
});

describe('isSameLocalDay — "bugün sarılan" sekmesi', () => {
  it('aynı gün · farklı gün · geçersiz tarih', () => {
    const now = new Date(2026, 8, 14, 15, 0, 0);
    expect(isSameLocalDay(new Date(2026, 8, 14, 0, 5).toISOString(), now)).toBe(true);
    expect(isSameLocalDay(new Date(2026, 8, 13, 23, 59).toISOString(), now)).toBe(false);
    expect(isSameLocalDay('bozuk', now)).toBe(false);
  });
});
