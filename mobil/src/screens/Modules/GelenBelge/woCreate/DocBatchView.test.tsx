// Belge okut (kısayol formu): tarayıcı/galeri belgenin bütün sayfalarını verince yükleme + okuma kendiliğinden başlar
// (ayrı "Belgeyi gönder ve oku" dokunuşu yok); klasik kamera sayfa sayfa çeker → gönder düğmesi kalır.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import DocBatchView from './DocBatchView';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';

const mockCreate = jest.fn();
const mockUpload = jest.fn();
const mockAddNote = jest.fn();
const mockB64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('sayfa-1'.repeat(40))]).toString('base64');

jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    tabletContext: async () => ({ success: true, data: { customers: [] } }),
    createDraftNote: (b: unknown) => mockCreate(b),
    uploadScan: (b: unknown) => mockUpload(b),
  },
}));
const mockScanner = jest.fn();
jest.mock('../../../../services/docScannerNative', () => ({ scanWithDocScanner: (req: unknown) => mockScanner(req) }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('./DocRowCard', () => ({ __esModule: true, default: () => null }));
jest.mock('./useWoRows', () => ({
  useWoRows: () => ({
    rows: [], mode: 'WITH_WORK_ORDER', autoPrint: false, saving: false, addNote: mockAddNote, saveAll: jest.fn(),
    counts: { total: 0, ready: 0, reading: 0, opened: 0, drafts: 0, failed: 0 },
  }),
}));
jest.mock('../MultiPageCameraModal', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  const { photoSha256 } = jest.requireActual('../docScan');
  return {
    __esModule: true,
    default: (p: { visible: boolean; onDone: (x: unknown[]) => void }) =>
      p.visible ? (
        <Pressable testID="sayfa-kamera" onPress={() => p.onDone([{ base64: mockB64, sha256: photoSha256(mockB64), uri: 'file:///1.jpg', width: 2600, height: 1950 }])}>
          <Text>kamera</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock('../PageCameraModal', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  const { photoSha256 } = jest.requireActual('../docScan');
  return {
    __esModule: true,
    default: (p: { visible: boolean; onCaptured: (x: unknown) => void }) =>
      p.visible ? (
        <Pressable testID="sayfa-kamera" onPress={() => p.onCaptured({ base64: mockB64, sha256: photoSha256(mockB64), uri: 'file:///1.jpg', width: 2600, height: 1950 })}>
          <Text>kamera</Text>
        </Pressable>
      ) : null,
  };
});

const route = { id: 'rt1', name: 'Kurşun & Tambur', steps: [] } as unknown as Parameters<typeof DocBatchView>[0]['route'];

beforeEach(() => {
  useDeviceSettingsStore.setState({ docScanEngine: 'mlkit' }); // tarayıcı yolu (cihaz ayarı) sınanır
  mockCreate.mockReset().mockResolvedValue({ id: 'n1', noteNo: 'GB-0001', status: 'DRAFT' });
  mockUpload.mockReset().mockResolvedValue({ scan: { id: 's1', sha256: 'x', noteId: 'n1' }, duplicate: false, boundTo: 'n1' });
  mockAddNote.mockReset();
  mockScanner.mockReset();
});

describe('DocBatchView — Belge okut', () => {
  it('⭐ tarayıcı sayfaları verince gönderim kendiliğinden: taslak + yükleme, ayrı gönder düğmesi yok', async () => {
    mockScanner.mockResolvedValue({ kind: 'pages', pages: [{ uri: 'file:///t1.jpg', base64: mockB64, width: 1950, height: 2600, bytes: 300 }] });
    const r = renderWithPaper(<DocBatchView route={route} />);
    expect(r.queryByTestId('belge-ie-gonder')).toBeNull();
    fireEvent.press(r.getByTestId('belge-tara-sayfa-ekle'));
    await waitFor(() => expect(mockAddNote).toHaveBeenCalledWith({ id: 'n1', noteNo: 'GB-0001' }, 1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(r.queryByTestId('belge-ie-gonder')).toBeNull();
  });

  it('⭐ tarayıcı yok → kendi çok çekimli kameramız; "Tamam" sayfaları verince gönderim kendiliğinden', async () => {
    mockScanner.mockResolvedValue({ kind: 'unavailable', reason: 'no_module' });
    const r = renderWithPaper(<DocBatchView route={route} />);
    fireEvent.press(r.getByTestId('belge-tara-sayfa-ekle'));
    fireEvent.press(await r.findByTestId('sayfa-kamera'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId('belge-ie-gonder')).toBeNull();
  });

  it('klasik kamera: sayfa sayfa çekim → gönderim kullanıcıyla, düğme görünür', async () => {
    const r = renderWithPaper(<DocBatchView route={route} />);
    fireEvent.press(r.getByTestId('belge-tara-klasik-kamera'));
    fireEvent.press(await r.findByTestId('sayfa-kamera'));
    await act(async () => {});
    expect(mockCreate).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('belge-ie-gonder'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  });
});
