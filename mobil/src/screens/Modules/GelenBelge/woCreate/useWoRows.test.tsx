// Belgeden iş emri kayıt döngüsü (K7/K8): ayar kipine göre POST ya da taslak PATCH; toplu kayıtta satır başına sonuç.
import React, { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InboundNoteDetail } from '../../../../services/inboundDoc.service';
import type { ProductionRoute } from '../../../../services/route.service';
import { useWoRows } from './useWoRows';

const mockSettings = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockPrint = jest.fn();

jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    settings: () => mockSettings(),
    createWorkOrder: (id: string, b: unknown) => mockCreate(id, b),
    updateNote: (id: string, b: unknown) => mockUpdate(id, b),
  },
}));
const mockCatalog = jest.fn(async () => ({ propertyId: null as string | null, options: [] as { id: string; name: string; isDefault: boolean }[] }));
jest.mock('../../../../services/fabricProperty.service', () => ({
  fabricPropertyService: { getKursunGramajCatalog: () => mockCatalog() },
  FOLD_PROPERTY_CODE: 'KAT',
}));
// K22: ön seçim sunucu çözücüsünden — müşteri başına gramaj (c1 → g1; diğerleri istasyonun g2'si).
const mockGet = jest.fn(async (url: string) => {
  const c = new URLSearchParams(url.split('?')[1]).get('customerId');
  const valueId = c === 'c1' ? 'g1' : 'g2';
  // p-br: formda alanı olmayan seçim varsayılanı (gövdeye aynen iletilir); KAT kolon-projeksiyonu sunucuda (iletilmez).
  const targets = [
    { propertyId: 'p-gr', propertyCode: 'GR', valueType: 'CHOICE', valueId },
    { propertyId: 'p-br', propertyCode: 'BR', valueType: 'CHOICE', valueId: 'b1' },
    { propertyId: 'p-kat', propertyCode: 'KAT', valueType: 'CHOICE', valueId: 'k4' },
  ];
  return { data: { data: [{ stationId: 's-k', targets }, { stationId: 's-t', targets }] } };
});
jest.mock('../../../../services/api', () => ({ apiClient: { get: (u: string) => mockGet(u) } }));
jest.mock('../../../../services/travelerCardPrint', () => ({ printTravelerCardForWorkOrder: (id: string) => mockPrint(id) }));
jest.mock('./recentOwners', () => ({ loadRecentOwners: async () => [], rememberOwner: async (l: string[], id: string) => [id, ...l] }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const route = { id: 'r1', name: 'Kurşun&Tambur', steps: [] } as unknown as ProductionRoute;
const detail = (id: string, x: Partial<InboundNoteDetail> = {}) =>
  ({ id, noteNo: `GB-${id}`, ownerCustomerId: 'c1', kursunMeters: '100', kursunMetersReview: false, ...x }) as InboundNoteDetail;

function setup(r: ProductionRoute = route) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useWoRows(r), { wrapper });
}

