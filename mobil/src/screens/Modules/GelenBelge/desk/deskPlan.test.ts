// Belge masası saf parçaları (K23): kısayol ön seçimi, kurşun adımı/makineler, parti başına plan gövdesi.
import type { ProductionRoute } from '../../../../services/route.service';
import { buildCreateBody, type RowForm } from '../woCreate/woFromDoc';
import { kursunStepOf, machinesForRoute, pickShortcut, pushRecentWo, withDeskPlan } from './deskPlan';

const route = (id: string, steps: { seq: number; st: string; kursun?: boolean }[] = []) =>
  ({ id, name: id, isWorkOrderShortcut: true, steps: steps.map((s) => ({ id: `${id}-${s.seq}`, stationId: s.st, sequence: s.seq, station: { id: s.st, name: s.st, isKursunStation: !!s.kursun } })) }) as ProductionRoute;

const A = route('A', [{ seq: 1, st: 'K1', kursun: true }, { seq: 2, st: 'T' }]);
const B = route('B', [{ seq: 1, st: 'K2', kursun: true }, { seq: 2, st: 'DKK' }, { seq: 3, st: 'T' }]);

describe('pickShortcut', () => {
  it('kullanıcı seçimi > sunucu önerisi > ilk kısayol', () => {
    expect(pickShortcut([A, B], {})?.id).toBe('A');
    expect(pickShortcut([A, B], { suggestedId: 'B' })?.id).toBe('B');
    expect(pickShortcut([A, B], { suggestedId: 'B', touchedId: 'A' })?.id).toBe('A');
  });
  it('kısayol olmayan öneri yok sayılır; kısayol yoksa null', () => {
    expect(pickShortcut([A, B], { suggestedId: 'X' })?.id).toBe('A');
    expect(pickShortcut([], { suggestedId: 'A' })).toBeNull();
  });
});

describe('kurşun adımı ve makineler', () => {
  const machines = [
    { id: 'm1', code: 'K1-1', name: 'Kurşun 1', stationId: 'K1' },
    { id: 'm2', code: 'K2-1', name: 'Kurşun 2', stationId: 'K2' },
  ];
  it('rotanın kurşun istasyonunun makineleri', () => {
    expect(kursunStepOf(B)).toEqual({ sequence: 1, stationId: 'K2' });
    expect(machinesForRoute(A, machines).map((m) => m.id)).toEqual(['m1']);
    expect(machinesForRoute(route('C', [{ seq: 1, st: 'T' }]), machines)).toEqual([]);
  });
});

describe('withDeskPlan / buildCreateBody', () => {
  const base: RowForm = { ownerCustomerId: 'c1', ownerSuggested: null, ownerAsk: null, ourBatchNo: 'P1', ourBatchNoKey: null, meters: 100, metersReview: false, gramajValueId: 'g40' };
  // K22: gövde gramajı yalnız elle dokunulduysa taşır.
  const opts = { clientToken: 't', routeTemplateId: 'A', gramajPropertyId: 'prop', gramajTouched: true };

  it('makine seçilmediyse gövde bugünküyle aynı (stepPlanning yok)', () => {
    const body = buildCreateBody(base, { ...opts, kursunSequence: 1 });
    expect(body.stepPlanning).toBeUndefined();
    expect(body.targetValues).toEqual([{ propertyId: 'prop', valueId: 'g40' }]);
  });

  it('tek parti: makine kurşun adımına plan olarak gider', () => {
    expect(buildCreateBody({ ...base, machineId: 'm1' }, { ...opts, kursunSequence: 1 }).stepPlanning).toEqual([{ sequence: 1, plannedMachineId: 'm1' }]);
  });

  it('kurşun adımı yoksa makine gitmez', () => {
    expect(buildCreateBody({ ...base, machineId: 'm1' }, opts).stepPlanning).toBeUndefined();
  });

  it('çok parti: parti başına makine + gramaj; seçimsiz parti ortak değerde kalır', () => {
    const multi = { mode: 'PER_PARTY' as const, rows: [{ blockNo: 1, batchNo: 'P1', meters: 50, machineId: 'm1', gramajValueId: 'g25' }, { blockNo: 2, batchNo: 'P2', meters: 70 }] };
    const body = buildCreateBody({ ...base, multi }, { ...opts, kursunSequence: 2 });
    expect(body.parties?.[0]).toMatchObject({ blockNo: 1, stepPlanning: [{ sequence: 2, plannedMachineId: 'm1' }], targetValues: [{ propertyId: 'prop', valueId: 'g25' }] });
    expect(body.parties?.[1]).toEqual({ blockNo: 2, batchNo: 'P2', meters: 70 });
    expect(body.targetValues).toEqual([{ propertyId: 'prop', valueId: 'g40' }]);
  });

  it('çok parti + SINGLE: parti seçimleri gitmez (sunucu okumaz), makine üst düzeye gider', () => {
    const multi = { mode: 'SINGLE' as const, rows: [{ blockNo: 1, batchNo: 'P1', meters: 50, machineId: 'm2', gramajValueId: 'g25' }, { blockNo: 2, batchNo: 'P2', meters: 70 }] };
    const body = buildCreateBody({ ...base, machineId: 'm1', multi }, { ...opts, kursunSequence: 1 });
    expect(body.stepPlanning).toEqual([{ sequence: 1, plannedMachineId: 'm1' }]);
    expect(body.parties).toEqual([{ blockNo: 1, batchNo: 'P1', meters: 50 }, { blockNo: 2, batchNo: 'P2', meters: 70 }]);
  });

  it('çok parti + PER_PARTY: ekranda görünmeyen üst makine yedek olarak gitmez', () => {
    const multi = { mode: 'PER_PARTY' as const, rows: [{ blockNo: 1, batchNo: 'P1', meters: 50 }, { blockNo: 2, batchNo: 'P2', meters: 70 }] };
    expect(buildCreateBody({ ...base, machineId: 'm1', multi }, { ...opts, kursunSequence: 1 }).stepPlanning).toBeUndefined();
  });

  it('withDeskPlan girdiyi değiştirmez', () => {
    const body = { clientToken: 't', ownerCustomerId: 'c', kursunMeters: '1', routeTemplateId: 'A' };
    withDeskPlan(body, { machineId: 'm1' }, { kursunSequence: 1, gramajPropertyId: null });
    expect(body).not.toHaveProperty('stepPlanning');
  });
});

describe('pushRecentWo', () => {
  it('en yeni başta, aynı belge tekrarlanmaz, tavan', () => {
    const l = pushRecentWo(pushRecentWo([], { noteNo: 'N1', workOrderNos: ['W1'], at: 1 }), { noteNo: 'N2', workOrderNos: ['W2'], at: 2 });
    expect(l.map((x) => x.noteNo)).toEqual(['N2', 'N1']);
    expect(pushRecentWo(l, { noteNo: 'N1', workOrderNos: ['W3'], at: 3 }).map((x) => x.noteNo)).toEqual(['N1', 'N2']);
    expect(pushRecentWo(l, { noteNo: 'N9', workOrderNos: [], at: 9 }, 2)).toHaveLength(2);
  });
});
