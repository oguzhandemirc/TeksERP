import { beamActionsEnabled, buildPlanPayload, buildWindPayload, classifyBeamFailure, initialWindForm, isSameLocalDay, lastPlannedWarpSpecId, linesTotalKg, physicalBeamBusyWarning, soleMachineId, soleWeavingOrderId, theoreticalKg, validatePlan, validateWind, validateWindPage, windDefaultFor, windFormWithDefault, windPageKeys, windPhysicalNos, yarnQualityWarning, EMPTY_PLAN, STATUS_LABEL, YARN_QUALITY_LABEL, type WindDefault, type WindForm } from './beamPayload';

const line = (qtyKg: string, reasonCode: string | null = null, warehouseId: string | null = 'w1', lotId: string | null = null) => ({ key: `k${qtyKg}`, warehouseId, qtyKg, reasonCode, lotId });

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
    expect(p).toEqual({ warpSpecId: 's1', plannedLengthM: 1200.5, originKind: 'IN_HOUSE', subcontractorId: null, supplierId: null, physicalBeamNo: null, notes: 'n', weavingOrderId: null, clientToken: 'tok' });
    expect(Object.keys(p).sort()).toEqual(['clientToken', 'notes', 'originKind', 'physicalBeamNo', 'plannedLengthM', 'subcontractorId', 'supplierId', 'warpSpecId', 'weavingOrderId']);
  });
});