async function withRows(h: ReturnType<typeof setup>, details: InboundNoteDetail[]) {
  act(() => {
    details.forEach((d, i) => h.result.current.addNote({ id: d.id, noteNo: d.noteNo }, i + 1));
  });
  act(() => {
    details.forEach((d) => h.result.current.setDetail(d.id, d));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useWoRows', () => {
  it('⭐ ayar WITH_WORK_ORDER: toplu kayıt satır başına sonuç (biri açıldı, review bekleyen engellendi, biri hata)', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockImplementation(async (id: string) => {
      if (id === 'n3') throw Object.assign(new Error('Çakışma'), { status: 409 });
      return { workOrderId: `wo-${id}`, workOrderNo: `IE-${id}`, batchNumber: 'P-1', rollId: 'roll' };
    });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1'), detail('n2', { kursunMetersReview: true }), detail('n3')]);
    await act(async () => h.result.current.saveAll());
    const res = Object.fromEntries(h.result.current.rows.map((r) => [r.noteId, r.result?.kind]));
    expect(res).toEqual({ n1: 'OPENED', n2: 'FAILED', n3: 'FAILED' });
    expect(mockCreate).toHaveBeenCalledTimes(2); // review bekleyen satır sunucuya gitmez
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ ownerCustomerId: 'c1', kursunMeters: '100', routeTemplateId: 'r1' });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(h.result.current.counts).toMatchObject({ opened: 1, failed: 2 });
  });

  it('⭐ ayar kapalı (SEPARATE, varsayılan): POST YOK, değişen alan PATCH, satır taslak', async () => {
    mockSettings.mockResolvedValue({});
    const h = setup();
    await waitFor(() => expect(mockSettings).toHaveBeenCalled());
    await withRows(h, [detail('n1')]);
    act(() => h.result.current.updateForm('n1', { meters: 120 }));
    await act(async () => h.result.current.saveAll());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith('n1', { kursunMeters: 120 });
    expect(h.result.current.rows[0].result?.kind).toBe('DRAFT');
  });

  it('ayar okunamadı → deneme; sunucu 403 FORM_APPROVAL_DISABLED → taslağa düşer', async () => {
    mockSettings.mockRejectedValue(Object.assign(new Error('yetki'), { status: 403 }));
    mockCreate.mockRejectedValue({ status: 403, details: { code: 'GELEN_BELGE_FORM_APPROVAL_DISABLED' }, message: 'kapalı' });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('UNKNOWN'));
    await withRows(h, [detail('n1')]);
    await act(async () => h.result.current.saveAll());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(h.result.current.rows[0].result).toMatchObject({ kind: 'DRAFT' });
    expect((h.result.current.rows[0].result as { text: string }).text).toMatch(/ayrı onay/);
  });

  it('refakatAutoPrint açık → açılan iş emri için kart basılır; kapalıyken basılmaz', async () => {
    // Ayar gelen belge ayar ucundan gelir (bayrak yükünde yok).
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER', refakatAutoPrint: true });
    mockCreate.mockResolvedValue({ workOrderId: 'wo-1', workOrderNo: 'IE-1', batchNumber: 'P', rollId: 'x' });
    mockPrint.mockResolvedValue(undefined);
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1')]);
    await act(async () => h.result.current.saveAll());
    expect(mockPrint).toHaveBeenCalledWith('wo-1');
    expect(h.result.current.rows[0].result).toMatchObject({ kind: 'OPENED', print: 'PRINTED' });
  });

});

describe('useWoRows — K22 ön seçim (sunucu çözücüsü)', () => {
  const kursunRoute = { id: 'r2', name: 'Kurşun', steps: [{ stationId: 's-k', sequence: 1, station: { isKursunStation: true } }] } as unknown as ProductionRoute;
  const gramajOf = (h: ReturnType<typeof setup>, id: string) => h.result.current.rows.find((r) => r.noteId === id)?.form?.gramajValueId;

  it('⭐ K22: çözücünün müşteri gramajı ön seçilir; müşteri değişince yeniden; elle seçim ezilmez', async () => {
    mockSettings.mockResolvedValue({});
    mockCatalog.mockResolvedValue({ propertyId: 'p-gr', options: [{ id: 'g1', name: '60 gr', isDefault: false }, { id: 'g2', name: '80 gr', isDefault: true }] });
    const h = setup(kursunRoute);
    await withRows(h, [detail('n1'), detail('n2', { ownerCustomerId: 'c2' })]);
    await waitFor(() => expect(gramajOf(h, 'n1')).toBe('g1'));
    await waitFor(() => expect(gramajOf(h, 'n2')).toBe('g2'));
    act(() => h.result.current.updateForm('n2', { ownerCustomerId: 'c1' }));
    expect(gramajOf(h, 'n2')).toBe('g1');
    act(() => h.result.current.updateForm('n1', { gramajValueId: 'g2' }));
    act(() => h.result.current.updateForm('n1', { ownerCustomerId: 'c3' }));
    act(() => h.result.current.updateForm('n1', { ownerCustomerId: 'c1' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('customerId=c3')));
    expect(gramajOf(h, 'n1')).toBe('g2');
  });

  it('K22: kurşunsuz rotada gramaj yok (çözücü ucu yalnız iletilecek değerler için okunur)', async () => {
    mockSettings.mockResolvedValue({});
    const h = setup({ id: 'r3', name: 'Tambur', steps: [{ stationId: 's-t', sequence: 1, station: { isKursunStation: false } }] } as unknown as ProductionRoute);
    await withRows(h, [detail('n1')]);
    await waitFor(() => expect(mockSettings).toHaveBeenCalled());
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(gramajOf(h, 'n1')).toBeNull();
  });

  it('⭐ K22: gövde hedefi HEP açık — ön seçili gramaj + iletilen değer; elle seçilen ve "Hedef yok" aynen', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCatalog.mockResolvedValue({ propertyId: 'p-gr', options: [{ id: 'g1', name: '60 gr', isDefault: false }, { id: 'g2', name: '80 gr', isDefault: true }] });
    mockCreate.mockResolvedValue({ workOrderId: 'wo', workOrderNo: 'IE', batchNumber: 'P', rollId: 'x' });
    const h = setup(kursunRoute);
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1'), detail('n2')]);
    await waitFor(() => expect(gramajOf(h, 'n2')).toBe('g1'));
    await withRows(h, [detail('n3')]);
    act(() => h.result.current.updateForm('n2', { gramajValueId: 'g2' }));
    act(() => h.result.current.updateForm('n3', { gramajValueId: null }));
    await act(async () => h.result.current.saveAll());
    const bodies = Object.fromEntries(mockCreate.mock.calls.map(([id, b]) => [id, b]));
    const br = { propertyId: 'p-br', valueId: 'b1' };
    expect(bodies.n1.targetValues).toEqual([{ propertyId: 'p-gr', valueId: 'g1' }, br]);
    expect(bodies.n2.targetValues).toEqual([{ propertyId: 'p-gr', valueId: 'g2' }, br]);
    expect(bodies.n3.targetValues).toEqual([br]);
  });
});

