// =============================================================================
// Bekçi: tek ortak paket O8 — ilk açılış. Ortak paket ERP adresi taşımaz; adres yokken uygulama
// `localhost`a değil "Sunucuyu ekle" sayfasına gider (QR ya da adres + doğrulama kodu; K3).
//
// NEGATİF SONDA (ölçüldü): autoUrlFrom localhost'a geri düşünce §1 KIRMIZI; RootNavigator'da ServerSetup
// dalı pairing'in arkasına alınınca / sorgu kapısı kalkınca §2 KIRMIZI; adres yolunda `pairing` kalkınca §3a KIRMIZI.
// =============================================================================
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { renderWithPaper } from '../../test/render';
import { discoverServers } from '../../services/discovery.service';
import { autoUrlFrom, hasServerAddress, useBaseUrlStore } from '../../store/baseUrlStore';
import ServerSetupScreen from './ServerSetupScreen';

jest.mock('../../services/discovery.service', () => ({ discoverServers: jest.fn() }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const discoverMock = discoverServers as jest.MockedFunction<typeof discoverServers>;
const SUNUCU = {
  baseUrl: 'http://192.168.1.20:4000/api',
  host: '192.168.1.20',
  port: 4000,
  rttMs: 12,
  matchesPinned: 'none',
  identity: { companyName: 'Örnek Tekstil', serverName: 'SRV-1', version: '2.0.0' },
};

describe('§1 autoUrlFrom — gömülü adres yoksa BOŞ, localhost DEĞİL', () => {
  it('ortak paket (env yok, dev yok) → ""', () => {
    expect(autoUrlFrom(undefined, null)).toBe('');
    expect(autoUrlFrom('  ', null)).toBe('');
    expect(hasServerAddress(autoUrlFrom(undefined, null))).toBe(false);
  });
  it('eski kanal paketi (gömülü adres) aynen; geliştirmede dev-host', () => {
    expect(autoUrlFrom('http://192.168.1.250:4000/api', null)).toBe('http://192.168.1.250:4000/api');
    expect(autoUrlFrom('http://192.168.1.250:4000/api', '10.0.0.5')).toBe('http://10.0.0.5:4000/api');
    expect(hasServerAddress('http://192.168.1.250:4000/api')).toBe(true);
  });
});

describe('§2 RootNavigator — adres yoksa ilk ekran ServerSetup, hiçbir istek atılmaz', () => {
  const src = readFileSync(join(__dirname, '../../navigation/RootNavigator.tsx'), 'utf8');
  it('ServerSetup dalı pairing/login dallarından ÖNCE', () => {
    const kurulum = src.indexOf('{!hasServer ? (');
    expect(kurulum).toBeGreaterThan(-1);
    expect(src.indexOf('name="ServerSetup" component={ServerSetupScreen}')).toBeGreaterThan(kurulum);
    expect(src.indexOf(') : showPairingGate ? (')).toBeGreaterThan(kurulum);
  });
  it('cihaz sorguları ve duyuru adres kapısının arkasında', () => {
    expect(src).toMatch(/queryFn: deviceService\.getAssignmentRequired,\s*enabled: hasServer,/);
    expect(src).toMatch(/enabled: hasServer && assignmentRequired,/);
    expect(src).toMatch(/if \(!hasServerAddress\(getCurrentBaseUrl\(\)\)\) return;/);
  });
});

describe('§3 ServerSetupScreen', () => {
  beforeEach(() => {
    discoverMock.mockReset();
    useBaseUrlStore.setState({ baseUrl: '', customUrl: null, recentUrls: [], isLoaded: true });
  });

  it('§3a "Sunucuyu ekle": iki EŞİT yol (QR · adres); adres yolunda ağ araması ekleme kipinde', async () => {
    discoverMock.mockResolvedValue({ candidates: [SUNUCU] } as never);
    renderWithPaper(<ServerSetupScreen />);
    expect(screen.getByText('Sunucuyu ekle')).toBeTruthy();
    expect(screen.getByTestId('sunucu-ekle-qr')).toBeTruthy();
    expect(screen.getByTestId('sunucu-ekle-adres')).toBeTruthy();
    expect(discoverMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-ekle-adres'));
    });
    expect(screen.getByTestId('sunucu-adres-input')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-ara'));
    });
    await waitFor(() => expect(discoverMock).toHaveBeenCalledTimes(1));
    expect(discoverMock.mock.calls[0][0]).toMatchObject({ tlsRoute: false });
    expect(await screen.findByText('Örnek Tekstil', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('§3b "Adresi elle gir" elle adres modalını açar', async () => {
    discoverMock.mockResolvedValue({ candidates: [] } as never);
    renderWithPaper(<ServerSetupScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('sunucu-elle-gir'));
    });
    expect(await screen.findByText('Sunucu Adresi')).toBeTruthy();
  });
});
