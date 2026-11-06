// K17 — "Belgeden iş bul" kartı: fotoğraf → tek İE açılır; çok → liste; yok → mesaj; elle arama sunucuya gider.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../test/render';
import StationDocLookupSheet from './StationDocLookupSheet';
import { useDeviceSettingsStore } from '../../store/deviceSettingsStore';
import type { LookupScreen } from '../../services/stationDocLookup.service';

const mockByPhoto = jest.fn();
const mockBySearch = jest.fn();
const mockReport = jest.fn();
jest.mock('../../services/stationDocLookup.service', () => ({
  stationDocLookupService: {
    byPhoto: (b: string, s: string, sc?: unknown) => mockByPhoto(b, s, sc), bySearch: (q: string, sc?: unknown) => mockBySearch(q, sc),
    reportOpened: (...a: unknown[]) => mockReport(...a),
  },
}));
const mockScanner = jest.fn();
jest.mock('../../services/docScannerNative', () => ({ scanWithDocScanner: (req: unknown) => mockScanner(req) }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../screens/Modules/GelenBelge/MultiPageCameraModal', () => ({ __esModule: true, default: () => null }));

const b64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('belge'.repeat(40))]).toString('base64');
const wo = (n: string, extra: Record<string, unknown> = {}) => ({ id: `id-${n}`, workOrderNumber: n, status: 'IN_PROGRESS', cardBarcode: `K-${n}`, batchNumbers: [`P-${n}`], documents: [{ noteNo: 'GB1', senderDocNo: '914279' }], ...extra });
const result = (workOrders: unknown[], outcome: string, message: string) => ({ outcome, source: 'OCR', read: null, workOrders, message });

function setup(readerConfigured = true, screen?: LookupScreen) {
  const onOpen = jest.fn();
  const r = renderWithPaper(<StationDocLookupSheet visible onDismiss={jest.fn()} onOpen={onOpen} readerConfigured={readerConfigured} screen={screen} />);
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
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ cardBarcode: 'K-IE1' }), []));
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
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ workOrderNumber: 'IE2' }), [expect.objectContaining({ workOrderNumber: 'IE1' }), expect.objectContaining({ workOrderNumber: 'IE2' })]);
});

it('⭐ iş emri yok → sunucunun mesajı; elle arama sunucuya gider', async () => {
  mockBySearch.mockResolvedValue(result([], 'NO_WORK_ORDER', 'Aramaya uyan terbiye iş emri yok.'));
  const { findByTestId, getByTestId, onOpen } = setup(false);
  expect(() => getByTestId('belge-okut-cek')).toThrow(); // okuyucu yok → yalnız elle arama
  fireEvent.changeText(getByTestId('belge-okut-ara-metin'), ' 914279 ');
  await act(async () => {}); // portal içeriği host'a mikrotask'ta taşınır (SimplePortal): düğme kilidi açılsın
  fireEvent.press(getByTestId('belge-okut-ara'));
  expect(await findByTestId('belge-okut-yok')).toHaveTextContent('Aramaya uyan terbiye iş emri yok.');
  expect(mockBySearch).toHaveBeenCalledWith('914279', undefined);
  expect(onOpen).not.toHaveBeenCalled();
});

it('⭐ çok İE, ekran bildirilir: burada olanlar üstte; satırda parti no, ayrıntı ve nerede', async () => {
  const rich = (n: string, atStation: string, atStationText: string) => wo(n, {
    processText: 'YIKAMA', rollCount: 2, meters: 100, locationText: 'Şu an: Tambur 1 (2 top)', atStation, atStationText,
  });
  mockByPhoto.mockResolvedValue({ ...result([rich('IE1', 'NOT_YET', 'Buraya henüz gelmedi'), rich('IE2', 'HERE', 'Burada bekliyor'), rich('IE3', 'STARTABLE_HERE', 'Rotasız · burada başlatılabilir')], 'MULTIPLE', 'm'), station: { screen: 'TAMBUR', label: 'Tambur 1' } });
  const { findByTestId, getByTestId, getByText, onOpen } = setup(true, { screen: 'TAMBUR', stationId: 'st-1' });
  fireEvent.press(await findByTestId('belge-okut-cek'));
  expect(await findByTestId('belge-okut-liste')).toBeTruthy();
  expect(mockByPhoto.mock.calls[0]![2]).toEqual({ screen: 'TAMBUR', stationId: 'st-1' });
  expect(getByText('Bu belgede 3 parti var; 2 tanesi bu istasyonda (Tambur 1) açılabilir. Açılacak olanı seçin.')).toBeTruthy();
  expect(getByTestId('belge-okut-nerede-IE3')).toHaveTextContent('Rotasız · burada başlatılabilir · Şu an: Tambur 1 (2 top)');
  expect(getByText('P-IE2')).toBeTruthy();
  expect(onOpen).not.toHaveBeenCalled();
});

it('⭐ çok İE, yalnız biri burada → doğrudan açılır, kardeşler şerit için verilir', async () => {
  mockByPhoto.mockResolvedValue(result([wo('IE1', { atStation: 'PASSED' }), wo('IE2', { atStation: 'STARTABLE_HERE' })], 'MULTIPLE', 'm'));
  const { findByTestId, onOpen } = setup(true, { screen: 'KURSUN_QC' });
  fireEvent.press(await findByTestId('belge-okut-cek'));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ workOrderNumber: 'IE2' }), [expect.objectContaining({ workOrderNumber: 'IE1' }), expect.objectContaining({ workOrderNumber: 'IE2' })]));
});

it('⭐ eşik altı aday → kendiliğinden açılmaz; satır ne tuttuğunu söyler; yalnız "Eminim, aç" açar (CONFIRMED bildirilir)', async () => {
  const verification = { score: 55, passed: false, strongEvidence: true, threshold: 80, targetKey: 'n1', components: [{ key: 'ROLL_NOS', label: 'Top no', weight: 40, ratio: 0.2, matched: false, detail: '3/16' }] };
  mockByPhoto.mockResolvedValue({ ...result([], 'UNVERIFIED', 'sunucu'), unverifiedWorkOrders: [wo('IE1', { verification })], verification: { threshold: 80, bestScore: 55 }, checkId: 'chk-1' });
  const { findByTestId, getByTestId, getByText, onOpen } = setup();
  fireEvent.press(await findByTestId('belge-okut-cek'));
  expect(await findByTestId('belge-okut-emin-degil')).toBeTruthy();
  expect(getByText('Belge tam eşleşmedi (%55) — listeden seçin ya da fiş no ile arayın.')).toBeTruthy();
  expect(getByTestId('belge-okut-dogrulama-IE1')).toHaveTextContent('%55 · Top no ✗ 3/16');
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.press(getByTestId('belge-okut-onayla-IE1'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ workOrderNumber: 'IE1' }), [expect.objectContaining({ workOrderNumber: 'IE1' })]);
  expect(mockReport).toHaveBeenCalledWith('chk-1', 'IE1', 'CONFIRMED');
});

it('⭐ kendiliğinden açılan İE izine AUTO olarak bildirilir', async () => {
  mockByPhoto.mockResolvedValue({ ...result([wo('IE1')], 'SINGLE', 'bulundu'), checkId: 'chk-2' });
  const { findByTestId, onOpen } = setup();
  fireEvent.press(await findByTestId('belge-okut-cek'));
  await waitFor(() => expect(onOpen).toHaveBeenCalled());
  expect(mockReport).toHaveBeenCalledWith('chk-2', 'IE1', 'AUTO');
});
