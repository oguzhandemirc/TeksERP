// Çok partili belge (S1, fabrika cevabı 16/17): parti özeti → satırda parti listesi + kip; kayıt gövdesine parties[] + mode +
// toplam metre; tek partide bugünkü form (multi null). PER_PARTY'de açılan bütün iş emirleri sonuçta.
// Negatif sonda: `initialMultiParty` tek partide de taslak döndürürse "tek parti → null" vakası kırmızı.
// T2 (2026-11-09): kip dokunuşu (`chooseMode`/`modeTouched`) yalnız gösterimdir, kip gövdeye HER ZAMAN gider; parti gelen kg'si
// yalnız elle değiştiyse. Negatif sonda: withParties `mode`u modeTouched'a bağlarsa "dokunulmamış kip de gider" kırmızı;
// kgEdited koşulu düşerse "öneri gövdeye girmez" kırmızı.
import React, { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InboundNoteDetail, NotePartiesView } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { TERIM } from '../../../../lib/terim';
import { chooseMode, initialMultiParty, modeRuleLine, multiPartyIssues, openedWorkOrders, withParties } from './partyDraft';
import { buildCreateBody, initialRowForm, rowIssues } from './woFromDoc';
import { useWoRows } from './useWoRows';

const mockSettings = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: { settings: () => mockSettings(), createWorkOrder: (id: string, b: unknown) => mockCreate(id, b), updateNote: jest.fn() },
}));
jest.mock('../../../../services/fabricProperty.service', () => ({ fabricPropertyService: { getKursunGramajCatalog: async () => ({ propertyId: null, options: [] }) } }));
jest.mock('../../../../services/travelerCardPrint', () => ({ printTravelerCardForWorkOrder: jest.fn() }));
jest.mock('./recentOwners', () => ({ loadRecentOwners: async () => [], rememberOwner: async (l: string[], id: string) => [id, ...l] }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const party = (blockNo: number, x: Record<string, unknown> = {}) => ({
  blockNo, batchNo: `P99187${32 + blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 5, meters: 586, weightKg: null, warnings: [], ...x,
});
const view = (x: Partial<NotePartiesView> = {}): NotePartiesView => ({
  parties: [party(1, { declaredTopCount: 4 }), party(2, { lineCount: 16, meters: 3935 })], warnings: ['1/2'], multi: true, defaultMode: 'SINGLE', ...x,
});
const detail = { id: 'n1', noteNo: 'GB-1', ownerCustomerId: 'c1', kursunMeters: '586', kursunMetersReview: false } as InboundNoteDetail;

beforeEach(() => jest.clearAllMocks());

describe('parti taslağı (saf)', () => {
  it('⭐ tek parti / bölümsüz / eski sunucu → null (bugünkü form)', () => {
    expect(initialMultiParty(null)).toBeNull();
    expect(initialMultiParty(view({ multi: false }))).toBeNull();
    expect(initialMultiParty(view({ parties: [party(1)] }))).toBeNull();
  });
  it('⭐ iki parti → satırlar + fabrika varsayılan kipi', () => {
    expect(initialMultiParty(view({ defaultMode: 'PER_PARTY' }))).toEqual({
      mode: 'PER_PARTY', defaultMode: 'PER_PARTY', modeSource: 'FACTORY', modeTouched: false,
      rows: [{ blockNo: 1, batchNo: 'P9918733', meters: 586, incomingKg: null }, { blockNo: 2, batchNo: 'P9918734', meters: 3935, incomingKg: null }],
    });
  });
  it('⭐ 214279: sunucunun önerdiği parti metresi (beyan ara toplamı) Σ satırın önüne geçer; öneri yoksa (eski sunucu) Σ satır', () => {
    const v = view({ parties: [party(1, { meters: 266.9, suggestedMeters: 586 }), party(2, { meters: 2345.5, suggestedMeters: 3935 })] });
    expect(initialMultiParty(v)!.rows.map((r) => r.meters)).toEqual([586, 3935]);
    expect(initialMultiParty(view({ parties: [party(1, { meters: 266.9 }), party(2, { meters: 0, suggestedMeters: null })] }))!.rows.map((r) => r.meters)).toEqual([266.9, null]);
  });
  it('⭐ gövde: parties[] + mode + kurşun metresi = parti toplamı; boş parti no null', () => {
    const m = initialMultiParty(view())!;
    m.rows[0]!.batchNo = ' ';
    const f = { ...initialRowForm(detail), multi: m };
    const b = buildCreateBody(f, { clientToken: 't', routeTemplateId: 'r1', gramajPropertyId: null });
    expect(b).toMatchObject({ mode: 'SINGLE', kursunMeters: '4521', parties: [{ blockNo: 1, batchNo: null, meters: 586 }, { blockNo: 2, batchNo: 'P9918734', meters: 3935 }] });
    expect(withParties(b, m).kursunMeters).toBe('4521');
  });
  it('⭐ T2 kip: dokunulmamış → kural metni + kaynak; farklı seçim → "sizin seçiminiz"; varsayılana dönüş dokunuşu siler', () => {
    const m = initialMultiParty(view({ defaultMode: 'PER_PARTY', defaultModeSource: 'TEMPLATE' }))!;
    expect(modeRuleLine(m)).toEqual({ text: `2 parti → 2 ${TERIM.terbiyeIsEmri.tekilKucuk}`, sourceText: 'şablon kuralı', touched: false });
    expect(modeRuleLine(initialMultiParty(view())!)).toEqual({ text: `2 parti → 1 ${TERIM.terbiyeIsEmri.tekilKucuk}`, sourceText: 'fabrika ayarı', touched: false });
    const mine = chooseMode(m, 'SINGLE');
    expect(mine.modeTouched).toBe(true);
    expect(modeRuleLine(mine)).toEqual({ text: 'Bu belge için: Tek İE', sourceText: 'sizin seçiminiz', touched: true });
    expect(chooseMode(mine, 'PER_PARTY').modeTouched).toBe(false);
  });
  it('⭐ T2 gövde: kip dokunulmasa da gider (ekranda yazan olur); dokununca seçilen gider', () => {
    const m = initialMultiParty(view({ defaultMode: 'PER_PARTY', defaultModeSource: 'TEMPLATE' }))!;
    expect(withParties({ clientToken: 't', ownerCustomerId: 'c', kursunMeters: '1' }, m).mode).toBe('PER_PARTY');
    expect(withParties({ clientToken: 't', ownerCustomerId: 'c', kursunMeters: '1' }, chooseMode(m, 'SINGLE')).mode).toBe('SINGLE');
  });
  it('⭐ T2 parti gelen kg: öneri forma dolar ama gövdeye girmez; elle değişen girer', () => {
    const m = initialMultiParty(view({ parties: [party(1, { suggestedKg: 120.5, kgSource: 'TOTAL' }), party(2, { suggestedKg: 0 })] }))!;
    expect(m.rows.map((r) => r.incomingKg)).toEqual([120.5, null]);
    const base = { clientToken: 't', ownerCustomerId: 'c', kursunMeters: '1' };
    expect(withParties(base, m).parties!.every((p) => !('incomingKg' in p))).toBe(true);
    const edited = { ...m, rows: m.rows.map((r) => (r.blockNo === 2 ? { ...r, incomingKg: 80, kgEdited: true } : r)) };
    expect(withParties(base, edited).parties).toEqual([{ blockNo: 1, batchNo: 'P9918733', meters: 586 }, { blockNo: 2, batchNo: 'P9918734', meters: 586, incomingKg: 80 }]);
  });
  it('eksik parti metresi engeller; tek partili formda parti kuralı yok', () => {
    const m = initialMultiParty(view())!;
    m.rows[1]!.meters = null;
    expect(multiPartyIssues(m)).toEqual(['Parti metresi eksik: P9918734.']);
    expect(rowIssues({ ...initialRowForm(detail), multi: m })).toEqual(['Parti metresi eksik: P9918734.']);
    expect(buildCreateBody(initialRowForm(detail), { clientToken: 't', routeTemplateId: 'r1', gramajPropertyId: null }).parties).toBeUndefined();
  });
  it('openedWorkOrders: çok partide liste, eski sunucuda tek kayıt', () => {
    expect(openedWorkOrders({ workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1', rollId: 'r' })).toEqual([{ workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1' }]);
    const two = openedWorkOrders({ workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1', rollId: 'r', workOrders: [{ blockNos: [1], workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1' }, { blockNos: [2], workOrderId: 'w2', workOrderNo: 'IE-2', batchNumber: 'P2' }] });
    expect(two.map((w) => w.workOrderNo)).toEqual(['IE-1', 'IE-2']);
  });
});

describe('useWoRows çok parti', () => {
  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(() => useWoRows({ id: 'r1', name: 'K', steps: [] } as unknown as ProductionRoute), { wrapper });
  }
  it('⭐ parti özeti form kurulduktan sonra liste kurar, kip seçimi gövdeye; PER_PARTY → iki iş emri sonuçta', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockResolvedValue({
      workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P9918733', rollId: 'r',
      workOrders: [{ blockNos: [1], workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P9918733' }, { blockNos: [2], workOrderId: 'w2', workOrderNo: 'IE-2', batchNumber: 'P9918734' }],
    });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    act(() => h.result.current.addNote({ id: 'n1', noteNo: 'GB-1' }, 1));
    act(() => h.result.current.setDetail('n1', detail));
    act(() => h.result.current.setParties('n1', view()));
    const multi = h.result.current.rows[0]!.form!.multi!;
    expect(multi.mode).toBe('SINGLE');
    act(() => h.result.current.setMulti('n1', { ...multi, mode: 'PER_PARTY' }));
    act(() => h.result.current.setParties('n1', view({ defaultMode: 'SINGLE' })));
    expect(h.result.current.rows[0]!.form!.multi!.mode).toBe('PER_PARTY');
    await act(async () => h.result.current.saveAll());
    expect(mockCreate).toHaveBeenCalledWith('n1', expect.objectContaining({ mode: 'PER_PARTY', kursunMeters: '4521' }));
    expect(h.result.current.rows[0]!.result).toMatchObject({ kind: 'OPENED', workOrders: [{ workOrderNo: 'IE-1' }, { workOrderNo: 'IE-2' }] });
  });
  it('tek partili belge (özet multi=false) → form bugünkü gibi, gövdede parti yok', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockResolvedValue({ workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1', rollId: 'r' });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    act(() => h.result.current.addNote({ id: 'n1', noteNo: 'GB-1' }, 1));
    act(() => h.result.current.setDetail('n1', detail));
    act(() => h.result.current.setParties('n1', view({ multi: false, parties: [party(1)] })));
    expect(h.result.current.rows[0]!.form!.multi).toBeNull();
    await act(async () => h.result.current.saveAll());
    expect(mockCreate.mock.calls[0]![1]).not.toHaveProperty('parties');
  });
});
