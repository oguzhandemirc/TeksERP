// Sunucu ekleme akışı (K3): iki eşit yol; http adresi Türkçe hatayla reddedilir; IP yolunda gösterilen kod
// sunucunun izinden formatFingerprintGroups ile birebir; "Kodlar aynı" kod kararını tamamlamaya gönderir.
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithPaper } from '../../test/render';
import { INSECURE_ADDRESS_REASON, formatFingerprintGroups } from '../../lib/lan-tls';
import { probeTlsDetailed } from '../../services/tlsProbe';
import { completePairing } from '../../services/serverPairing';
import { ServerPairFlow } from './ServerPairFlow';

jest.mock('../BarcodeScannerModal', () => ({ BarcodeScannerModal: () => null }));
jest.mock('../../services/discovery.service', () => ({ discoverServers: jest.fn(async () => ({ candidates: [] })) }));
jest.mock('../../services/tlsProbe', () => ({ probeTlsDetailed: jest.fn() }));
jest.mock('../../services/serverPairing', () => ({ completePairing: jest.fn(async () => ({ ok: true })) }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const FP = '0123456789abcdef'.repeat(4);
const SERVER = { host: '192.168.1.50', port: 4443, fingerprint: FP, installationId: 'iid-1', identity: null, rttMs: 3 };

async function press(id: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
}

beforeEach(() => jest.clearAllMocks());

it('iki eşit yol: QR okut ve Adresi yaz', () => {
  renderWithPaper(<ServerPairFlow onDone={jest.fn()} />);
  expect(screen.getByTestId('sunucu-ekle-qr')).toBeTruthy();
  expect(screen.getByTestId('sunucu-ekle-adres')).toBeTruthy();
  expect(screen.getByText('QR okut')).toBeTruthy();
  expect(screen.getByText('Adresi yaz')).toBeTruthy();
});

it('http:// adres Türkçe hatayla reddedilir, yoklama yapılmaz', async () => {
  renderWithPaper(<ServerPairFlow onDone={jest.fn()} />);
  await press('sunucu-ekle-adres');
  fireEvent.changeText(screen.getByTestId('sunucu-adres-input'), 'http://192.168.1.50:4000');
  await press('sunucu-adres-devam');
  expect(screen.getByTestId('sunucu-ekle-hata')).toBeTruthy();
  expect(screen.getByText(INSECURE_ADDRESS_REASON)).toBeTruthy();
  expect(probeTlsDetailed).not.toHaveBeenCalled();
});

it('IP yolu: kod birebir gösterilir; "Kodlar aynı" kod kararıyla bağlanır', async () => {
  (probeTlsDetailed as jest.Mock).mockResolvedValue({ ok: true, server: SERVER });
  const onDone = jest.fn();
  renderWithPaper(<ServerPairFlow onDone={onDone} />);
  await press('sunucu-ekle-adres');
  fireEvent.changeText(screen.getByTestId('sunucu-adres-input'), '192.168.1.50');
  await press('sunucu-adres-devam');
  expect(probeTlsDetailed).toHaveBeenCalledWith('192.168.1.50', 4443, expect.any(Number));
  expect(screen.getByTestId('dogrulama-kodu').props.children).toBe(formatFingerprintGroups(FP));
  await press('kod-ayni');
  expect(completePairing).toHaveBeenCalledWith(
    expect.objectContaining({ baseUrl: 'https://192.168.1.50:4443', pin: expect.objectContaining({ via: 'kod', fingerprint: FP }) }),
  );
  expect(onDone).toHaveBeenCalled();
});

it('"Kodlar farklı" bağlanmaz, başa döner ve uyarır', async () => {
  (probeTlsDetailed as jest.Mock).mockResolvedValue({ ok: true, server: SERVER });
  renderWithPaper(<ServerPairFlow onDone={jest.fn()} />);
  await press('sunucu-ekle-adres');
  fireEvent.changeText(screen.getByTestId('sunucu-adres-input'), '192.168.1.50');
  await press('sunucu-adres-devam');
  await press('kod-farkli');
  expect(completePairing).not.toHaveBeenCalled();
  expect(screen.getByTestId('sunucu-ekle-qr')).toBeTruthy();
  expect(screen.getByTestId('sunucu-ekle-hata')).toBeTruthy();
});