describe('useWoRows — kayıt sağlamlığı ve belge masası (K23)', () => {
  it('⭐ K23 çift dokunuş: ikinci saveAll ilk sürerken çağrılırsa TEK istek gider', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    let release!: (v: unknown) => void;
    mockCreate.mockImplementation(() => new Promise((r) => { release = r; }));
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1')]);
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = h.result.current.saveAll();
      second = h.result.current.saveAll();
    });
    await expect(second).resolves.toEqual([]);
    await act(async () => {
      release({ workOrderId: 'wo-1', workOrderNo: 'IE-1', batchNumber: 'P', rollId: 'x' });
      await first;
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await first).toEqual([expect.objectContaining({ noteId: 'n1', result: expect.objectContaining({ kind: 'OPENED', workOrderNo: 'IE-1' }) })]);
  });

  it('⭐ K23 ağ hatası (status yok): yeniden deneme AYNI clientToken ile gider (çift İE yok); 409 sonrası yeni token', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockRejectedValueOnce(new Error('Network Error'));
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('Çakışma'), { status: 409 }));
    mockCreate.mockResolvedValueOnce({ workOrderId: 'wo-1', workOrderNo: 'IE-1', batchNumber: 'P', rollId: 'x' });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1')]);
    await act(async () => void (await h.result.current.saveAll()));
    expect(h.result.current.rows[0].result?.kind).toBe('FAILED');
    await act(async () => void (await h.result.current.saveAll()));
    await act(async () => void (await h.result.current.saveAll()));
    const tokens = mockCreate.mock.calls.map((c) => (c[1] as { clientToken: string }).clientToken);
    expect(tokens[1]).toBe(tokens[0]); // belirsiz hata → yapışık
    expect(tokens[2]).not.toBe(tokens[1]); // kesin 409 → yeni deneme
    expect(h.result.current.rows[0].result?.kind).toBe('OPENED');
  });

  it('K23 belge masası: makine seçimi kurşun adımı sırasıyla stepPlanning olarak gider; seçim yoksa alan yok', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockResolvedValue({ workOrderId: 'wo-1', workOrderNo: 'IE-1', batchNumber: 'P', rollId: 'x' });
    const kursunRoute = { id: 'r2', name: 'Kurşun', steps: [{ sequence: 2, stationId: 's-k', station: { isKursunStation: true } }] } as unknown as ProductionRoute;
    const h = setup(kursunRoute);
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1'), detail('n2')]);
    act(() => h.result.current.updateForm('n1', { machineId: 'm-1' }));
    await act(async () => void (await h.result.current.saveAll()));
    const bodies = Object.fromEntries(mockCreate.mock.calls.map((c) => [c[0], c[1]]));
    expect(bodies.n1.stepPlanning).toEqual([{ sequence: 2, plannedMachineId: 'm-1' }]);
    expect(bodies.n2).not.toHaveProperty('stepPlanning');
  });
});

