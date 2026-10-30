// =============================================================================
// D4-A2 bekçisi — Kurşun/Tambur "Duruş" çipi + açık duruş bandı
// =============================================================================
//   §1 açık duruşta çip ("Duruşta · süre") + bant (DURUŞTA + Çalıştı) görünür; geri alma YOK
//   §2 çalışırken çip "Duruş" → açma modalı; bant kartı çizilmez
//   §3 eski backend 404 → çip ve bant yok, ekran çalışır (yeniden deneme yok)
//   §4 eski backend alanı göndermez (`machineStopTrackingEnabled` yok) → çip yok, uca İSTEK ATILMAZ
//   §5 izin (`mobile:makine-durus`) yoksa → çip yok, uca istek atılmaz
// =============================================================================
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import { useAuthStore } from '../../store/authStore';
import { useSessionStore } from '../../store/sessionStore';
import { MachineStopBand, MachineStopChip, useMachineStopControl } from './MachineStopChip';

const mockListOpen = jest.fn();
const mockFlags = jest.fn();
jest.mock('../../services/machineStop.service', () => ({
  machineStopService: { listOpen: (...a: unknown[]) => mockListOpen(...a), open: jest.fn(), close: jest.fn(), classify: jest.fn(), revoke: jest.fn() },
}));
jest.mock('../../services/featureFlag.service', () => {
  const actual = jest.requireActual('../../services/featureFlag.service');
  return { ...actual, featureFlagService: { get: () => mockFlags() } };
});
jest.mock('../../services/reasonPreset.service', () => ({ reasonPresetService: { list: jest.fn().mockResolvedValue([]) } }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const OPEN_STOP = {
  id: 's1', machineId: 'm1', runId: null, stopKey: 'k', startedAt: new Date(Date.now() - 12 * 60_000).toISOString(), endedAt: null, durationSec: null,
  reasonCode: null, lossClass: null, reasonNote: null, requiresReason: true, source: 'OPERATOR', revokedAt: null,
};

function Screen() {
  const control = useMachineStopControl();
  return (
    <>
      <MachineStopChip control={control} />
      <MachineStopBand control={control} />
      <Text>Kurşun ekranı</Text>
    </>
  );
}

function setup(p: { perms?: string[]; tracking?: boolean | undefined; stops?: unknown }) {
  useAuthStore.setState({ token: 't', user: { id: 'u', username: 'op', permissions: p.perms ?? ['mobile:kk2-kursun', 'mobile:makine-durus'] } as never });
  useSessionStore.setState({ active: { machine: { id: 'm1', name: 'K-1' } } as never });
  const flags: Record<string, unknown> = { productionEnabled: true };
  if (p.tracking !== undefined) flags.machineStopTrackingEnabled = p.tracking;
  mockFlags.mockResolvedValue(flags);
  if (p.stops instanceof Error) mockListOpen.mockRejectedValue(p.stops);
  else mockListOpen.mockResolvedValue(p.stops ?? []);
  return renderWithPaper(<Screen />);
}

async function settle(until?: () => void) {
  await waitFor(() => expect(mockFlags).toHaveBeenCalled());
  if (until) await waitFor(until);
  await act(async () => {
    await new Promise((res) => setTimeout(res, 300));
  });
}

beforeEach(() => jest.clearAllMocks());

describe('Makine duruş çipi (D4-A2)', () => {
  it('§1 açık duruşta çip + bant görünür; geri alma yok', async () => {
    const r = setup({ tracking: true, stops: [OPEN_STOP] });
    await settle(() => expect(r.getByTestId('machine-stop-band')).toBeTruthy());
    expect(r.getByTestId('machine-stop-chip')).toBeTruthy();
    expect(r.getByText('Duruşta · 12 dk')).toBeTruthy();
    expect(r.getByTestId('machine-stop-band')).toBeTruthy();
    expect(r.getByText('DURUŞTA · 12 dk')).toBeTruthy();
    expect(r.getByText('Çalıştı')).toBeTruthy();
    expect(r.queryByText('Geri al')).toBeNull();
    expect(mockListOpen).toHaveBeenCalledWith('m1');
  });

  it('§2 çalışırken çip "Duruş" → açma modalı; bant kartı yok', async () => {
    const r = setup({ tracking: true, stops: [] });
    await settle(() => expect(mockListOpen).toHaveBeenCalled());
    expect(r.getByText('Duruş')).toBeTruthy();
    expect(r.queryByTestId('machine-stop-band')).toBeNull();
    expect(r.queryByText('Makine çalışıyor')).toBeNull();
    fireEvent.press(r.getByTestId('machine-stop-chip'));
    await act(async () => {});
    await waitFor(() => expect(r.getByText('Duruşu Aç')).toBeTruthy());
  });

  it('§3 eski backend 404 → çip/bant yok, ekran çalışır', async () => {
    const r = setup({ tracking: true, stops: Object.assign(new Error('Not found'), { status: 404 }) });
    await settle(() => expect(mockListOpen).toHaveBeenCalled());
    expect(r.queryByTestId('machine-stop-chip')).toBeNull();
    expect(r.queryByTestId('machine-stop-band')).toBeNull();
    expect(r.getByText('Kurşun ekranı')).toBeTruthy();
    expect(mockListOpen).toHaveBeenCalledTimes(1);
  });

  it('§4 ayar alanı yok (eski backend) → çip yok, uca istek yok', async () => {
    const r = setup({ tracking: undefined, stops: [OPEN_STOP] });
    await settle();
    expect(r.queryByTestId('machine-stop-chip')).toBeNull();
    expect(r.getByText('Kurşun ekranı')).toBeTruthy();
    expect(mockListOpen).not.toHaveBeenCalled();
  });

  it('§5 izin yok → çip yok, uca istek yok', async () => {
    const r = setup({ perms: ['mobile:kk2-kursun'], tracking: true, stops: [OPEN_STOP] });
    await settle();
    expect(r.queryByTestId('machine-stop-chip')).toBeNull();
    expect(mockListOpen).not.toHaveBeenCalled();
  });
});
