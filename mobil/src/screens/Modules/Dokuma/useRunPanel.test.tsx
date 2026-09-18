// =============================================================================
// useRunPanel — KOŞUM DOKUMA İŞİ ÖN-SEÇİMİ (Z1 üretim belge zinciri, +0 dokunuş)
// =============================================================================
//   §1 modal açılınca takılı leventin işi (`suggestedWeavingOrderId`) ön-seçili + desen/renk ön-dolu
//   §2 öneri yoksa (eski sunucu / bağsız levent) ön-seçim yok — form boş
//   §3 operatör işi değiştirince (`selectOrder`) öneri GERİ YAZMAZ (dokunuldu); modal kapanınca sıfırlanır
//   §4 `weavingRequired` submitOpen'a geçer (bayrak açıkken iş zorunlu)
// Negatif sonda (2026-09-18, bir kezlik): ön-seçim `setForm` gövdesi kaldırıldı → §1 + §3 ❌.
// (`runTouched` guard defansiftir; birincil koruma `f.weavingOrderId ? f` — dolu değeri ezmez.)
// =============================================================================
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRunPanel } from './useRunPanel';

let mockSuggestedId: string | null = null;
let mockRequired = false;
const mockOrders = [
  { id: 'wo1', weavingOrderNumber: 'DK-1', itemId: 'i1', item: { id: 'i1', name: 'PATOS' }, colorId: 'c1', color: { id: 'c1', name: 'MAVİ' }, plannedM: 100, status: 'IN_PROGRESS' },
  { id: 'wo2', weavingOrderNumber: 'DK-2', itemId: 'i2', item: { id: 'i2', name: 'KADİFE' }, colorId: null, color: null, plannedM: null, status: 'PLANNED' },
];

// Her çağrıda TAZE dizi: refetch yeni referans üretsin ki `orders` bağımlılığı değişip effect yeniden koşsun.
jest.mock('../../../services/weavingOrder.service', () => ({ weavingOrderService: { listOpen: () => Promise.resolve(mockOrders.map((o) => ({ ...o }))) } }));
jest.mock('../../../services/machineRun.service', () => ({
  machineRunService: { tabletContext: () => Promise.resolve({ suggestedWeavingOrderId: mockSuggestedId, suggestedFrom: mockSuggestedId ? 'MOUNTED_BEAM' : null, mountedBeam: null, weavingOrders: [] }) },
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useDokumaRunWeavingRequired: () => mockRequired }));
jest.mock('./useRunMutations', () => ({
  OPEN_ORDERS_KEY: ['weaving-orders', 'open'],
  useRunMutations: () => ({ open: { mutate: jest.fn(), isPending: false }, close: { mutate: jest.fn(), isPending: false }, revoke: { mutate: jest.fn(), isPending: false } }),
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockSuggestedId = null;
  mockRequired = false;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

describe('useRunPanel dokuma işi ön-seçimi', () => {
  it('§1 öneri → iş ön-seçili + desen/renk ön-dolu', async () => {
    mockSuggestedId = 'wo1';
    const { result } = renderHook(() => useRunPanel({ machineId: 'm1', lineNo: 1, isOnline: true }), { wrapper });
    act(() => result.current.setOpenModal(true));
    await waitFor(() => expect(result.current.form.weavingOrderId).toBe('wo1'));
    expect(result.current.form.itemLabel).toBe('PATOS');
    expect(result.current.form.colorLabel).toBe('MAVİ');
    expect(result.current.suggestedFrom).toBe('MOUNTED_BEAM');
  });

  it('§2 öneri yok → form boş', async () => {
    mockSuggestedId = null;
    const { result } = renderHook(() => useRunPanel({ machineId: 'm1', lineNo: 1, isOnline: true }), { wrapper });
    act(() => result.current.setOpenModal(true));
    await waitFor(() => expect(result.current.ordersLoading).toBe(false));
    expect(result.current.form.weavingOrderId).toBeNull();
  });

  it('§3 ⭐ operatör "İş emrisiz" seçince öneri geri yazmaz (liste tazelense bile); modal kapanınca sıfırlanır', async () => {
    mockSuggestedId = 'wo1';
    const { result } = renderHook(() => useRunPanel({ machineId: 'm1', lineNo: 1, isOnline: true }), { wrapper });
    act(() => result.current.setOpenModal(true));
    await waitFor(() => expect(result.current.form.weavingOrderId).toBe('wo1'));
    // Operatör işi TEMİZLEDİ (İş emrisiz → null); selectOrder → runTouched. İş listesi tazelenince
    // (effect yeniden koşar) öneri wo1'i geri YAZMAMALI (guard). Guard yoksa wo1 geri gelir.
    act(() => result.current.selectOrder({ ...result.current.form, weavingOrderId: null, itemLabel: '', colorLabel: '' }));
    await act(async () => { await qc.invalidateQueries({ queryKey: ['weaving-orders', 'open'] }); });
    expect(result.current.form.weavingOrderId).toBeNull();
    // Modal kapan-aç → runTouched sıfırlanır → öneri yeniden.
    act(() => result.current.setOpenModal(false));
    act(() => result.current.setOpenModal(true));
    await waitFor(() => expect(result.current.form.weavingOrderId).toBe('wo1'));
  });

  it('§4 weavingRequired bayrağı forma yansır', () => {
    mockRequired = true;
    const { result } = renderHook(() => useRunPanel({ machineId: 'm1', lineNo: 1, isOnline: true }), { wrapper });
    expect(result.current.weavingRequired).toBe(true);
  });
});
