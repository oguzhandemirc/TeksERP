// Çok blok K2 (2026-11-06) tek form: "her parti ayrı" kipinde parti kartında kurşun gramajı + makinesi; gövde belge
// masasıyla aynı (`withDeskPlan`: parti başına targetValues / stepPlanning), üst makine gitmez.
// Negatif sonda: PartyRows `plan`ı çizmezse kart vakaları; `dropStalePartyMachines` hiç temizlemezse rota vakası kırmızı.
import React from 'react';
import { fireEvent, renderHook } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { DeskKursunMachine, InboundNoteDetail, NotePartiesView } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { initialMultiParty, type MultiPartyDraft } from './partyDraft';
import { buildCreateBody, initialRowForm, openedResult } from './woFromDoc';
import { buildExtraBody, EMPTY_EXTRAS } from './woForm';
import { mergeExtra, stepsFromRoute } from './woSteps';
import PartyRows from './PartyRows';
import { dropStalePartyMachines, partyGramajValue, partyMachineValue, partyPlanCtx, STEPS_EDITED_MACHINE_NOTE, type PartyPlanCtx } from './partyPlan';
import { usePartyPlan } from './usePartyPlan';
import type { DocRow, WoRowsState } from './useWoRows';

jest.mock('../../../../components/NumpadInput', () => {
  const RN = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string; onChangeText: (t: string) => void; testID?: string }) => <RN.TextInput value={p.value} onChangeText={p.onChangeText} testID={p.testID} /> };
});
// Seçici: görünürken her seçenek bir düğme (`secim-<değer>`).
jest.mock('../../../../components/PickerModal', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { visible: boolean; options: { value: string; label: string }[]; onSelect: (v: string) => void }) =>
      p.visible ? (
        <View>
          {p.options.map((o) => (
            <Pressable key={o.value} onPress={() => p.onSelect(o.value)} testID={`secim-${o.value}`}>
              <Text>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null,
  };
});

const machines: DeskKursunMachine[] = [
  { id: 'm1', code: 'K1', name: 'Kurşun 1', stationId: 'stK' },
  { id: 'm2', code: 'K2', name: 'Kurşun 2', stationId: 'stK' },
  { id: 'mx', code: 'T1', name: 'Tambur 1', stationId: 'stT' },
];
const route = {
  id: 'r1',
  name: 'Kurşun → Boya',
  steps: [
    { id: 's1', stationId: 'stK', sequence: 1, plannedMachineId: 'm2', station: { id: 'stK', name: 'Kurşun', kind: 'PROCESS', isKursunStation: true } },
    { id: 's2', stationId: 'stB', sequence: 2, station: { id: 'stB', name: 'Boya', kind: 'PROCESS' } },
  ],
} as unknown as ProductionRoute;
const gramaj = [{ id: 'g1', name: '40 gr', isDefault: true }, { id: 'g2', name: '60 gr' }];
const input = (x: Partial<Parameters<typeof partyPlanCtx>[0]> = {}) =>
  ({ perParty: true, route, allMachines: machines, stepsEdited: false, gramaj, commonGramajId: 'g1', defaultMachineId: 'm2', ...x });

const party = (blockNo: number) => ({ blockNo, batchNo: `P${blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 3, meters: 100 * blockNo, weightKg: null, warnings: [] });
const view: NotePartiesView = { parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'PER_PARTY' };
const detail = { id: 'n1', noteNo: 'GB-1', ownerCustomerId: 'c1', kursunMeters: '300', kursunMetersReview: false } as InboundNoteDetail;
const multiOf = (patch: Record<number, object> = {}): MultiPartyDraft => {
  const m = initialMultiParty(view)!;
  return { ...m, rows: m.rows.map((r) => ({ ...r, ...(patch[r.blockNo] ?? {}) })) };
};
const rowOf = (multi: MultiPartyDraft, result: DocRow['result'] = null): DocRow => ({
  noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail, gramajTouched: false, parties: view, result,
  form: { ...initialRowForm(detail), gramajValueId: 'g1', multi },
});

describe('partyPlanCtx (saf)', () => {
  it('⭐ yalnız "her parti ayrı"da; makine listesi rotanın kurşun istasyonundan', () => {
    expect(partyPlanCtx(input({ perParty: false }))).toBeNull();
    const ctx = partyPlanCtx(input())!;
    expect(ctx.machines.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(ctx.gramaj).toHaveLength(2);
    expect(ctx.machineNote).toBeNull();
  });
  it('⭐ adımlar düzenlendi → parti makinesi sorulmaz, neden yazılır (sunucu steps + parti planını 400\'ler)', () => {
    const ctx = partyPlanCtx(input({ stepsEdited: true }))!;
    expect(ctx.machines).toEqual([]);
    expect(ctx.defaultMachineId).toBeUndefined();
    expect(ctx.machineNote).toBe(STEPS_EDITED_MACHINE_NOTE);
  });
  it('kurşunsuz rota + boş katalog → sorulacak bir şey yok', () => {
    const noKursun = { ...route, steps: [route.steps![1]] } as ProductionRoute;
    expect(partyPlanCtx(input({ route: noKursun, gramaj: [] }))).toBeNull();
  });
  it('⭐ görünen değer: parti kararı > şablon/ortak; null "Sonra seçilsin" korunur', () => {
    const ctx = partyPlanCtx(input())!;
    const r = { blockNo: 1, batchNo: '', meters: 1 };
    expect(partyMachineValue(r, ctx)).toBe('m2');
    expect(partyMachineValue({ ...r, machineId: null }, ctx)).toBeNull();
    expect(partyMachineValue({ ...r, machineId: 'm1' }, ctx)).toBe('m1');
    expect(partyGramajValue(r, ctx)).toBe('g1');
    expect(partyGramajValue({ ...r, gramajValueId: 'g2' }, ctx)).toBe('g2');
  });
  it('⭐ rota değişti: listede olmayan parti makinesi karar-yok olur; "Sonra" ve geçerli seçim kalır', () => {
    const m = multiOf({ 1: { machineId: 'mx' }, 2: { machineId: null } });
    const fixed = dropStalePartyMachines(m, machines.slice(0, 2))!;
    expect(fixed.rows.map((r) => r.machineId)).toEqual([undefined, null]);
    expect(dropStalePartyMachines(multiOf({ 1: { machineId: 'm1' } }), machines.slice(0, 2))).toBeNull();
  });
});

describe('gövde (tek form = belge masası sözleşmesi)', () => {
  const save = (multi: MultiPartyDraft, stepsEdited = false) => {
    const f = rowOf(multi).form!;
    const body = buildCreateBody(f, { clientToken: 't', routeTemplateId: 'r1', gramajPropertyId: 'pG', kursunSequence: 1 });
    const steps = stepsEdited ? stepsFromRoute(route).slice(0, 1) : null;
    return mergeExtra(body, buildExtraBody({ ...EMPTY_EXTRAS, machineId: 'm1', steps }, { hasTambur: false, perParty: true, route }));
  };
  it('⭐ parti başına makine + gramaj partiye gider; dokunulmayan parti ortak değeri alır, üst makine gitmez', () => {
    const b = save(multiOf({ 1: { machineId: 'm1' }, 2: { gramajValueId: 'g2' } }));
    expect(b.stepPlanning).toBeUndefined();
    expect(b.mode).toBe('PER_PARTY');
    expect(b.parties![0].stepPlanning).toEqual([{ sequence: 1, plannedMachineId: 'm1' }]);
    expect(b.parties![0].targetValues).toBeUndefined();
    expect(b.targetValues).toEqual([{ propertyId: 'pG', valueId: 'g1' }]);
    expect(b.parties![1].targetValues).toEqual([{ propertyId: 'pG', valueId: 'g2' }]);
    expect(b.parties![1].stepPlanning).toBeUndefined();
  });
  it('"Sonra seçilsin" şablon makinesini açıkça ezer (null)', () => {
    expect(save(multiOf({ 2: { machineId: null } })).parties![1].stepPlanning).toEqual([{ sequence: 1, plannedMachineId: null }]);
  });
  it('düzenlenmiş adımlarla parti planı gitmez (sunucu 400 yerine ekranda not)', () => {
    const b = save(multiOf({ 1: { machineId: 'm1' } }), true);
    expect(b.steps).toBeDefined();
    expect(b.parties!.every((p) => p.stepPlanning === undefined)).toBe(true);
  });
});

describe('PartyRows + plan (tablet kartı)', () => {
  const ctx = partyPlanCtx(input()) as PartyPlanCtx;
  it('⭐ kartta gramaj + makine seçilir, partinin taslağına yazılır', () => {
    const setMulti = jest.fn();
    const wo = { setMulti } as unknown as WoRowsState;
    const multi = multiOf();
    const ui = renderWithPaper(<PartyRows row={rowOf(multi)} wo={wo} locked={false} plan={ctx} />);
    expect(ui.getByTestId('belge-parti-makine-GB-1-1')).toHaveTextContent(/Kurşun makinesi\s*2/);
    expect(ui.getByTestId('belge-parti-gramaj-GB-1-2')).toHaveTextContent(/40 gr/);
    fireEvent.press(ui.getByTestId('belge-parti-gramaj-GB-1-2'));
    fireEvent.press(ui.getByTestId('secim-g2'));
    expect(setMulti).toHaveBeenLastCalledWith('n1', { ...multi, rows: [multi.rows[0], { ...multi.rows[1], gramajValueId: 'g2' }] });
    fireEvent.press(ui.getByTestId('belge-parti-makine-GB-1-1'));
    fireEvent.press(ui.getByTestId('secim-__sonra__'));
    expect(setMulti).toHaveBeenLastCalledWith('n1', { ...multi, rows: [{ ...multi.rows[0], machineId: null }, multi.rows[1]] });
  });
  it('plan yoksa (belge masası / SINGLE) kart bugünkü gibi', () => {
    const ui = renderWithPaper(<PartyRows row={rowOf(multiOf())} wo={{ setMulti: jest.fn() } as unknown as WoRowsState} locked={false} />);
    expect(ui.queryByTestId('belge-parti-makine-GB-1-1')).toBeNull();
    expect(ui.queryByTestId('belge-parti-gramaj-GB-1-1')).toBeNull();
  });
  it('⭐ kısmi sonuçta açılan partinin seçicileri kilitli, düşen parti düzenlenebilir', () => {
    const partial = { workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1', rollId: 'r', workOrders: [{ blockNos: [1], workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1' }], failed: [{ blockNo: 2, code: null, message: 'x' }] };
    const ui = renderWithPaper(<PartyRows row={rowOf(multiOf(), openedResult(partial))} wo={{ setMulti: jest.fn() } as unknown as WoRowsState} locked={false} plan={ctx} />);
    expect(ui.getByTestId('belge-parti-makine-GB-1-1')).toBeDisabled();
    expect(ui.getByTestId('belge-parti-makine-GB-1-2')).not.toBeDisabled();
  });
});

describe('usePartyPlan', () => {
  it('⭐ rota kurşun istasyonu değişince eski parti makinesi temizlenir', () => {
    const setMulti = jest.fn();
    const wo = { setMulti, showGramaj: true, catalog: { propertyId: 'pG', options: gramaj } } as unknown as WoRowsState;
    const row = rowOf(multiOf({ 1: { machineId: 'mx' } }));
    const h = renderHook(() => usePartyPlan({ row, wo, route, allMachines: machines, stepsEdited: false }));
    expect(h.result.current?.machines).toHaveLength(2);
    expect(setMulti).toHaveBeenCalledWith('n1', expect.objectContaining({ rows: [expect.objectContaining({ blockNo: 1, machineId: undefined }), expect.anything()] }));
  });
});
