// Belge Tara ekranı uçtan uca (sahte API): çekim → barkod → gönder → DRAFT + sayfa yüklemesi.
import React, { type ReactNode } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import DocScanScreen from './DocScanScreen';

const mockCreate = jest.fn();
const mockUpload = jest.fn();
// Sahte JPEG (sihirli bayt) — her çekimde aynı içerik: ikinci çekim aynı fotoğraftır.
const mockB64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('sayfa-1'.repeat(40))]).toString('base64');
const mockB64b = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('sayfa-2'.repeat(40))]).toString('base64');

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
  const { Pressable, Text, View } = jest.requireActual('react-native');
  const { photoSha256 } = jest.requireActual('./docScan');
  const shot = (b64: string, uri: string) => ({ base64: b64, sha256: photoSha256(b64), uri, width: 2600, height: 1950 });
  return {
    __esModule: true,
    default: (p: { visible: boolean; onCaptured: (x: unknown) => void }) =>
      p.visible ? (
        <View>
          <Pressable testID="sayfa-kamera" onPress={() => p.onCaptured(shot(mockB64, 'file:///1.jpg'))}>
            <Text>kamera</Text>
          </Pressable>
          <Pressable testID="sayfa-kamera-2" onPress={() => p.onCaptured(shot(mockB64b, 'file:///2.jpg'))}>
            <Text>kamera 2</Text>
          </Pressable>
        </View>
      ) : null,
  };
});

// Portal içeriği host'a mikrotask'ta taşınır (SimplePortal): önizleme içi dokunuştan sonra boşalt.
async function pressFlush(el: Parameters<typeof fireEvent.press>[0]) {
  fireEvent.press(el);
  await act(async () => {});
}

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

  it('küçük resme dokununca tam ekran önizleme açılır; geçiş sayfayı değiştirir; sil ve kapat çalışır', async () => {
    const r = renderWithPaper(<DocScanScreen />);
    fireEvent.press(r.getByTestId('belge-tara-sayfa-ekle'));
    fireEvent.press(r.getByTestId('sayfa-kamera'));
    fireEvent.press(r.getByTestId('belge-tara-sayfa-ekle'));
    fireEvent.press(r.getByTestId('sayfa-kamera-2'));
    expect(r.getByText('Sayfalar (2)')).toBeTruthy();
    expect(r.queryByTestId('belge-tara-onizleme')).toBeNull();
    // AppModal'ın ilk (kapalı) bağlanışındaki animasyon geri çağrısı (`finishHide`) açılıştan ÖNCE boşalsın; yoksa açılışı ezer.
    await act(async () => {});

    fireEvent.press(r.getByTestId('belge-tara-sayfa-2'));
    await act(async () => {});
    expect(r.getByTestId('belge-tara-onizleme')).toBeTruthy();
    expect(r.getByTestId('belge-tara-onizleme-baslik')).toHaveTextContent('Sayfa 2 / 2');
    expect(r.getByTestId('belge-tara-onizleme-gorsel').props.source).toEqual({ uri: 'file:///2.jpg' });

    await pressFlush(r.getByTestId('belge-tara-onizleme-onceki'));
    expect(r.getByTestId('belge-tara-onizleme-baslik')).toHaveTextContent('Sayfa 1 / 2');
    expect(r.getByTestId('belge-tara-onizleme-gorsel').props.source).toEqual({ uri: 'file:///1.jpg' });
    await pressFlush(r.getByTestId('belge-tara-onizleme-sonraki'));
    expect(r.getByTestId('belge-tara-onizleme-baslik')).toHaveTextContent('Sayfa 2 / 2');

    // Önizlemeden sil → kalan sayfada kalır.
    await pressFlush(r.getByTestId('belge-tara-onizleme-sil'));
    expect(r.getByText('Sayfalar (1)')).toBeTruthy();
    expect(r.getByTestId('belge-tara-onizleme-baslik')).toHaveTextContent('Sayfa 1 / 1');
    expect(r.queryByTestId('belge-tara-onizleme-onceki')).toBeNull();

    // Kapanış animasyonu (reanimated) sahte saatle sürülür; sonunda `finishHide` portal kaydını siler.
    jest.useFakeTimers();
    try {
      await pressFlush(r.getByTestId('belge-tara-onizleme-kapat'));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await act(async () => {});
      expect(r.queryByTestId('belge-tara-onizleme')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