describe('useWoRows — K27 aynı belge no (WARN)', () => {
  const active = () =>
    Object.assign(new Error('Bu belge no GB-7 olarak zaten kayıtlı'), {
      status: 409,
      details: { code: 'DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE', senderDocNo: '17', peers: [{ id: 'p1', noteNo: 'GB-7', status: 'APPROVED', workOrderNumbers: ['IE-12'] }] },
    });
  it('⭐ 409 ACTIVE → satır düşer, diyalog künyesi dolar; "Yine de onayla" yalnız o satırı bayrakla gönderir', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockImplementation(async (id: string, b: { confirmDuplicateDocNo?: boolean }) => {
      if (id === 'n1' && !b.confirmDuplicateDocNo) throw active();
      return { workOrderId: `wo-${id}`, workOrderNo: `IE-${id}`, batchNumber: null, rollId: 'roll' };
    });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1'), detail('n2')]);
    await act(async () => void (await h.result.current.saveAll()));
    expect(h.result.current.duplicate).toMatchObject({ noteId: 'n1', conflict: { senderDocNo: '17' } });
    expect(mockCreate.mock.calls[0][1]).not.toHaveProperty('confirmDuplicateDocNo');
    let saved: { noteId: string }[] = [];
    await act(async () => void (saved = await h.result.current.confirmDuplicate()));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate.mock.calls[2]).toEqual(['n1', expect.objectContaining({ confirmDuplicateDocNo: true })]);
    expect(saved.map((s) => s.noteId)).toEqual(['n1']);
    expect(h.result.current.duplicate).toBeNull();
    expect(h.result.current.rows.map((r) => r.result?.kind)).toEqual(['OPENED', 'OPENED']);
  });
  it('BLOCK kodu (DUPLICATE_DOC_NO) diyalog açmaz: bugünkü satır hatası', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockRejectedValue(Object.assign(new Error('Aynı belge no'), { status: 409, details: { code: 'DELIVERY_NOTE_DUPLICATE_DOC_NO' } }));
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1')]);
    await act(async () => void (await h.result.current.saveAll()));
    expect(h.result.current.duplicate).toBeNull();
    expect(h.result.current.rows[0].result).toEqual({ kind: 'FAILED', text: 'Aynı belge no' });
  });
});

describe('useWoRows — aynı müşteri parti no', () => {
  const peers = [{ id: 'p1', noteNo: 'GB0911260041', status: 'APPROVED', customerBatchNo: 'ISM1439770', workOrderNumber: 'IE0911260003', workOrderNumbers: ['IE0911260003'] }];
  const err = (code: string) => Object.assign(new Error('Bu müşteri parti no işi süren başka kayıtta var'), { status: 409, details: { code, peers } });
  const docNo = () => Object.assign(new Error('Bu belge no zaten kayıtlı'), { status: 409, details: { code: 'DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE', senderDocNo: '17', peers: [] } });
  it('⭐ WARN 409 → kart künyesi; "Yine de aç" yalnız o satırı bayrakla, önceki belge no onayını da taşıyarak gönderir', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockImplementation(async (id: string, b: { confirmDuplicateDocNo?: boolean; confirmDuplicateBatchNo?: boolean }) => {
      if (id === 'n1' && !b.confirmDuplicateDocNo) throw docNo();
      if (id === 'n1' && !b.confirmDuplicateBatchNo) throw err('DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE');
      return { workOrderId: `wo-${id}`, workOrderNo: `IE-${id}`, batchNumber: null, rollId: 'roll' };
    });
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1'), detail('n2')]);
    await act(async () => void (await h.result.current.saveAll()));
    await act(async () => void (await h.result.current.confirmDuplicate()));
    expect(h.result.current.duplicateBatch).toMatchObject({ noteId: 'n1', conflict: { confirmable: true, peers: [{ customerBatchNo: 'ISM1439770', workOrderNumber: 'IE0911260003' }] } });
    const before = mockCreate.mock.calls.length;
    let saved: { noteId: string }[] = [];
    await act(async () => void (saved = await h.result.current.confirmDuplicateBatch()));
    expect(mockCreate.mock.calls.length).toBe(before + 1);
    expect(mockCreate.mock.calls[before]).toEqual(['n1', expect.objectContaining({ confirmDuplicateDocNo: true, confirmDuplicateBatchNo: true })]);
    expect(saved.map((s) => s.noteId)).toEqual(['n1']);
    expect(h.result.current.duplicateBatch).toBeNull();
    expect(h.result.current.rows.map((r) => r.result?.kind)).toEqual(['OPENED', 'OPENED']);
  });
  it('BLOCK 409 → kart açılır ama onaylanamaz: "Yine de aç" istek atmaz', async () => {
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockRejectedValue(err('DELIVERY_NOTE_DUPLICATE_BATCH_NO'));
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1')]);
    await act(async () => void (await h.result.current.saveAll()));
    expect(h.result.current.duplicateBatch).toMatchObject({ noteId: 'n1', conflict: { confirmable: false } });
    expect(mockCreate.mock.calls[0][1]).not.toHaveProperty('confirmDuplicateBatchNo');
    await act(async () => void (await h.result.current.confirmDuplicateBatch()));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
