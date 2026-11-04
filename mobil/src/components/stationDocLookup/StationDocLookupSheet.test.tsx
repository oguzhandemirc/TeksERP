// K17 — "Belgeden iş bul" kartı: fotoğraf → tek İE açılır; çok → liste; yok → mesaj; elle arama sunucuya gider.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import StationDocLookupSheet from './StationDocLookupSheet';
import { useDeviceSettingsStore } from '../../store/deviceSettingsStore';

const mockByPhoto = jest.fn();
const mockBySearch = jest.fn();
jest.mock('../../services/stationDocLookup.service', () => ({
  stationDocLookupService: { byPhoto: (b: string, s: string) => mockByPhoto(b, s), bySearch: (q: string) => mockBySearch(q) },
}));
const mockScanner = jest.fn();
jest.mock('../../services/docScannerNative', () => ({ scanWithDocScanner: (req: unknown) => mockScanner(req) }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../screens/Modules/GelenBelge/MultiPageCameraModal', () => ({ __esModule: true, default: () => null }));

const b64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('belge'.repeat(40))]).toString('base64');
const wo = (n: string) => ({ id: `id-${n}`, workOrderNumber: n, status: 'IN_PROGRESS', cardBarcode: `K-${n}`, batchNumbers: [`P-${n}`], documents: [{ noteNo: 'GB1', senderDocNo: '914279' }] });
const result = (workOrders: unknown[], outcome: string, message: string) => ({ outcome, source: 'OCR', read: null, workOrders, message });

function setup(readerConfigured = true) {
  const onOpen = jest.fn();
  const r = renderWithPaper(<StationDocLookupSheet visible onDismiss={jest.fn()} onOpen={onOpen} readerConfigured={readerConfigured} />);
  return { ...r, onOpen };
}

beforeEach(() => {
  jest.clearAllMocks();
  useDeviceSettingsStore.setState({ docScanEngine: 'mlkit' }); // tarayıcı yolu (cihaz ayarı) sınanır
  mockScanner.mockResolvedValue({ kind: 'pages', pages: [{ uri: 'file:///1.jpg', base64: b64, width: 2600, height: 1950 }] });
});

it('⭐ belge okut → tek sayfa istenir, tek iş emri doğrudan açılır', async () => {
  mockByPhoto.mockResolvedValue(result([wo('IE1')], 'SINGLE', 'bulundu'));
  const { findByTestId, onOpen } = setup();
  fireEvent.press(await findByTestId('belge-okut-cek'));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ cardBarcode: 'K-IE1' })));
  expect(mockScanner).toHaveBeenCalledWith(expect.objectContaining({ pageLimit: 1 }));
  expect(mockByPhoto.mock.calls[0]![0]).toBe(b64);
});

it('⭐ çok iş emri → liste; seçilen açılır', async () => {
  mockByPhoto.mockResolvedValue(result([wo('IE1'), wo('IE2')], 'MULTIPLE', '2 terbiye iş emri bulundu; açılacak olanı seçin.'));
  const { findByTestId, getByText, onOpen } = setup();
  fireEvent.press(await findByTestId('belge-okut-cek'));
  expect(await findByTestId('belge-okut-liste')).toBeTruthy();
  expect(getByText('P-IE2 · Belge 914279')).toBeTruthy();
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.press(await findByTestId('belge-okut-ie-IE2'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ workOrderNumber: 'IE2' }));
});

it('⭐ iş emri yok → sunucunun mesajı; elle arama sunucuya gider', async () => {
  mockBySearch.mockResolvedValue(result([], 'NO_WORK_ORDER', 'Aramaya uyan terbiye iş emri yok.'));
  const { findByTestId, getByTestId, onOpen } = setup(false);
  expect(() => getByTestId('belge-okut-cek')).toThrow(); // okuyucu yok → yalnız elle arama
  fireEvent.changeText(getByTestId('belge-okut-ara-metin'), ' 914279 ');
  await act(async () => {}); // portal içeriği host'a mikrotask'ta taşınır (SimplePortal): düğme kilidi açılsın
  fireEvent.press(getByTestId('belge-okut-ara'));
  expect(await findByTestId('belge-okut-yok')).toHaveTextContent('Aramaya uyan terbiye iş emri yok.');
  expect(mockBySearch).toHaveBeenCalledWith('914279');
  expect(onOpen).not.toHaveBeenCalled();
});
