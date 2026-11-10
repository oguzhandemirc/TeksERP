// Çok çekimli kamera: art arda çek → "Tamam" → iyileştirilmiş sayfalar ara ekransız; yer dolunca kendiliğinden biter;
// iyileştirme yoksa ham fotoğraf; çekim varken Vazgeç iki dokunuş; sil şeritten çıkarır.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { photoSha256 } from './docScan';
import MultiPageCameraModal, { MULTI_CAMERA_HINT } from './MultiPageCameraModal';

const mockTake = jest.fn();
jest.mock('expo-camera', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const CameraView = R.forwardRef((p: { onCameraReady?: () => void }, ref: unknown) => {
    R.useImperativeHandle(ref, () => ({ takePictureAsync: (o: unknown) => mockTake(o), getAvailablePictureSizesAsync: async () => ['4032x3024'] }));
    R.useEffect(() => p.onCameraReady?.(), []);
    return R.createElement(View, { testID: 'kamera-goruntusu' });
  });
  return { CameraView, useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] };
});
const mockEnhance = jest.fn();
jest.mock('../../../services/docScannerNative', () => ({ enhanceWithNative: (uri: string, req: unknown) => mockEnhance(uri, req) }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const jpeg = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag.repeat(30))]).toString('base64');
let n = 0;

function setup(capacity = 20) {
  const onDone = jest.fn();
  const onDismiss = jest.fn();
  const r = renderWithPaper(
    <MultiPageCameraModal visible capacity={capacity} firstPageNo={1} onDone={onDone} onDismiss={onDismiss} onError={jest.fn()} />,
  );
  return { r, onDone, onDismiss };
}

async function shoot(r: ReturnType<typeof renderWithPaper>) {
  fireEvent.press(r.getByTestId('belge-cok-cek'));
  await act(async () => {});
}

beforeEach(() => {
  n = 0;
  mockTake.mockReset().mockImplementation(async () => {
    n++;
    return { base64: jpeg(`ham${n}`), uri: `file:///ham${n}.jpg`, width: 4032, height: 3024 };
  });
  mockEnhance.mockReset().mockImplementation(async (uri: string) => {
    const tag = uri.replace('file:///', '').replace('.jpg', '');
    return { uri: `file:///${tag}-iyi.jpg`, base64: jpeg(`${tag}-iyi`), width: 1950, height: 2600, bytes: 1 };
  });
});

describe('MultiPageCameraModal', () => {
  it('⭐ çek ×2 → Tamam → 2 iyileştirilmiş sayfa doğrudan (ara ekran yok); iyileştirme çekim anında başlar', async () => {
    const { r, onDone } = setup();
    expect(r.getByTestId('belge-cok-sayac')).toHaveTextContent(new RegExp(MULTI_CAMERA_HINT));
    expect(r.getByTestId('belge-cok-tamam')).toBeDisabled();
    await shoot(r);
    await shoot(r);
    expect(mockEnhance).toHaveBeenCalledTimes(2);
    expect(mockEnhance).toHaveBeenCalledWith('file:///ham1.jpg', expect.objectContaining({ longEdge: 2600, quality: 0.8 }));
    expect(mockTake).toHaveBeenCalledWith(expect.objectContaining({ base64: true }));
    expect(r.getByText('Tamam (2)')).toBeTruthy();
    fireEvent.press(r.getByTestId('belge-cok-tamam'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const pages = onDone.mock.calls[0]![0];
    expect(pages.map((p: { uri: string }) => p.uri)).toEqual(['file:///ham1-iyi.jpg', 'file:///ham2-iyi.jpg']);
    expect(pages[0].sha256).toBe(photoSha256(jpeg('ham1-iyi')));
  });

  it('⭐ yer dolunca kendiliğinden biter (tek sayfalık arama Tamam istemez)', async () => {
    const { r, onDone } = setup(1);
    await shoot(r);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0]![0]).toHaveLength(1);
  });

  it('düğme sırası: Vazgeç en solda, Çek en sağda (Tamam arada)', () => {
    const { r } = setup();
    const order = r.UNSAFE_root.findAll((n: { type: unknown; props: { testID?: unknown } }) => typeof n.props.testID === 'string' && /^belge-cok-(vazgec|tamam|cek)$/.test(n.props.testID) && typeof n.type === 'string');
    const ids = order.map((n: { props: { testID: string } }): string => n.props.testID).filter((id: string, i: number, a: string[]) => a.indexOf(id) === i);
    expect(ids).toEqual(['belge-cok-vazgec', 'belge-cok-tamam', 'belge-cok-cek']);
  });

  it('tek çekimlik: sayfa no yazmaz, Tamam düğmesi yok', () => {
    const { r } = setup(1);
    expect(r.getByTestId('belge-cok-sayac')).not.toHaveTextContent(/Sayfa/);
    expect(r.queryByTestId('belge-cok-tamam')).toBeNull();
  });

  it('iyileştirme yok (eski APK) → ham fotoğraf gider', async () => {
    mockEnhance.mockResolvedValue(null);
    const { r, onDone } = setup();
    await shoot(r);
    fireEvent.press(r.getByTestId('belge-cok-tamam'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0]![0][0].uri).toBe('file:///ham1.jpg');
  });

  it('sil şeritten çıkarır; çıkarılan gönderilmez', async () => {
    const { r, onDone } = setup();
    await shoot(r);
    await shoot(r);
    fireEvent.press(r.getByTestId('belge-cok-sil-0'));
    await act(async () => {}); // portal içeriği mikrotask'ta güncellenir (SimplePortal)
    expect(r.getByText('Tamam (1)')).toBeTruthy();
    fireEvent.press(r.getByTestId('belge-cok-tamam'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0]![0].map((p: { uri: string }) => p.uri)).toEqual(['file:///ham2-iyi.jpg']);
  });

  it('Vazgeç: çekim yokken hemen kapanır; çekim varken ikinci dokunuşta', async () => {
    const a = setup();
    fireEvent.press(a.r.getByTestId('belge-cok-vazgec'));
    expect(a.onDismiss).toHaveBeenCalledTimes(1);
    a.r.unmount();

    const b = setup();
    await shoot(b.r);
    fireEvent.press(b.r.getByTestId('belge-cok-vazgec'));
    await act(async () => {});
    expect(b.onDismiss).not.toHaveBeenCalled();
    expect(b.r.getByTestId('belge-cok-sayac')).toHaveTextContent(/tekrar basın/);
    fireEvent.press(b.r.getByTestId('belge-cok-vazgec'));
    expect(b.onDismiss).toHaveBeenCalledTimes(1);
    expect(b.onDone).not.toHaveBeenCalled();
  });
});
