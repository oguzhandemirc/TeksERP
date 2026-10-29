// Belge Tara ekranı uçtan uca (sahte API): çekim → barkod → gönder → DRAFT + sayfa yüklemesi.
import React, { type ReactNode } from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import DocScanScreen from './DocScanScreen';

const mockCreate = jest.fn();
const mockUpload = jest.fn();
// Sahte JPEG (sihirli bayt) — her çekimde aynı içerik: ikinci çekim aynı fotoğraftır.
const mockB64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('sayfa-1'.repeat(40))]).toString('base64');

jest.mock('../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    tabletContext: async () => ({ success: true, data: { customers: [{ id: 'c1', name: 'Müşteri A' }] } }),
    createDraftNote: (b: unknown) => mockCreate(b),
    uploadScan: (b: unknown) => mockUpload(b),
  },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../components/ScreenChrome', () => ({ __esModule: true, default: ({ children }: { children: ReactNode }) => children }));
jest.mock('../../../components/BarcodeScannerModal', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    BarcodeScannerModal: (p: { visible: boolean; onScan: (c: string) => void }) =>
      p.visible ? (
        <Pressable testID="barkod-kamera" onPress={() => p.onScan('  IRS-77 ')}>
          <Text>barkod</Text>
        </Pressable>
      ) : null,
  };
});
jest.mock('./PageCameraModal', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  const { photoSha256 } = jest.requireActual('./docScan');
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

describe('DocScanScreen', () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue({ id: 'n1', noteNo: 'GB-0001', status: 'DRAFT' });
    mockUpload.mockReset().mockResolvedValue({ scan: { id: 's1', sha256: 'x', noteId: 'n1' }, duplicate: false, boundTo: 'n1' });
  });

  it('⭐ çekim (aynı foto iki kez → tek sayfa) + barkod → senderDocNo → gönder → DRAFT + tek tarama', async () => {
    const r = renderWithPaper(<DocScanScreen />);
    fireEvent.press(r.getByTestId('belge-tara-barkod'));
    fireEvent.press(r.getByTestId('barkod-kamera'));
    expect(r.getByTestId('belge-tara-belge-no')).toHaveTextContent('IRS-77');

    fireEvent.press(r.getByTestId('belge-tara-sayfa-ekle'));
    fireEvent.press(r.getByTestId('sayfa-kamera'));
    fireEvent.press(r.getByTestId('belge-tara-sayfa-ekle'));
    fireEvent.press(r.getByTestId('sayfa-kamera'));
    expect(r.getByText('Sayfalar (1)')).toBeTruthy();

    fireEvent.press(r.getByTestId('belge-tara-gonder'));
    await waitFor(() => expect(r.getByTestId('belge-tara-sonuc')).toHaveTextContent(/GB-0001/));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ sourceKind: 'MANUAL', senderDocNo: 'IRS-77', ownerCustomerId: null });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('pageCount');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toMatchObject({ noteId: 'n1', pageNo: 1, barcodeText: '  IRS-77 ', contentBase64: mockB64 });
    expect(mockUpload.mock.calls[0][0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
