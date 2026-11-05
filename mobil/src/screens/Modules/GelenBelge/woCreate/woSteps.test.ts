// K30-D saf parçalar: adım listesi (ekle/çıkar/sırala/not/firma), etkin rota, `steps` gövdesi, mergeExtra; formun ek
// gövdesinde tür / hedef özellik / adım / makine — değişmeyen GİTMEZ, değişen doğru şekilde gider.
import type { CreateWorkOrderFromNoteBody } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { buildExtraBody, editExtras, extrasIssues, initialFormState, resetForRoute, type WoFormExtras } from './woForm';
import {
  addStep,
  buildStepsBody,
  effectiveRoute,
  mergeExtra,
  moveStep,
  patchStep,
  removeStep,
  sameAsRoute,
  stationsFromRoutes,
  stepsDropMachine,
  stepsFromRoute,
} from './woSteps';

const st = (id: string, x: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), ...x });
const route = {
  id: 'r1',
  name: 'Kurşun → Fason → Tambur',
  steps: [
    { id: 's3', stationId: 'tam', sequence: 3, station: st('tam', { kind: 'TAMBUR' }) },
    { id: 's1', stationId: 'kur', sequence: 1, plannedMachineId: 'm1', defaultNotes: 'yavaş', station: st('kur', { isKursunStation: true }) },
    { id: 's2', stationId: 'fas', sequence: 2, requiredCategoryId: 'cat', plannedSubcontractorId: 'f1', station: st('fas', { defaultCategory: { id: 'cat', name: 'Boya' } }) },
  ],
} as unknown as ProductionRoute;
const extras = (x: Partial<WoFormExtras> = {}): WoFormExtras => ({ ...initialFormState().extras, ...x });

describe('woSteps', () => {
  it('şablondan sıralı liste; gövde sequence=sıra+1, boş alan anahtarsız', () => {
    const steps = stepsFromRoute(route);
    expect(steps.map((s) => s.stationId)).toEqual(['kur', 'fas', 'tam']);
    expect(buildStepsBody(steps)).toEqual([
      { stationId: 'kur', sequence: 1, notes: 'yavaş', plannedMachineId: 'm1' },
      { stationId: 'fas', sequence: 2, requiredCategoryId: 'cat', plannedSubcontractorId: 'f1' },
      { stationId: 'tam', sequence: 3 },
    ]);
    expect(sameAsRoute(steps, route)).toBe(true);
  });

  it('⭐ ekle / çıkar / yukarı-aşağı / not / firma', () => {
    let s = stepsFromRoute(route);
    s = addStep(s, st('kk', { defaultCategory: { id: 'c2', name: 'Fırça' } }) as never, 'n1');
    expect(s.map((x) => x.stationId)).toEqual(['kur', 'fas', 'tam', 'kk']);
    expect(s[3].requiredCategoryId).toBe('c2');
    s = moveStep(s, 'n1', -1);
    expect(s.map((x) => x.stationId)).toEqual(['kur', 'fas', 'kk', 'tam']);
    expect(moveStep(s, 'ts1', -1)).toEqual(s);
    s = removeStep(s, 'ts2');
    s = patchStep(s, 'n1', { notes: '  dikkat ', plannedSubcontractorId: 'f9' });
    expect(buildStepsBody(s)).toEqual([
      { stationId: 'kur', sequence: 1, notes: 'yavaş', plannedMachineId: 'm1' },
      { stationId: 'kk', sequence: 2, notes: 'dikkat', requiredCategoryId: 'c2', plannedSubcontractorId: 'f9' },
      { stationId: 'tam', sequence: 3 },
    ]);
    expect(sameAsRoute(s, route)).toBe(false);
  });

  it('makine kararı ilk kurşun adımına: id yazılır, null şablon makinesini kaldırır, undefined şablonu korur', () => {
    const s = stepsFromRoute(route);
    expect(buildStepsBody(s, 'm2')[0].plannedMachineId).toBe('m2');
    expect(buildStepsBody(s, null)[0]).not.toHaveProperty('plannedMachineId');
    expect(buildStepsBody(s, undefined)[0].plannedMachineId).toBe('m1');
  });

  it('etkin rota: kimlik şablonun, adımlar düzenlenmiş liste (tambur çıkınca rotada tambur yok)', () => {
    const s = removeStep(stepsFromRoute(route), 'ts3');
    const eff = effectiveRoute(route, s);
    expect(eff.id).toBe('r1');
    expect(eff.steps?.map((x) => [x.sequence, x.stationId])).toEqual([[1, 'kur'], [2, 'fas']]);
    expect(eff.steps?.some((x) => x.station?.kind === 'TAMBUR')).toBe(false);
    expect(effectiveRoute(route, null)).toBe(route);
  });

  it('istasyon kaynağı rota şablonlarından tekil', () => {
    expect(stationsFromRoutes([route, route]).map((x) => x.id)).toEqual(['fas', 'kur', 'tam']);
  });

  it('⭐ mergeExtra: steps varsa üst + parti stepPlanning düşer; steps yoksa gövde + ek alan', () => {
    const body = {
      clientToken: 't',
      ownerCustomerId: 'c',
      kursunMeters: '10',
      routeTemplateId: 'r1',
      stepPlanning: [{ sequence: 1, plannedMachineId: 'm1' }],
      parties: [{ blockNo: 1, batchNo: null, meters: 5, stepPlanning: [{ sequence: 1, plannedMachineId: 'm1' }] }],
    } as CreateWorkOrderFromNoteBody;
    const withSteps = mergeExtra(body, { steps: [{ stationId: 'kur', sequence: 1 }] });
    expect(withSteps).not.toHaveProperty('stepPlanning');
    expect(withSteps.parties?.[0]).not.toHaveProperty('stepPlanning');
    expect(withSteps.routeTemplateId).toBe('r1');
    expect(mergeExtra(body, { width: 150 })).toEqual({ ...body, width: 150 });
    expect(mergeExtra(body, undefined)).toBe(body);
  });
});