describe('validateWind / buildWindPayload — windSchema aynası', () => {
  const inHouse: WindForm = { lengthM: '1180', kgSource: 'WEIGHED', machineId: 'm1', issues: [line('50')], returns: [], breakCount: '', count: '1', physicalBeamNoPrefix: '' };
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
    expect(ic).toEqual({ lengthM: 1180.5, kgSource: 'WEIGHED', machineId: 'm1', yarnIssues: [{ warehouseId: 'w1', qtyKg: 50, lotId: null }], yarnReturns: [{ warehouseId: 'w1', qtyKg: 5, reasonCode: 'TELEF', lotId: null }], breakCount: 3, clientToken: 'tok' });
  });
  // Devere Faz 2 A3 (lot). ⭐ NEGATİF SONDA: `buildWindPayload` satırından `lotId` düşünce ⑧ ❌ · `validateWind`
  //    lotRequired dalı kaldırılınca ⑨ ❌ · kapalıyken (lotRequired=false) lotsuz satır reddedilince ⑩ ❌.
  it('⑧ ⭐ lot etiketi yüke girer (allowlist) — "Lot yok" null gider, sessiz düşmez', () => {
    const p = buildWindPayload({ ...inHouse, issues: [line('50', null, 'w1', 'lotA')], returns: [line('5', 'TELEF', 'w1', 'lotA')] }, 'IN_HOUSE', 'tok');
    expect(p.yarnIssues[0]).toEqual({ warehouseId: 'w1', qtyKg: 50, lotId: 'lotA' });
    expect(p.yarnReturns[0]).toEqual({ warehouseId: 'w1', qtyKg: 5, reasonCode: 'TELEF', lotId: 'lotA' });
    expect(buildWindPayload(inHouse, 'IN_HOUSE', 'tok').yarnIssues[0]!.lotId).toBeNull();
  });
  it('⑨ lotRequired AÇIK (sunucudan): lotsuz çıkış satırı istemcide de reddedilir, lotlu geçer', () => {
    expect(validateWind(inHouse, 'IN_HOUSE', true).ok).toBe(false);
    expect(validateWind({ ...inHouse, issues: [line('50', null, 'w1', 'lotA')] }, 'IN_HOUSE', true).ok).toBe(true);
    // dip iadesi lotu zorunlu DEĞİL (sunucu yalnız uyarır)
    expect(validateWind({ ...inHouse, issues: [line('50', null, 'w1', 'lotA')], returns: [line('5', 'TELEF')] }, 'IN_HOUSE', true).ok).toBe(true);
  });
  it('⑩ ⭐ lotRequired KAPALI / alan yok: lotsuz satır BİREBİR eski davranış (kabul)', () => {
    expect(validateWind(inHouse, 'IN_HOUSE', false).ok).toBe(true);
    expect(validateWind(inHouse, 'IN_HOUSE').ok).toBe(true);
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

describe('STATUS_LABEL / beamActionsEnabled — fason F1: SHIPPED_OUT tablette görünür, dokunulmaz', () => {
  it('yedi durumun rozeti var (Faz 3: MOUNTED · EXHAUSTED · SCRAPPED); SHIPPED_OUT "Fasonda", MOUNTED "Tezgahta"', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(['CANCELLED', 'EXHAUSTED', 'MOUNTED', 'PLANNED', 'READY', 'SCRAPPED', 'SHIPPED_OUT']);
    expect(STATUS_LABEL.SHIPPED_OUT).toBe('Fasonda');
    expect(STATUS_LABEL.MOUNTED).toBe('Tezgahta');
  });
  it('⭐ eylemler yalnız PLANNED/READY; fasondaki ve iptal levent kapalı (sunucu 409 WARP_BEAM_STATE verirdi)', () => {
    expect(beamActionsEnabled('PLANNED')).toBe(true);
    expect(beamActionsEnabled('READY')).toBe(true);
    expect(beamActionsEnabled('SHIPPED_OUT')).toBe(false);
    expect(beamActionsEnabled('CANCELLED')).toBe(false);
    // Faz 3: tezgahtaki/terminal levent sarım ekranından dokunulmaz (E3 "Tezgahta" sekmesi ayrı eylem kümesi).
    expect(beamActionsEnabled('MOUNTED')).toBe(false);
    expect(beamActionsEnabled('EXHAUSTED')).toBe(false);
    expect(beamActionsEnabled('SCRAPPED')).toBe(false);
  });
});

describe('raşel takımı (#23) — adet', () => {
  const base: WindForm = { lengthM: '100', kgSource: 'WEIGHED', machineId: 'm1', issues: [{ key: 'i1', warehouseId: 'w1', qtyKg: '30', reasonCode: null, lotId: null }], returns: [], breakCount: '', count: '1', physicalBeamNoPrefix: '' };
  it('⭐ adet 1 → yükte `count`/`physicalBeamNoPrefix` YOK (bugünkü istek bayt bayt)', () => {
    const p = buildWindPayload(base, 'IN_HOUSE', 'tok');
    expect('count' in p).toBe(false);
    expect('physicalBeamNoPrefix' in p).toBe(false);
  });
  it('adet 3 + önek → yükte count 3 ve önek; iplik satırları TOPLAM gider (pay sunucuda ÷ N)', () => {
    const p = buildWindPayload({ ...base, count: '3', physicalBeamNoPrefix: ' R7 ' }, 'IN_HOUSE', 'tok');
    expect(p.count).toBe(3);
    expect(p.physicalBeamNoPrefix).toBe('R7');
    expect(p.yarnIssues[0].qtyKg).toBe(30);
  });
  it('adet 0 / 25 / "a" → doğrulama red; boş önek null gider', () => {
    expect(validateWind({ ...base, count: '0' }, 'IN_HOUSE').ok).toBe(false);
    expect(validateWind({ ...base, count: '25' }, 'IN_HOUSE').ok).toBe(false);
    expect(validateWind({ ...base, count: 'a' }, 'IN_HOUSE').ok).toBe(false);
    expect(buildWindPayload({ ...base, count: '2' }, 'IN_HOUSE', 'tok').physicalBeamNoPrefix).toBeNull();
  });
});

// ⭐ NEGATİF SONDA (2026-09-18, bir kezlik): `validateWindPage('makine')` makine kapısı düşürüldü → §sayfa/2 ❌ ve
//    (zincir aynı olduğu için) §wind/2 ❌; `physicalBeamBusyWarning` katlamasız karşılaştırdı → §gövde/1 ❌.
describe('sayfalı Sar — validateWindPage ↔ validateWind AYNI zincir', () => {
  const inHouse: WindForm = { lengthM: '1180', kgSource: 'WEIGHED', machineId: 'm1', issues: [line('50')], returns: [], breakCount: '', count: '1', physicalBeamNoPrefix: '' };
  it('1 sayfa anahtarları: IN_HOUSE ölçü·makine·dip, fason/hazır yalnız ölçü', () => {
    expect(windPageKeys('IN_HOUSE')).toEqual(['olcu', 'makine', 'dip']);
    expect(windPageKeys('SUBCONTRACT')).toEqual(['olcu']);
    expect(windPageKeys('PURCHASED')).toEqual(['olcu']);
  });
  it('2 ⭐ her hata KENDİ sayfasında çıkar, öteki sayfalar temiz (İleri kilidi doğru sayfada)', () => {
    expect(validateWindPage({ ...inHouse, lengthM: '0' }, false, 'olcu').ok).toBe(false);
    expect(validateWindPage({ ...inHouse, lengthM: '0' }, false, 'makine').ok).toBe(true);
    expect(validateWindPage({ ...inHouse, machineId: null }, false, 'makine')).toEqual({ ok: false, message: 'Devere makinesi seçin.' });
    expect(validateWindPage({ ...inHouse, machineId: null }, false, 'olcu').ok).toBe(true);
    expect(validateWindPage({ ...inHouse, issues: [line('50', null, 'w1', null)] }, true, 'makine').ok).toBe(false);
    expect(validateWindPage({ ...inHouse, returns: [line('51', 'TELEF')] }, false, 'dip').ok).toBe(false);
    expect(validateWindPage({ ...inHouse, returns: [line('51', 'TELEF')] }, false, 'makine').ok).toBe(true);
    expect(validateWindPage({ ...inHouse, breakCount: '1.5' }, false, 'dip').ok).toBe(false);
  });
  it('3 bütün = sayfaların sırayla zinciri: ilk hatalı sayfanın mesajı döner', () => {
    const f = { ...inHouse, lengthM: '0', machineId: null };
    expect(validateWind(f, 'IN_HOUSE')).toEqual(validateWindPage(f, false, 'olcu'));
    expect(validateWind({ ...inHouse, machineId: null }, 'IN_HOUSE')).toEqual({ ok: false, message: 'Devere makinesi seçin.' });
    expect(validateWind(inHouse, 'IN_HOUSE')).toEqual({ ok: true });
  });
  it('4 özet kg toplamı virgüllü/boş satırı sayar, 3 haneye yuvarlar', () => {
    expect(linesTotalKg([line('50,5'), line(''), line('0.25')])).toBe(50.75);
    expect(linesTotalKg([])).toBe(0);
  });
});

describe('gövde çakışması ERKEN uyarısı — sunucu assertPhysicalBeamFreeTx aynası (tr_fold · canlı durumlar)', () => {
  const beams = [
    { id: 'a', beamNo: 'LV1809260001', physicalBeamNo: 'T1', status: 'READY' as const },
    { id: 'b', beamNo: 'LV1809260002', physicalBeamNo: 'T2', status: 'MOUNTED' as const },
    { id: 'c', beamNo: 'LV1809260003', physicalBeamNo: 'T3', status: 'SHIPPED_OUT' as const },
    { id: 'd', beamNo: 'LV1809260004', physicalBeamNo: 'T4', status: 'CANCELLED' as const },
  ];
  it('1 ⭐ katlamalı eşleşme (küçük/büyük · boşluk · Türkçe harf) ve durum sözcüğü', () => {
    expect(physicalBeamBusyWarning('t1', beams)).toBe('t1 gövdesinde LV1809260001 hazır duruyor — sarım reddedilir; gövdeyi boşaltın ya da başka gövde yazın.');
    expect(physicalBeamBusyWarning(' T2 ', beams)).toContain('LV1809260002 tezgahta');
    expect(physicalBeamBusyWarning('T3', beams)).toContain('LV1809260003 fasonda');
  });
  it('2 canlı olmayan (CANCELLED) levent uyarmaz; boş/farklı gövde null; kendi id\'si dışlanır', () => {
    expect(physicalBeamBusyWarning('T4', beams)).toBeNull();
    expect(physicalBeamBusyWarning('', beams)).toBeNull();
    expect(physicalBeamBusyWarning(null, beams)).toBeNull();
    expect(physicalBeamBusyWarning('T9', beams)).toBeNull();
    expect(physicalBeamBusyWarning('T1', beams, 'a')).toBeNull();
  });
  it('3 sarımda doğacak gövdeler: k=1 kendi, k≥2 önek-k (önek yoksa yalnız kendi); adet 1 önek yok sayılır', () => {
    expect(windPhysicalNos('T1', { count: '3', physicalBeamNoPrefix: 'R7' })).toEqual(['T1', 'R7-2', 'R7-3']);
    expect(windPhysicalNos(null, { count: '2', physicalBeamNoPrefix: 'R7' })).toEqual(['R7-2']);
    expect(windPhysicalNos(null, { count: '3', physicalBeamNoPrefix: '' })).toEqual([]);
    expect(windPhysicalNos('T1', { count: '1', physicalBeamNoPrefix: 'R7' })).toEqual(['T1']);
  });
});

// ⭐ NEGATİF SONDA (2026-09-18, bir kezlik): `soleMachineId` >1 makinede id döndürdü → §ön-seçim/1 ❌;
//    `lastPlannedWarpSpecId` createdAt yerine liste sırası aldı → §ön-seçim/2 ❌.
describe('ön-seçim yardımcıları (+0/−1 dokunuş)', () => {
  it('1 tek devere makinesi → id; 0 ya da >1 → null (operatör seçer)', () => {
    expect(soleMachineId([{ id: 'm1' }])).toBe('m1');
    expect(soleMachineId([])).toBeNull();
    expect(soleMachineId([{ id: 'm1' }, { id: 'm2' }])).toBeNull();
  });
  it('2 son leventin çözgü kartı EN YENİ createdAt\'e göre (liste sırası değil); boş → null', () => {
    const beams = [
      { warpSpec: { id: 's-eski' }, createdAt: '2026-09-18T08:00:00.000Z' },
      { warpSpec: { id: 's-yeni' }, createdAt: '2026-09-18T10:00:00.000Z' },
      { warpSpec: { id: 's-orta' }, createdAt: '2026-09-18T09:00:00.000Z' },
    ];
    expect(lastPlannedWarpSpecId(beams)).toBe('s-yeni');
    expect(lastPlannedWarpSpecId([])).toBeNull();
  });
});

// ⭐ NEGATİF SONDA (2026-09-18, bir kezlik): `validatePlan` required kolu düşünce §Z4/1 ❌; `buildPlanPayload`
//    weavingOrderId taşımayınca §Z4/2 ❌; `soleWeavingOrderId` >1 işte id → §Z4/3 ❌.
describe('Z1 üretim belge zinciri — Plan dokuma işi', () => {
  const base = { ...EMPTY_PLAN, warpSpecId: 's1', plannedLengthM: '1200' };
  it('1 beamWeavingLinkRequired açıkken iş zorunlu; kapalıyken serbest', () => {
    expect(validatePlan(base, true).ok).toBe(false);
    expect(validatePlan({ ...base, weavingOrderId: 'wo1' }, true).ok).toBe(true);
    expect(validatePlan(base, false).ok).toBe(true);
  });
  it('2 buildPlanPayload weavingOrderId taşır (null da açıkça)', () => {
    expect(buildPlanPayload({ ...base, weavingOrderId: 'wo1' }, 'tok').weavingOrderId).toBe('wo1');
    expect(buildPlanPayload(base, 'tok').weavingOrderId).toBeNull();
    expect(Object.keys(buildPlanPayload(base, 'tok'))).toContain('weavingOrderId');
  });
  it('3 soleWeavingOrderId: tek iş → id; 0/>1/undefined → null', () => {
    expect(soleWeavingOrderId([{ id: 'wo1' }])).toBe('wo1');
    expect(soleWeavingOrderId([])).toBeNull();
    expect(soleWeavingOrderId([{ id: 'wo1' }, { id: 'wo2' }])).toBeNull();
    expect(soleWeavingOrderId(undefined)).toBeNull();
  });
  it('4 buildWindPayload weavingOrderId yalnız verildiğinde gider (eski çağıran değişmez)', () => {
    const f: WindForm = { lengthM: '100', kgSource: 'WEIGHED', machineId: 'm1', issues: [], returns: [], breakCount: '', count: '1', physicalBeamNoPrefix: '' };
    expect('weavingOrderId' in buildWindPayload(f, 'SUBCONTRACT', 'tok')).toBe(false);
    expect(buildWindPayload(f, 'SUBCONTRACT', 'tok', 'wo1').weavingOrderId).toBe('wo1');
    expect(buildWindPayload(f, 'SUBCONTRACT', 'tok', null).weavingOrderId).toBeNull();
  });
});

// ⭐ NEGATİF SONDA: `windFormWithDefault` IN_HOUSE dalı kaldırılınca §5 KIRMIZI (öneri yok sayılır);
//    `qtyKg: String(...)` yerine sayı bırakılınca form tipi/İleri kırılır; `def.machineId ?? base` kaldırılınca makine düşer.
describe('windFormWithDefault / windDefaultFor — Z5 SAR ön-dolgu (yalnız öneri)', () => {
  const base = initialWindForm({ plannedLengthM: 900, originKind: 'IN_HOUSE' }, 'w1');
  const def: WindDefault = {
    warpSpecId: 's1',
    machineId: 'm9',
    yarnIssues: [{ warehouseId: 'w9', lotId: 'l9', qtyKg: 12.5 }],
    yarnReturns: [{ warehouseId: 'w9', lotId: 'l9', qtyKg: 1, reasonCode: 'DIP' }],
  };
  it('1 IN_HOUSE: makine + çıkış satırının DEPO/LOT önerilir, kg BOŞ; dip iadesi ön-doldurulmaz', () => {
    const f = windFormWithDefault(base, 'IN_HOUSE', def);
    expect(f.machineId).toBe('m9');
    expect(f.issues).toEqual([{ key: 'i1', warehouseId: 'w9', qtyKg: '', reasonCode: null, lotId: 'l9' }]);
    expect(f.returns).toBe(base.returns); // dip iadesi ÖN-DOLDURULMAZ (yarnReturns yok sayılır)
  });
  it('2 öneri yoksa / IN_HOUSE değilse taban korunur', () => {
    expect(windFormWithDefault(base, 'IN_HOUSE', undefined)).toBe(base);
    expect(windFormWithDefault(base, 'SUBCONTRACT', def)).toBe(base);
  });
  it('3 boş çıkış listesi gelirse tabanın satırı korunur (en az bir çıkış)', () => {
    const f = windFormWithDefault(base, 'IN_HOUSE', { ...def, yarnIssues: [] });
    expect(f.issues).toBe(base.issues);
  });
  it('4 windDefaultFor: karta göre eşleşir, yoksa undefined; liste undefined güvenli', () => {
    expect(windDefaultFor([def], 's1')).toBe(def);
    expect(windDefaultFor([def], 's-yok')).toBeUndefined();
    expect(windDefaultFor(undefined, 's1')).toBeUndefined();
  });
});

// ⭐ NEGATİF SONDA: `yarnQualityWarning` ON_HOLD/BLOCKED'a null dönerse bekletmedeki lot uyarısız seçilir
//    (sunucu yine 400 verir ama operatör erken görmez).
describe('yarn lot kalite durumu — SAR rozet + uyarı (yarnQualityHold)', () => {
  it('1 etiketler: RELEASED→Serbest · ON_HOLD→Bekletmede · BLOCKED→Bloke', () => {
    expect(YARN_QUALITY_LABEL).toEqual({ RELEASED: 'Serbest', ON_HOLD: 'Bekletmede', BLOCKED: 'Bloke' });
  });
  it('2 uyarı yalnız ON_HOLD/BLOCKED için', () => {
    expect(yarnQualityWarning('ON_HOLD')).toMatch(/BEKLETMEDE/);
    expect(yarnQualityWarning('BLOCKED')).toMatch(/BLOKE/);
    expect(yarnQualityWarning('RELEASED')).toBeNull();
    expect(yarnQualityWarning(undefined)).toBeNull();
    expect(yarnQualityWarning(null)).toBeNull();
  });
});
