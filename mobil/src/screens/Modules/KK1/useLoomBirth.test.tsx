// =============================================================================
// useLoomBirth — okut → kk1-context → ön-dolgu (S3a) · hata eylemi
// =============================================================================
//   §1 okut (çevrimiçi, 200) → accept sinyali, şerit dolu, kumaş forma ÖN-DOLU
//   §2 okut 409 MACHINE_NO_OPEN_RUN → reject, şerit boş, yönerge metni
//   §3 okut ağ hatası → accept, "bağlanınca doğrulanır" (kuyrukla gidecek)
//   §4 kayıt reddi: no-open-run → MODAL + şerit temizlenir; beam-not-recent → çip kalkar
//   §5 afterSubmit şeridi temizler, restore geri yükler ("Aynı tezgah" kodu kalır)
// =============================================================================
import React, { type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Kk1Context } from '../../../types/models';
import { signalScan } from '../../../services/scanFeedback';
import { doffService } from '../../../services/doff.service';
import { useLoomBirth } from './useLoomBirth';

jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../services/doff.service', () => ({ doffService: { kk1Context: jest.fn() } }));
jest.mock('../../../services/weavingOrder.service', () => ({ weavingOrderService: { listOpen: jest.fn().mockResolvedValue([]) } }));

const kk1Context = doffService.kk1Context as jest.Mock;
const ctx: Kk1Context = {
  machine: { id: 'm7', code: 'T-07', name: 'Tezgah 7', productionLineCount: 1 },
  run: { id: 'r1', productionLineNo: 1, startedAt: '2026-10-21T05:00:00Z', weavingOrder: { id: 'wo1', weavingOrderNumber: 'DK1' }, item: { id: 'i1', code: 'KR', name: 'KRİSTAL' }, color: null, warpSpec: null },
  beams: { mounted: [], recentChange: { at: '2026-10-21T04:00:00Z', dismounted: { id: 'b7', beamNo: 'LV-07' }, mounted: { id: 'b9', beamNo: 'LV-09' } } },
  rollBirth: 'KK1_LABEL_ONLY',
};

function setup(isOnline = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const onPrefillItem = jest.fn();
  const r = renderHook(() => useLoomBirth({ visible: true, rollBirth: 'KK1_LABEL_OR_ORDER', isOnline, onPrefillItem }), { wrapper });
  return { ...r, onPrefillItem };
}

beforeEach(() => {
  kk1Context.mockReset();
  (signalScan as jest.Mock).mockClear();
});

describe('useLoomBirth', () => {
  it('§1 ⭐ okut → accept, şerit + kumaş ön-dolgu (öneri)', async () => {
    kk1Context.mockResolvedValue({ success: true, data: ctx });
    const { result, onPrefillItem } = setup();
    await act(async () => {
      await result.current.scan(' t-07 ');
    });
    expect(kk1Context).toHaveBeenCalledWith('T-07', null);
    expect(signalScan).toHaveBeenLastCalledWith('accept');
    expect(result.current.state.machineCode).toBe('T-07');
    expect(result.current.state.verify).toBe('ok');
    expect(onPrefillItem).toHaveBeenCalledWith({ id: 'i1', name: 'KRİSTAL' });
  });

  it('§2 ⭐ okut 409 açık iş yok → reject, şerit boş, yönerge', async () => {
    kk1Context.mockRejectedValue({ status: 409, message: 'açık koşum yok', details: { code: 'MACHINE_NO_OPEN_RUN' } });
    const { result } = setup();
    await act(async () => {
      await result.current.scan('T-07');
    });
    expect(signalScan).toHaveBeenLastCalledWith('reject');
    expect(result.current.state.machineCode).toBeNull();
    expect(result.current.scanMessage).toMatch(/T-07'de açık iş yok — Panelden İş ver/);
  });

  it('§3 ağ hatası / çevrimdışı → accept, "bağlanınca doğrulanır"', async () => {
    kk1Context.mockRejectedValue(new Error('Network Error'));
    const { result } = setup();
    await act(async () => {
      await result.current.scan('T-07');
    });
    expect(signalScan).toHaveBeenLastCalledWith('accept');
    expect(result.current.state).toMatchObject({ machineCode: 'T-07', verify: 'unverified' });

    const off = setup(false);
    await act(async () => {
      await off.result.current.scan('T-08');
    });
    expect(kk1Context).toHaveBeenCalledTimes(1); // çevrimdışıyken uca gidilmez
    expect(off.result.current.state).toMatchObject({ machineCode: 'T-08', verify: 'unverified' });
  });

  it('§4 kayıt reddi: no-open-run → modal + temizlik; beam-not-recent → çip kalkar; plain → konuşmaz', async () => {
    kk1Context.mockResolvedValue({ success: true, data: ctx });
    const { result } = setup();
    await act(async () => {
      await result.current.scan('T-07');
    });
    act(() => result.current.chooseBeam('old'));
    let handled = false;
    act(() => {
      handled = result.current.handleFailure({ status: 400, details: { code: 'WARP_BEAM_NOT_RECENT' } }, 'T-07');
    });
    expect(handled).toBe(true);
    expect(result.current.state).toMatchObject({ machineCode: 'T-07', beamChoice: 'new', beamChipsDismissed: true });

    act(() => {
      handled = result.current.handleFailure({ status: 409, message: 'yok', details: { code: 'MACHINE_NO_OPEN_RUN' } }, 'T-07');
    });
    expect(handled).toBe(true);
    expect(result.current.failureModal?.title).toBe("T-07'de açık iş yok");
    expect(result.current.state.machineCode).toBeNull();

    act(() => {
      handled = result.current.handleFailure({ status: 400, details: { code: 'VALIDATION_ERROR' } }, null);
    });
    expect(handled).toBe(false);
  });

  it('§5 afterSubmit temizler (son kod kalır), restore geri yükler', async () => {
    kk1Context.mockResolvedValue({ success: true, data: ctx });
    const { result } = setup();
    await act(async () => {
      await result.current.scan('T-07');
    });
    let prev = result.current.state;
    act(() => {
      prev = result.current.afterSubmit();
    });
    expect(result.current.state.machineCode).toBeNull();
    expect(result.current.state.lastMachineCode).toBe('T-07');
    act(() => result.current.restore(prev));
    expect(result.current.state.machineCode).toBe('T-07');
  });
});
