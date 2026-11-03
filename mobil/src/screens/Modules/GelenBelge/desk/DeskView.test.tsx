// Belge masası (K23): okunan belge → TEK inceleme; hazır İE ön seçimi sunucu önerisinden, kullanıcının seçimi korunur;
// "İş emri oluştur" → bildirim + son oluşturulanlar şeridi + DOĞRUDAN kameraya dönüş; çift dokunuş tek istek;
// ağ hatası → inceleme açık kalır, yeniden deneme aynı clientToken.
import React, { useEffect } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import Toast from 'react-native-toast-message';
import { renderWithPaper } from '../../../../test/render';
import type { ProductionRoute } from '../../../../services/route.service';
import type { DocRow, WoRowsState } from '../woCreate/useWoRows';
import DeskView from './DeskView';

const mockCreate = jest.fn();
const mockSuggest = jest.fn();
const mockFinish = jest.fn();
let mockDone: { note: { id: string; noteNo: string }; pages: number; runKey: number } | null = null;
let mockParties: unknown = null;
const mockAutoRefs: unknown[] = [];

jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    settings: async () => ({ formApproval: 'WITH_WORK_ORDER' }),
    createWorkOrder: (id: string, b: unknown) => mockCreate(id, b),
    updateNote: jest.fn(),
    tabletContext: async () => ({ success: true, data: { customers: [{ id: 'c1', name: 'Müşteri 1' }], kursunMachines: [{ id: 'm-1', code: 'K1', name: 'Kurşun 1', stationId: 's-k' }] } }),
    routeSuggestion: (owner: string | null) => mockSuggest(owner),
  },
}));
jest.mock('../../../../services/fabricProperty.service', () => ({
  fabricPropertyService: { getKursunGramajCatalog: async () => ({ propertyId: null, options: [] }), getKursunCustomerDefaults: async () => ({}) },
}));
jest.mock('../../../../services/travelerCardPrint', () => ({ printTravelerCardForWorkOrder: jest.fn() }));
jest.mock('../woCreate/recentOwners', () => ({ loadRecentOwners: async () => [], rememberOwner: async (l: string[], id: string) => [id, ...l] }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../useDocScan', () => ({
  useDocScan: () => ({ done: mockDone, pages: [], sending: false, capture: jest.fn(), send: jest.fn(), setPages: jest.fn(), finish: () => mockFinish() }),
}));
jest.mock('./DeskCamera', () => {
  const { Text: T } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (p: { recent: { workOrderNos: string[] }[]; autoState?: unknown }) => {
      mockAutoRefs.push(p.autoState);
      return <T testID="masa-kamera">{`son:${p.recent.map((r) => r.workOrderNos.join('+')).join('|')}`}</T>;
    },
  };
});
// Okuma bağlanmaz: kart takıldığında belge detayı gelmiş sayılır (form dolar).
function MockDocRowCard({ row, wo }: { row: DocRow; wo: WoRowsState }) {
  const { setDetail, setParties } = wo;
  useEffect(() => {
    if (!row.detail) setDetail(row.noteId, { id: row.noteId, noteNo: row.noteNo, ownerCustomerId: 'c1', kursunMeters: '100', kursunMetersReview: false } as never);
  }, [row.detail, row.noteId, row.noteNo, setDetail]);
  useEffect(() => {
    if (row.form && row.parties === undefined && mockParties) setParties(row.noteId, mockParties as never);
  }, [row.form, row.parties, row.noteId, setParties]);
  return <Text testID="belge-karti">{`${row.noteNo}:${row.result?.kind ?? '-'}`}</Text>;
}
jest.mock('../woCreate/DocRowCard', () => ({ __esModule: true, default: (p: { row: DocRow; wo: WoRowsState }) => <MockDocRowCard {...p} /> }));

const kursun = { station: { isKursunStation: true }, stationId: 's-k', sequence: 1 };
const sc = (id: string, name: string, order: number) => ({ id, name, isWorkOrderShortcut: true, shortcutOrder: order, isActive: true, steps: [kursun] }) as unknown as ProductionRoute;
const SHORTCUTS = [sc('r1', 'Kurşun&KK', 1), sc('r2', 'Kurşun&DetayKK', 2)];

function renderWithNote() {
  mockDone = { note: { id: 'n1', noteNo: 'GB-1' }, pages: 1, runKey: 1 };
  return renderWithPaper(<DeskView shortcuts={SHORTCUTS} />);
}
const opened = (no: string) => ({ workOrderId: `wo-${no}`, workOrderNo: no, batchNumber: 'P-1', rollId: 'x' });
const bodyOf = (i: number) => mockCreate.mock.calls[i][1] as { routeTemplateId: string; clientToken: string; stepPlanning?: unknown };

beforeEach(() => {
  jest.clearAllMocks();
  mockDone = null;
  mockParties = null;
  mockAutoRefs.length = 0;
  mockSuggest.mockResolvedValue({ routeTemplateId: null, routeName: null, source: null });
});

