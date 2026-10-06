// Bekçi: API Sunucusu → şifreli bağlantı kartı (docs/design/LAN-TLS.md §4c).
// ⭐ Native zorlama katmanı olmayan sürümde ve sabit yokken kart HİÇ görünmez (bugünkü tabletler değişmez).
// ⭐ QR okutulunca sabit native katmana da iletilir ve adres https'e geçer; çapraz denetim tutmazsa hiçbir şey yazılmaz.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { LanTlsCard } from './LanTlsCard';
import { buildTlsQr } from '../lib/lan-tls';
import { useBaseUrlStore } from '../store/baseUrlStore';
import { probeServer } from '../services/discovery.service';
import { lanTlsNative, type LanTlsNative } from '../services/lanTlsNative';

const FP = 'ab'.repeat(32);
const IID = '11111111-2222-3333-4444-555555555555';
const QR = buildTlsQr(IID, { port: 4443, fingerprint: FP });

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../services/discovery.service', () => ({ probeServer: jest.fn() }));
jest.mock('../services/lanTlsNative', () => ({ lanTlsNative: jest.fn(() => null) }));
const mockMem = new Map<string, string>();
jest.mock('../utils/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockMem.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
    deleteItem: jest.fn(async (k: string) => void mockMem.delete(k)),
  },
}));
jest.mock('./BarcodeScannerModal', () => {
  const { Pressable: P, Text: T } = jest.requireActual('react-native');
  return {
    BarcodeScannerModal: ({ visible, onScan }: { visible: boolean; onScan: (t: string) => void }) =>
      visible ? (
        <P testID="sahte-okut" onPress={() => onScan((globalThis as { __qr?: string }).__qr ?? '')}>
          <T>okut</T>
        </P>
      ) : null,
  };
});

jest.mock('./ConfirmDialog', () => {
  const { Pressable: P, Text: T } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ visible, onConfirm, confirmLabel }: { visible: boolean; onConfirm: () => void; confirmLabel: string }) =>
      visible ? (
        <P testID="onay" onPress={onConfirm}>
          <T>{confirmLabel}</T>
        </P>
      ) : null,
  };
});

const probeMock = probeServer as jest.MockedFunction<typeof probeServer>;
const nativeMock = lanTlsNative as jest.MockedFunction<typeof lanTlsNative>;

function nativeVar() {
  const setPinState = jest.fn(async (_fps: string[], _eps: string[]) => undefined);
  const mod: LanTlsNative = {
    setPinState,
    getPinState: () => ({ installed: true, fingerprints: [], endpoints: [] }),
  };
  nativeMock.mockReturnValue(mod);
  return setPinState;
}
const setCustomUrl = jest.fn(async () => undefined);

function ciz() {
  return render(
    <PaperProvider>
      <LanTlsCard />
    </PaperProvider>,
  );
}

beforeEach(() => {
  mockMem.clear();
  (globalThis as { __qr?: string }).__qr = QR;
  useBaseUrlStore.setState({ baseUrl: 'http://192.168.1.50:4000/api', recentUrls: [], setCustomUrl });
  setCustomUrl.mockClear();
  probeMock.mockResolvedValue({
    baseUrl: 'http://192.168.1.50:4000',
    host: '192.168.1.50',
    port: 4000,
    identity: { product: 'TeksERP', discoveryVersion: 1, installationId: IID, serverName: 's', companyName: 'c', version: '1' },
    rttMs: 1,
    matchesPinned: 'unknown',
    tls: { port: 4443, fingerprint: FP },
  });
});
afterEach(() => {
  nativeMock.mockReturnValue(null);
});

it('native katman yoksa ve sabit yoksa kart görünmez', async () => {
  ciz();
  await act(async () => undefined);
  expect(screen.queryByTestId('lan-tls-card')).toBeNull();
});

it('QR okutulunca sabit native katmana gider ve adres https olur', async () => {
  const setPinState = nativeVar();
  ciz();
  await act(async () => undefined);
  fireEvent.press(screen.getByTestId('lan-tls-qr-okut'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('sahte-okut'));
  });
  // Native'e yalnız parmak izi gider; adres henüz http olduğundan sabitli uç yok (adres değişince eşitleme iter).
  expect(setPinState).toHaveBeenCalledTimes(1);
  expect(setPinState).toHaveBeenCalledWith([FP], []);
  expect(setCustomUrl).toHaveBeenCalledWith('https://192.168.1.50:4443');
});

it('başka sunucunun QR\'ı → hiçbir şey yazılmaz', async () => {
  const setPinState = nativeVar();
  (globalThis as { __qr?: string }).__qr = buildTlsQr('99999999-2222-3333-4444-555555555555', { port: 4443, fingerprint: FP });
  ciz();
  await act(async () => undefined);
  fireEvent.press(screen.getByTestId('lan-tls-qr-okut'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('sahte-okut'));
  });
  expect(setPinState).not.toHaveBeenCalled();
  expect(setCustomUrl).not.toHaveBeenCalled();
});

it('engellenen şifresiz geçiş: kart o sabiti gösterir, kaldırınca yazılan http adresine geçer', async () => {
  const pin = { installationId: IID, fingerprint: FP, port: 4443, via: 'qr' as const, pinnedAt: '' };
  mockMem.set('api_server_tls_pins', JSON.stringify([pin]));
  render(
    <PaperProvider>
      <LanTlsCard blocked={{ pin, url: 'http://192.168.1.77:4000/api' }} />
    </PaperProvider>,
  );
  await act(async () => undefined);
  expect(screen.getByTestId('lan-tls-active-fp')).toBeTruthy();
  fireEvent.press(screen.getByTestId('lan-tls-kaldir'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('onay'));
  });
  expect(mockMem.has('api_server_tls_pins')).toBe(false);
  expect(setCustomUrl).toHaveBeenCalledWith('http://192.168.1.77:4000/api');
});
