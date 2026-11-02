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
let mockAutoPrint = false;

jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    settings: () => mockSettings(),
    createWorkOrder: (id: string, b: unknown) => mockCreate(id, b),
    updateNote: (id: string, b: unknown) => mockUpdate(id, b),
  },
}));
jest.mock('../../../../services/fabricProperty.service', () => ({ fabricPropertyService: { getKursunGramajCatalog: async () => ({ propertyId: null, options: [] }) } }));
jest.mock('../../../../hooks/useFeatureFlags', () => ({ useRefakatAutoPrint: () => mockAutoPrint }));
jest.mock('../../../../services/travelerCardPrint', () => ({ printTravelerCardForWorkOrder: (id: string) => mockPrint(id) }));
jest.mock('./recentOwners', () => ({ loadRecentOwners: async () => [], rememberOwner: async (l: string[], id: string) => [id, ...l] }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const route = { id: 'r1', name: 'Kurşun&Tambur', steps: [] } as unknown as ProductionRoute;
const detail = (id: string, x: Partial<InboundNoteDetail> = {}) =>
  ({ id, noteNo: `GB-${id}`, ownerCustomerId: 'c1', kursunMeters: '100', kursunMetersReview: false, ...x }) as InboundNoteDetail;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useWoRows(route), { wrapper });
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
  mockAutoPrint = false;
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
    mockSettings.mockResolvedValue({ formApproval: 'WITH_WORK_ORDER' });
    mockCreate.mockResolvedValue({ workOrderId: 'wo-1', workOrderNo: 'IE-1', batchNumber: 'P', rollId: 'x' });
    mockPrint.mockResolvedValue(undefined);
    mockAutoPrint = true;
    const h = setup();
    await waitFor(() => expect(h.result.current.mode).toBe('WITH_WORK_ORDER'));
    await withRows(h, [detail('n1')]);
    await act(async () => h.result.current.saveAll());
    expect(mockPrint).toHaveBeenCalledWith('wo-1');
    expect(h.result.current.rows[0].result).toMatchObject({ kind: 'OPENED', print: 'PRINTED' });
  });
});