describe('DeskView', () => {
  it('belge yokken kamera açık bekler', () => {
    const s = renderWithPaper(<DeskView shortcuts={SHORTCUTS} />);
    expect(s.getByTestId('masa-kamera')).toBeTruthy();
  });

  it('⭐ ön seçim: sunucu önerisi (müşterinin son İE rotası) kısayolsa o gider', async () => {
    mockSuggest.mockResolvedValue({ routeTemplateId: 'r2', routeName: 'Kurşun&DetayKK', source: 'LAST_WORK_ORDER' });
    mockCreate.mockResolvedValue(opened('IE-1'));
    const s = renderWithNote();
    await waitFor(() => expect(mockSuggest).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(s.getByTestId('masa-olustur')).not.toBeDisabled());
    fireEvent.press(s.getByTestId('masa-olustur'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).routeTemplateId).toBe('r2');
  });

  it('öneri kısayol değilse yok sayılır; dokunulan kısayol + makine gövdeye gider', async () => {
    mockSuggest.mockResolvedValue({ routeTemplateId: 'r-baska', routeName: 'Normal', source: 'FACTORY_DEFAULT' });
    mockCreate.mockResolvedValue(opened('IE-1'));
    const s = renderWithNote();
    await waitFor(() => expect(s.getByTestId('masa-olustur')).not.toBeDisabled());
    fireEvent.press(s.getByTestId('masa-kisayol-Kurşun&DetayKK'));
    fireEvent.press(s.getByTestId('masa-makine-K1'));
    fireEvent.press(s.getByTestId('masa-olustur'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(bodyOf(0)).toMatchObject({ routeTemplateId: 'r2', stepPlanning: [{ sequence: 1, plannedMachineId: 'm-1' }] });
  });

});

describe('DeskView — kip ve dönüş', () => {
  it('⭐ çok parti + "Tek iş emri" kipi: tek makine seçilir, gövdeye ÜST düzey gider; parti başına seçim çizilmez', async () => {
    const party = (blockNo: number, meters: number) => ({ blockNo, batchNo: `P${blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 1, meters, weightKg: null, warnings: [] });
    mockParties = { multi: true, defaultMode: 'SINGLE', warnings: [], parties: [party(1, 40), party(2, 60)] };
    mockCreate.mockResolvedValue(opened('IE-1'));
    const s = renderWithNote();
    await waitFor(() => expect(s.getByTestId('masa-olustur')).not.toBeDisabled());
    await waitFor(() => expect(s.getByTestId('masa-makine-K1')).toBeTruthy());
    expect(s.queryByTestId('masa-parti-makine-1')).toBeNull();
    fireEvent.press(s.getByTestId('masa-makine-K1'));
    fireEvent.press(s.getByTestId('masa-olustur'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const body = bodyOf(0) as { mode?: string; stepPlanning?: unknown; parties?: Record<string, unknown>[] };
    expect(body).toMatchObject({ mode: 'SINGLE', stepPlanning: [{ sequence: 1, plannedMachineId: 'm-1' }] });
    expect(body.parties?.every((p) => !('stepPlanning' in p) && !('targetValues' in p))).toBe(true);
  });

  it('⭐ oluştur → İE no bildirimi + son oluşturulanlar şeridi + kameraya dönüş', async () => {
    mockCreate.mockResolvedValue(opened('IE-7'));
    const s = renderWithNote();
    await waitFor(() => expect(s.getByTestId('masa-olustur')).not.toBeDisabled());
    mockDone = null; // taslak bitince tarayıcı sıfırlanır (b.finish)
    fireEvent.press(s.getByTestId('masa-olustur'));
    await waitFor(() => expect(s.getByTestId('masa-kamera').props.children).toBe('son:IE-7'));
    expect(mockFinish).toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: expect.stringContaining('IE-7') }));
    expect(bodyOf(0).routeTemplateId).toBe('r1');
  });

  it('⭐ okut → inceleme → oluştur → kameraya dönüş: otomatik çekim durumu (boş masa referansı) AYNI ref ile sürer', async () => {
    mockCreate.mockResolvedValue(opened('IE-8'));
    const s = renderWithPaper(<DeskView shortcuts={SHORTCUTS} />);
    const before = mockAutoRefs[mockAutoRefs.length - 1];
    expect(before).toBeTruthy();
    mockDone = { note: { id: 'n1', noteNo: 'GB-1' }, pages: 1, runKey: 1 };
    s.rerender(<DeskView shortcuts={SHORTCUTS} />);
    await waitFor(() => expect(s.getByTestId('masa-olustur')).not.toBeDisabled());
    expect(s.queryByTestId('masa-kamera')).toBeNull(); // kamera inceleme boyunca söker
    mockDone = null;
    fireEvent.press(s.getByTestId('masa-olustur'));
    await waitFor(() => expect(s.getByTestId('masa-kamera')).toBeTruthy());
    expect(mockAutoRefs[mockAutoRefs.length - 1]).toBe(before);
  });

  it('⭐ çift dokunuş → tek istek', async () => {
    let release!: (v: unknown) => void;
    mockCreate.mockImplementation(() => new Promise((r) => { release = r; }));
    const s = renderWithNote();
    await waitFor(() => expect(s.getByTestId('masa-olustur')).not.toBeDisabled());
    mockDone = null;
    const btn = s.getByTestId('masa-olustur');
    fireEvent.press(btn);
    fireEvent.press(btn);
    await act(async () => release(opened('IE-1')));
    await waitFor(() => expect(s.getByTestId('masa-kamera')).toBeTruthy());
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('⭐ ağ hatası → inceleme açık kalır; yeniden deneme AYNI clientToken (çift İE yok)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(opened('IE-2'));
    const s = renderWithNote();
    await waitFor(() => expect(s.getByTestId('masa-olustur')).not.toBeDisabled());
    fireEvent.press(s.getByTestId('masa-olustur'));
    await waitFor(() => expect(s.getByTestId('belge-karti').props.children).toBe('GB-1:FAILED'));
    expect(s.queryByTestId('masa-kamera')).toBeNull();
    mockDone = null;
    fireEvent.press(s.getByTestId('masa-olustur'));
    await waitFor(() => expect(s.getByTestId('masa-kamera')).toBeTruthy());
    expect(bodyOf(1).clientToken).toBe(bodyOf(0).clientToken);
  });
});