describe('K30-D ek gövde (buildExtraBody)', () => {
  it('⭐ dokunulmayan tür / özellik / adım / makine gövdeye GİTMEZ', () => {
    const b = buildExtraBody(extras({ steps: stepsFromRoute(route) }), { hasTambur: true, route });
    expect(b).not.toHaveProperty('type');
    expect(b).not.toHaveProperty('targetPropertyIds');
    expect(b).not.toHaveProperty('steps');
    expect(b).not.toHaveProperty('stepPlanning');
  });

  it('⭐ değişen alan doğru şekilde gider: tür, açık özellik kümesi (boş dahil), adımlar + routeTemplateId yolu', () => {
    const s = removeStep(stepsFromRoute(route), 'ts2');
    const b = buildExtraBody(extras({ woType: 'STOCK_PRODUCTION', propertyIds: [], steps: s, machineId: 'm2' }), { hasTambur: true, route });
    expect(b.type).toBe('STOCK_PRODUCTION');
    expect(b.targetPropertyIds).toEqual([]);
    expect(b.steps).toEqual([
      { stationId: 'kur', sequence: 1, notes: 'yavaş', plannedMachineId: 'm2' },
      { stationId: 'tam', sequence: 2 },
    ]);
    expect(b).not.toHaveProperty('stepPlanning');
  });

  it('adımlar değişmeden makine seçildi → stepPlanning (kurşun sırası); PER_PARTY\'de üst makine gitmez', () => {
    expect(buildExtraBody(extras({ machineId: 'm2' }), { hasTambur: true, route }).stepPlanning).toEqual([{ sequence: 1, plannedMachineId: 'm2' }]);
    expect(buildExtraBody(extras({ machineId: null }), { hasTambur: true, route }).stepPlanning).toEqual([{ sequence: 1, plannedMachineId: null }]);
    expect(buildExtraBody(extras({ machineId: 'm2' }), { hasTambur: true, route, perParty: true })).not.toHaveProperty('stepPlanning');
  });

  it('⭐ ORDER + sipariş kalemsiz → engel; kalem varken ya da otomatikte engel yok; boş adım listesi engel', () => {
    const ctx = { routeChosen: true, hasTambur: false };
    expect(extrasIssues(extras({ woType: 'ORDER_PRODUCTION' }), ctx).map((i) => i.text).join(' ')).toMatch(/sipariş kalemi seçin/);
    expect(extrasIssues(extras({ woType: 'ORDER_PRODUCTION', orderLineIds: ['l1'] }), ctx)).toEqual([]);
    expect(extrasIssues(extras(), ctx)).toEqual([]);
    expect(extrasIssues(extras({ steps: [] }), ctx).map((i) => i.text).join(' ')).toMatch(/en az bir adım/);
  });

  it('kumaş değişince dokunulmuş özellik kümesi boşalır; dokunulmamış null kalır; rota değişince hepsi baştan', () => {
    const touched = editExtras({ ...initialFormState(), extras: extras({ propertyIds: ['p1'] }) }, { targetItemId: 'i2' });
    expect(touched.extras.propertyIds).toEqual([]);
    expect(editExtras(initialFormState(), { targetItemId: 'i2' }).extras.propertyIds).toBeNull();
    const reset = resetForRoute({ ...initialFormState(), extras: extras({ propertyIds: ['p1'], steps: [], machineId: 'm1', woType: 'STOCK_PRODUCTION' }) });
    expect(reset.extras.steps).toBeNull();
    expect(reset.extras.propertyIds).toBeNull();
    expect(reset.extras).not.toHaveProperty('machineId');
    expect(reset.extras.woType).toBe('STOCK_PRODUCTION');
  });

  it('kurşun adımı çıkarılınca / istasyonu değişince makine kararı düşer; başka adım değişince kalır', () => {
    const base = stepsFromRoute(route);
    expect(stepsDropMachine(base, removeStep(base, 'ts1'))).toBe(true);
    expect(stepsDropMachine(base, removeStep(base, 'ts2'))).toBe(false);
    expect(stepsDropMachine(base, moveStep(base, 'ts3', -1))).toBe(false);
    const other = addStep(removeStep(base, 'ts1'), st('kur2', { isKursunStation: true }) as never, 'n1');
    expect(stepsDropMachine(base, other)).toBe(true);
  });
});
