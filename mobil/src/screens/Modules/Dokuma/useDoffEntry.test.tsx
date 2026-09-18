// =============================================================================
// useDoffEntry — KOŞUM ÖN-SEÇİMİ (+0/−1 dokunuş): tek açık koşum kendiliğinden seçili
// =============================================================================
//   §1 tek açık koşum → machineRunId ön-seçili · 0 ya da >1 → null (operatör seçer)
//   §2 operatör "Koşumsuz" (selectRun(null)) seçince ön-seçim TEKRAR ETMEZ (dokunuldu)
//   §3 hat değişince (setLineNo) ön-seçim sıfırlanır — yeni hattın tek koşumu seçili
//   §4 parça sayısı VARSAYILAN '1' (form açılışta geçerli)
// Negatif sonda (2026-09-18, bir kezlik): `runTouched` guard'ı kaldırıldı → §2 ❌ (Koşumsuz
// seçildikten sonra effect tek koşumu geri yazdı).
// =============================================================================
import { act, renderHook } from '@testing-library/react-native';
import { useDoffEntry } from './useDoffEntry';

let mockOpenRuns: { id: string; startedAt: string; productionLineNo: number; weavingOrderId: string | null }[] = [];
const mockRefetchRuns = jest.fn();

jest.mock('./useDoffLists', () => ({
  useDoffLists: () => ({ openRuns: mockOpenRuns, runsLoading: false, refetchRuns: mockRefetchRuns, todayRows: [], todayLoading: false, todayError: false, refreshToday: jest.fn() }),
}));
jest.mock('./useDoffMeter', () => ({ useDoffMeter: () => ({ readMeter: jest.fn(), reading: false }) }));
jest.mock('./useDoffMutations', () => ({
  useDoffSave: () => ({ mutation: { mutate: jest.fn(), isPending: false }, attemptRef: { current: null }, result: null, setResult: jest.fn(), failure: null, setFailure: jest.fn(), invalidate: jest.fn() }),
  useDoffRevoke: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('../../../store/sessionStore', () => ({ useSessionStore: (sel: (s: unknown) => unknown) => sel({ active: { machine: { id: 'mac1', productionLineCount: 2 } } }) }));
jest.mock('../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: () => true }) }));
jest.mock('../../../offline/hooks', () => ({ useIsOnline: () => true, useOfflineReason: () => null }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const run = (id: string, line = 1) => ({ id, startedAt: '2026-09-18T09:00:00.000Z', productionLineNo: line, weavingOrderId: 'wo1' });

beforeEach(() => {
  mockOpenRuns = [];
  mockRefetchRuns.mockClear();
});

describe('useDoffEntry koşum ön-seçimi', () => {
  it('§4 parça sayısı varsayılan "1"', () => {
    const { result } = renderHook(() => useDoffEntry());
    expect(result.current.form.pieceCount).toBe('1');
  });

  it('§1 tek açık koşum → ön-seçili; >1 → null', () => {
    mockOpenRuns = [run('r1')];
    const { result, rerender } = renderHook(() => useDoffEntry());
    expect(result.current.form.machineRunId).toBe('r1');

    mockOpenRuns = [run('r1'), run('r2')];
    const { result: r2 } = renderHook(() => useDoffEntry());
    rerender({});
    expect(r2.current.form.machineRunId).toBeNull();
  });

  it('§2 ⭐ "Koşumsuz" seçilince ön-seçim tekrar etmez (koşum listesi tazelense bile)', () => {
    mockOpenRuns = [run('r1')];
    const { result, rerender } = renderHook(() => useDoffEntry());
    expect(result.current.form.machineRunId).toBe('r1');
    act(() => result.current.selectRun(null));
    expect(result.current.form.machineRunId).toBeNull();
    // Koşum listesi yenilendi (aynı tek koşum, YENİ dizi referansı) → effect yeniden koşar;
    // `runTouched` guard'ı olmadan r1'i geri yazardı.
    mockOpenRuns = [run('r1')];
    rerender({});
    expect(result.current.form.machineRunId).toBeNull();
  });

  it('§3 hat değişince ön-seçim sıfırlanır (yeni hattın tek koşumu seçili)', () => {
    mockOpenRuns = [run('r1', 1)];
    const { result, rerender } = renderHook(() => useDoffEntry());
    act(() => result.current.selectRun(null)); // 1. hatta Koşumsuz seçildi
    expect(result.current.form.machineRunId).toBeNull();
    mockOpenRuns = [run('r9', 2)];
    act(() => result.current.setLineNo(2)); // hat değişti → runTouched sıfırlanır
    rerender({});
    expect(result.current.form.machineRunId).toBe('r9');
  });
});
