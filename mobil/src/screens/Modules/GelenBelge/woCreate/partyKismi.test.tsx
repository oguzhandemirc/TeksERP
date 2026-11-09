// Çok blok D6 (2026-11-06): parti kartı künyesi (işlem + müşteri İE no), K1 "her parti ayrı" varsayılanında kip seçimi yok,
// PER_PARTY kısmi başarı: düşen parti kartta nedeniyle görünür, satır açık kalır, yeniden gönderim YENİ token'la gider,
// önceki denemede açılmış (existing) İE yeniden basılmaz.
// Negatif sonda: `isDone` kısmi sonucu da kapalı sayarsa "satır açık kalır / yeniden gönderilir" vakası kırmızı.
import React, { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithPaper } from '../../../../test/render';
import type { InboundNoteDetail, NotePartiesView } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { initialMultiParty, partyFacts, partyHeading, partyOutcome, partyResultSummary, showModeChoice } from './partyDraft';
import { initialRowForm, openedResult } from './woFromDoc';
import PartyRows from './PartyRows';
import { TERIM } from '../../../../lib/terim';
import { useWoRows, type DocRow, type WoRowsState } from './useWoRows';
import { isDone, isPartial } from './docRow';

// Çok partide parti panoları sekmelidir (2026-11-09); gizli sekmenin içeriği de sınanır.
const HIDDEN = { includeHiddenElements: true };
const mockSettings = jest.fn();
const mockCreate = jest.fn();
const mockPrint = jest.fn();
jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: { settings: () => mockSettings(), createWorkOrder: (id: string, b: unknown) => mockCreate(id, b), updateNote: jest.fn() },
}));
jest.mock('../../../../services/fabricProperty.service', () => ({ fabricPropertyService: { getKursunGramajCatalog: async () => ({ propertyId: null, options: [] }) } }));
jest.mock('../../../../services/travelerCardPrint', () => ({ printTravelerCardForWorkOrder: (id: string) => mockPrint(id) }));
jest.mock('./recentOwners', () => ({ loadRecentOwners: async () => [], rememberOwner: async (l: string[], id: string) => [id, ...l] }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../../components/NumpadInput', () => {
  const RN = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string; onChangeText: (t: string) => void; testID?: string; editable?: boolean }) => <RN.TextInput value={p.value} onChangeText={p.onChangeText} testID={p.testID} editable={p.editable} /> };
});

const party = (blockNo: number, x: Record<string, unknown> = {}) => ({
  blockNo, batchNo: `P26187${32 + blockNo}`, orderNo: '56967', declaredTopCount: 16, declaredMeters: null, lineCount: 15, meters: 3935, weightKg: null, warnings: [], ...x,
});
const view = (x: Partial<NotePartiesView> = {}): NotePartiesView => ({
  parties: [party(1, { processText: 'KDK APRE', senderWorkOrderNo: '24749' }), party(2)], warnings: [], multi: true, defaultMode: 'PER_PARTY', ...x,
});
const detail = { id: 'n1', noteNo: 'GB-1', ownerCustomerId: 'c1', kursunMeters: '7870', kursunMetersReview: false } as InboundNoteDetail;
const wo = (blockNo: number, x: Record<string, unknown> = {}) => ({ blockNos: [blockNo], workOrderId: `w${blockNo}`, workOrderNo: `IE-${blockNo}`, batchNumber: `P${blockNo}`, ...x });
const partial = { workOrderId: 'w1', workOrderNo: 'IE-1', batchNumber: 'P1', rollId: 'r', workOrders: [wo(1)], failed: [{ blockNo: 2, code: 'VALIDATION', message: 'Plan makinesi bulunamadı' }] };

beforeEach(() => jest.clearAllMocks());

describe('parti kartı (saf)', () => {
  it('⭐ künye: işlem + müşteri İE no yazılır; eski sunucu alanları yoksa yazılmaz', () => {
    expect(partyHeading(1, view().parties[0])).toBe('1. parti · 15 satır / 16 TOP · Sipariş 56967 · İşlem: KDK APRE · Müşteri İE 24749');
    expect(partyHeading(2, view().parties[1])).toBe('2. parti · 15 satır / 16 TOP · Sipariş 56967');
  });
  it('⭐ künye parçaları ayrı (kartta parça sınırında kırılır); parti yoksa boş', () => {
    expect(partyFacts(view().parties[0])).toEqual(['15 satır / 16 TOP', 'Sipariş 56967', 'İşlem: KDK APRE', 'Müşteri İE 24749']);
    expect(partyFacts(undefined)).toEqual([]);
  });
  it('⭐ kısmi özet: yalnız düşen parti varken; tam başarıda / sonuçsuz null', () => {
    const r = openedResult(partial);
    const opened = r.kind === 'OPENED' ? r : null;
    expect(partyResultSummary(opened, [1, 2])).toBe('1/2 parti açıldı · 1 parti açılamadı — nedeni kartında; düzeltip yeniden kaydedin');
    const full = openedResult({ ...partial, failed: [] });
    expect(partyResultSummary(full.kind === 'OPENED' ? full : null, [1])).toBeNull();
    expect(partyResultSummary(null, [1, 2])).toBeNull();
  });
  it('⭐ K1: varsayılan "her parti ayrı" → kip seçimi yok; SINGLE varsayılanında seçim kalır', () => {
    expect(showModeChoice(view())).toBe(false);
    expect(showModeChoice(view({ defaultMode: 'SINGLE' }))).toBe(true);
  });
  it('⭐ kısmi sonuç: parti başına açıldı/açılamadı; satır kapanmaz (isPartial), tam başarıda kapanır', () => {
    const r = openedResult(partial);
    expect(partyOutcome(r.kind === 'OPENED' ? r : null, 1)).toEqual({ kind: 'OPENED', workOrderNo: 'IE-1' });
    expect(partyOutcome(r.kind === 'OPENED' ? r : null, 2)).toEqual({ kind: 'FAILED', message: 'Plan makinesi bulunamadı' });
    const row = { result: r } as DocRow;
    expect(isPartial(row)).toBe(true);
    expect(isDone(row)).toBe(false);
    expect(isDone({ result: openedResult({ ...partial, failed: [] }) } as DocRow)).toBe(true);
  });
});

