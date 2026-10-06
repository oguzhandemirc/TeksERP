// Bekçi: API Sunucusu → şifreli bağlantı kartı (docs/design/LAN-TLS.md §4c).
// ⭐ Native zorlama katmanı olmayan sürümde ve sabit yokken kart HİÇ görünmez (bugünkü tabletler değişmez).
// ⭐ QR okutulunca sabit native katmana da iletilir ve adres https'e geçer; çapraz denetim tutmazsa hiçbir şey yazılmaz.
import React from 'react';
import { NativeModules } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { LanTlsCard } from './LanTlsCard';
import { buildTlsQr } from '../lib/lan-tls';
import { useBaseUrlStore } from '../store/baseUrlStore';
import { probeServer } from '../services/discovery.service';

const FP = 'ab'.repeat(32);
const IID = '11111111-2222-3333-4444-555555555555';
const QR = buildTlsQr(IID, { port: 4443, fingerprint: FP });

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../services/discovery.service', () => ({ probeServer: jest.fn() }));
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

const probeMock = probeServer as jest.MockedFunction<typeof probeServer>;
const setCustomUrl = jest.fn(async () => undefined);

function ciz() {
  return render(
    <PaperProvider>
      <LanTlsCard />
    </PaperProvider>,
  );
}

beforeEach(() => {
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
  delete (NativeModules as Record<string, unknown>).TeksErpLanTls;
});

it('native katman yoksa ve sabit yoksa kart görünmez', async () => {
  ciz();
  await act(async () => undefined);
  expect(screen.queryByTestId('lan-tls-card')).toBeNull();
});

it('QR okutulunca sabit native katmana gider ve adres https olur', async () => {
  const setPins = jest.fn(async (_json: string) => undefined);
  (NativeModules as Record<string, unknown>).TeksErpLanTls = { setPins };
  ciz();
  await act(async () => undefined);
  fireEvent.press(screen.getByTestId('lan-tls-qr-okut'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('sahte-okut'));
  });
  expect(setPins).toHaveBeenCalledTimes(1);
  expect(JSON.parse(setPins.mock.calls[0]![0])).toEqual([
    expect.objectContaining({ installationId: IID, fingerprint: FP, port: 4443, via: 'qr' }),
  ]);
  expect(setCustomUrl).toHaveBeenCalledWith('https://192.168.1.50:4443');
});

it('başka sunucunun QR\'ı → hiçbir şey yazılmaz', async () => {
  const setPins = jest.fn(async (_json: string) => undefined);
  (NativeModules as Record<string, unknown>).TeksErpLanTls = { setPins };
  (globalThis as { __qr?: string }).__qr = buildTlsQr('99999999-2222-3333-4444-555555555555', { port: 4443, fingerprint: FP });
  ciz();
  await act(async () => undefined);
  fireEvent.press(screen.getByTestId('lan-tls-qr-okut'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('sahte-okut'));
  });
  expect(setPins).not.toHaveBeenCalled();
  expect(setCustomUrl).not.toHaveBeenCalled();
});
