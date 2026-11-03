// Belge masası kamerası (K23): Okut → tam çözünürlük sayfa; sayfa varken "Sayfa ekle" / "Tekrar çek" / "Oku";
// son oluşturulanlar şeridi. Otomatik çekim kararı saf fonksiyonda sınanır (autoCapture.test.ts).
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { ScanPage } from '../docScan';
import { initialAutoState } from './autoCapture';
import DeskCamera, { type DeskCameraProps } from './DeskCamera';

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

const page = { base64: 'QUJD', sha256: 'x', uri: 'file://1', width: 1, height: 1 } as ScanPage;

function setup(over: Partial<DeskCameraProps> = {}) {
  const props: DeskCameraProps = {
    pages: [], sending: false, auto: false, frameMs: 700, recent: [],
    onCaptured: jest.fn(), onRetake: jest.fn(), onRead: jest.fn(), onError: jest.fn(), ...over,
  };
  return { props, s: renderWithPaper(<DeskCamera {...props} />) };
}

beforeEach(() => {
  mockTake.mockReset();
  mockTake.mockResolvedValue({ base64: 'QUJD', uri: 'file://p', width: 3000, height: 2000 });
});

describe('DeskCamera', () => {
  it('⭐ Okut → tam kalite çekim → sayfa (tek çağrı)', async () => {
    const { props, s } = setup();
    expect(s.getByTestId('masa-durum').props.children).toBe('Belgeyi masaya koyun');
    fireEvent.press(s.getByTestId('masa-okut'));
    await waitFor(() => expect(props.onCaptured).toHaveBeenCalledTimes(1));
    expect(mockTake).toHaveBeenCalledWith(expect.objectContaining({ quality: 0.8, base64: true }));
    expect(s.queryByTestId('masa-otomatik-ipucu')).toBeNull(); // dokunarak kip (varsayılan)
  });

  it('ekrana dokunmak da çeker', async () => {
    const { props, s } = setup();
    fireEvent.press(s.getByTestId('masa-kamera-yuzey'));
    await waitFor(() => expect(props.onCaptured).toHaveBeenCalledTimes(1));
  });

  it('sayfa varken: Sayfa ekle, Tekrar çek, Oku (n sayfa); şerit son oluşturulanları gösterir', () => {
    const { props, s } = setup({ pages: [page, page], recent: [{ noteNo: 'GB-1', workOrderNos: ['IE-1', 'IE-2'], at: 1 }] });
    expect(s.getByText('Sayfa ekle')).toBeTruthy();
    fireEvent.press(s.getByTestId('masa-tekrar-cek'));
    expect(props.onRetake).toHaveBeenCalled();
    fireEvent.press(s.getByTestId('masa-oku'));
    expect(props.onRead).toHaveBeenCalled();
    expect(s.getByText('Oku (2 sayfa)')).toBeTruthy();
    expect(s.getByText('IE-1, IE-2 · GB-1')).toBeTruthy();
  });

  it('çekim hatası bildirime gider, sayfa eklenmez', async () => {
    mockTake.mockRejectedValue(new Error('Kamera meşgul'));
    const { props, s } = setup();
    fireEvent.press(s.getByTestId('masa-okut'));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith('Kamera meşgul'));
    expect(props.onCaptured).not.toHaveBeenCalled();
  });

  it('otomatik kip deneysel ipucunu ve "Boş masayı yeniden tanı"yı gösterir', () => {
    const { s } = setup({ auto: true });
    expect(s.getByTestId('masa-otomatik-ipucu')).toBeTruthy();
    expect(s.getByTestId('masa-yeniden-tani')).toBeTruthy();
  });

  it('⭐ dışarıdan verilen otomatik durum: söküp yeniden takınca boş masa referansı korunur (yeniden kalibrasyon yok)', () => {
    const autoState = { current: { ...initialAutoState(), baseline: 40_000, armed: false, lastCaptured: 60_000, recent: [60_000] } };
    const a = setup({ auto: true, autoState });
    a.s.unmount();
    const { s } = setup({ auto: true, autoState });
    expect(s.getByTestId('masa-otomatik-ipucu').props.children).toBe('Otomatik (deneysel): Okunan kağıdı masadan kaldırın');
    expect(autoState.current).toMatchObject({ baseline: 40_000, lastCaptured: 60_000, recent: [] });
  });
});
