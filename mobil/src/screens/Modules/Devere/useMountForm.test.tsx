// =============================================================================
// useMountForm — levent tak barkodla (S3c): ① levent okut ② tezgah okut ③ yuva → TAK
// =============================================================================
//   §1 hazır levent etiketi → form açılır (accept); takılı levent → ret + sebep, form açılmaz
//   §2 tezgah etiketi → makine seçili, yuva 1; levent etiketi tezgah adımında → ret
//   §3 oturum makinesi (presetMachineId) → form makineyle açılır; TAK mount'u (yuva 1) çağırır
// =============================================================================
import React, { type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WarpBeam } from '../../../services/warpBeam.service';
import { warpBeamService } from '../../../services/warpBeam.service';
import { signalScan } from '../../../services/scanFeedback';
import { useMountForm } from './useMountForm';

jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../services/warpBeam.service', () => ({ warpBeamService: { mount: jest.fn() } }));

const machines = [
  { id: 'm7', code: 'T-07', name: 'Tezgah 7', stationName: 'Dokuma', warpBeamSlots: 1 },
  { id: 'm9', code: 'T-09', name: 'Tezgah 9', stationName: 'Dokuma', warpBeamSlots: 2 },
];
const ready = { id: 'b1', beamNo: 'LV261021-0001', status: 'READY', physicalBeamNo: null, remainingM: 900 } as WarpBeam;
const mounted = { id: 'b2', beamNo: 'LV261021-0002', status: 'MOUNTED', physicalBeamNo: null, remainingM: 10, currentMachine: { id: 'm9', code: 'T-09', name: 'Tezgah 9' }, currentPosition: 2 } as WarpBeam;

function setup(presetMachineId: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useMountForm({ loomMachines: machines, methodRequired: false, onDone: jest.fn(), presetMachineId }), { wrapper });
}

beforeEach(() => {
  (signalScan as jest.Mock).mockClear();
  (warpBeamService.mount as jest.Mock).mockReset().mockResolvedValue({ success: true, message: 'Levent takıldı' });
});

it('§1 ⭐ levent etiketi: hazır → form açılır; takılı → ret + sebep', () => {
  const { result } = setup();
  act(() => {
    result.current.scanBeam('lv261021-0002', [ready, mounted]);
  });
  expect(signalScan).toHaveBeenLastCalledWith('reject');
  expect(result.current.beam).toBeNull();
  expect(result.current.scanMessage).toMatch(/zaten takılı \(T-09 yuva 2\)/);
  act(() => {
    result.current.scanBeam('LV261021-0001', [ready, mounted]);
  });
  expect(signalScan).toHaveBeenLastCalledWith('accept');
  expect(result.current.beam?.id).toBe('b1');
  expect(result.current.form.machineId).toBeNull();
});

it('§2 ⭐ tezgah etiketi → makine + yuva 1; levent etiketi tezgah adımında ret', () => {
  const { result } = setup();
  act(() => {
    result.current.scanBeam('LV261021-0001', [ready]);
  });
  act(() => result.current.scanMachine('LV261021-0001'));
  expect(signalScan).toHaveBeenLastCalledWith('reject');
  expect(result.current.error).toMatch(/şimdi tezgahın etiketini/);
  act(() => result.current.scanMachine('t-07'));
  expect(signalScan).toHaveBeenLastCalledWith('accept');
  expect(result.current.form).toMatchObject({ machineId: 'm7', position: '1' });
  expect(result.current.slots).toBe(1);
});

it('§3 oturum makinesi → tezgah adımı yok; TAK mount (yuva 1) çağırır — 2 dokunuş', async () => {
  const { result } = setup('m7');
  act(() => {
    result.current.scanBeam('LV261021-0001', [ready]);
  });
  expect(result.current.form.machineId).toBe('m7');
  await act(async () => {
    result.current.submit();
  });
  expect(warpBeamService.mount).toHaveBeenCalledWith('b1', expect.objectContaining({ machineId: 'm7', position: 1 }));
});