describe('PartyRows (tablet)', () => {
  const rowOf = (result: DocRow['result'], v = view()): DocRow => ({
    noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail, gramajTouched: false, parties: v, result,
    form: { ...initialRowForm(detail), multi: initialMultiParty(v) },
  });
  const noop = { setMulti: jest.fn() } as unknown as WoRowsState;
  it('⭐ K1: PER_PARTY varsayılanında kip çipleri çizilmez; künye görünür', () => {
    const ui = renderWithPaper(<PartyRows row={rowOf(null)} wo={noop} locked={false} />);
    expect(ui.queryByTestId('belge-parti-kip-GB-1-SINGLE')).toBeNull();
    expect(ui.getByText('İşlem: KDK APRE', HIDDEN)).toBeTruthy();
    expect(ui.getByText('Müşteri İE 24749', HIDDEN)).toBeTruthy();
    expect(ui.queryByTestId('belge-parti-ozet-GB-1')).toBeNull();
    const single = renderWithPaper(<PartyRows row={rowOf(null, view({ defaultMode: 'SINGLE' }))} wo={noop} locked={false} />);
    expect(single.getByTestId('belge-parti-kip-GB-1-SINGLE')).toBeTruthy();
  });
  it('⭐ kısmi sonuç: açılan parti kilitli + İE no, düşen parti nedeniyle ve düzenlenebilir', () => {
    const ui = renderWithPaper(<PartyRows row={rowOf(openedResult(partial))} wo={noop} locked={false} />);
    expect(ui.getByTestId('belge-parti-sonuc-GB-1-1', HIDDEN)).toHaveTextContent(`${TERIM.terbiyeIsEmri.tekil} açıldı: IE-1`);
    expect(ui.getByTestId('belge-parti-sonuc-GB-1-2', HIDDEN)).toHaveTextContent('Açılamadı: Plan makinesi bulunamadı');
    expect(ui.getByTestId('belge-parti-ozet-GB-1')).toHaveTextContent(/1\/2 parti açıldı · 1 parti açılamadı/);
    expect(ui.getByTestId('belge-parti-metre-GB-1-1', HIDDEN).props.accessibilityState).toMatchObject({ disabled: true });
    expect(ui.getByTestId('belge-parti-metre-GB-1-2', HIDDEN).props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('useWoRows PER_PARTY kısmi başarı', () => {
  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return renderHook(() => useWoRows({ id: 'r1', name: 'K', steps: [] } as unknown as ProductionRoute), { wrapper });
  }
  it('⭐ düşen parti satırı açık tutar; yeniden gönderim yeni token, existing İE yeniden basılmaz, sonra satır kapanır', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER', refakatAutoPrint: true });
    mockPrint.mockResolvedValue(undefined);
    mockCreate.mockResolvedValueOnce(partial).mockResolvedValueOnce({ ...partial, workOrders: [wo(1, { existing: true }), wo(2)], failed: [] });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    act(() => h.result.current.addNote({ id: 'n1', noteNo: 'GB-1' }, 1));
    act(() => h.result.current.setDetail('n1', detail));
    act(() => h.result.current.setParties('n1', view()));
    await act(async () => h.result.current.saveAll());
    expect(isPartial(h.result.current.rows[0]!)).toBe(true);
    expect(h.result.current.counts.ready).toBe(1);
    expect(mockPrint.mock.calls.map((c) => c[0])).toEqual(['w1']);
    const multi = h.result.current.rows[0]!.form!.multi!;
    act(() => h.result.current.setMulti('n1', { ...multi, rows: multi.rows.map((r) => (r.blockNo === 2 ? { ...r, meters: 3900 } : r)) }));
    expect(isPartial(h.result.current.rows[0]!)).toBe(true);
    await act(async () => h.result.current.saveAll());
    const [first, second] = mockCreate.mock.calls.map((c) => (c[1] as { clientToken: string }).clientToken);
    expect(second).not.toBe(first);
    expect(mockPrint.mock.calls.map((c) => c[0])).toEqual(['w1', 'w2']);
    expect(isDone(h.result.current.rows[0]!)).toBe(true);
  });
});
