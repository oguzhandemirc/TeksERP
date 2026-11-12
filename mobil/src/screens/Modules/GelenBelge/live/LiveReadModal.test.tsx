// Bekçi: canlı okuma ekranı (native kamera, iyileştirme ve sunucu mock'lu). Açılışta "Belge aranıyor…" + tarama çizgisi
// + hep görünen "Çek ve bitir"; uçuşta TEK istek; yanıt belge adını ve alanları gösterir; üç aynı okuma kilitler; kilitli +
// sabit + net → halka → tek çekim → onDone + kilitler fotoğrafa; "Çek ve bitir" elle bitirir; iyileştirme yoksa ekran açık
// kalır; kapandıktan sonra gelen yanıt atılır; müşteri yalnız bilgi; `live` bağlaması bu ekranı açar.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';
import { renderWithPaper } from '../../../../test/render';
import { photoSha256 } from '../docScan';
import MultiPageCameraModal from '../MultiPageCameraModal';
import LiveReadModal, { LIVE_SEARCHING } from './LiveReadModal';
import { bindLiveLocks, liveLocksFor, resetLiveLocks } from './liveLocks';
import { LIVE_HOLD_MS, LIVE_MIN_SHARPNESS, LIVE_REQUEST_INTERVAL_MS } from './liveTuning';
import { LIVE_CAPTURE_FAILED } from './useLiveCapture';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';

type CamProps = { onText?: (f: unknown) => void; onStability?: (s: unknown) => void };
const mockCam: { props: CamProps | null; still: jest.Mock } = { props: null, still: jest.fn() };
jest.mock('../../../../components/liveCamera/LiveCameraView', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: R.forwardRef((p: CamProps, ref: unknown) => {
      mockCam.props = p;
      R.useImperativeHandle(ref, () => ({ captureStill: () => mockCam.still(), setActive: async () => undefined }));
      return R.createElement(View, { testID: 'canli-onizleme' });
    }),
  };
});
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] }));
const mockEnhance = jest.fn();
jest.mock('../../../../services/docScannerNative', () => ({ enhanceWithNative: (uri: string, req: unknown) => mockEnhance(uri, req) }));
const mockRead = jest.fn();
jest.mock('../../../../services/liveRead.service', () => ({ liveReadService: { readFrame: (o: unknown) => mockRead(o) } }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('canli'.repeat(30))]).toString('base64');
const frame = { ocr: { engine: 'mlkit', width: 1000, height: 1400, words: [{ t: 'İrsaliye', c: [[10, 10], [90, 10], [90, 30], [10, 30]] }] }, sensorRotation: 0, at: 1 };
const reading = (metre: string | null, musteri: string | null = 'Örnek Tekstil') => ({
  template: { code: 'IRS', name: 'Örnek irsaliye', version: 1 },
  score: 0.9,
  engineMs: 12,
  fields: [
    { key: 'hedefMetraj', label: 'Metraj', value: metre, needsReview: false },
    { key: 'musteri', label: 'Müşteri', value: musteri, needsReview: false },
  ],
});

let now = 1_000_000;
beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockCam.props = null;
  mockCam.still.mockReset().mockResolvedValue({ uri: 'file:///canli.jpg', width: 3000, height: 4000 });
  mockEnhance.mockReset().mockResolvedValue({ uri: 'file:///canli-iyi.jpg', base64: jpeg, width: 1950, height: 2600, bytes: 1 });
  mockRead.mockReset();
  (Toast.show as jest.Mock).mockReset();
  resetLiveLocks();
  useDeviceSettingsStore.setState({ docDeskCaptureMode: 'auto' });
});
afterEach(() => jest.restoreAllMocks());

function setup() {
  const onDone = jest.fn();
  const onDismiss = jest.fn();
  const r = renderWithPaper(<LiveReadModal visible capacity={20} firstPageNo={1} onDone={onDone} onDismiss={onDismiss} />);
  return { r, onDone, onDismiss };
}

/** Bir kare gönder (aralık dolsun) ve yanıtın oylamaya girmesini bekle. */
async function sendFrame(result: unknown) {
  now += LIVE_REQUEST_INTERVAL_MS;
  mockRead.mockResolvedValueOnce(result);
  await act(async () => mockCam.props?.onText?.(frame));
}

describe('LiveReadModal', () => {
  it('⭐ açılış: "Belge aranıyor…", tarama çizgisi, "Çek ve bitir" hep görünür, panel boş', () => {
    const { r } = setup();
    expect(r.getByTestId('canli-durum')).toHaveTextContent(new RegExp(LIVE_SEARCHING));
    expect(r.getByTestId('canli-tarama-cizgisi')).toBeTruthy();
    expect(r.getByTestId('canli-simdi-cek')).toBeEnabled();
    expect(r.getByText('Belge tanınınca alanlar burada dolar.')).toBeTruthy();
  });

  it('⭐ uçuşta TEK istek: yanıt gelmeden yeni kare gönderilmez; yanıt belge adını ve alanları gösterir', async () => {
    const { r } = setup();
    let resolve: (v: unknown) => void = () => undefined;
    mockRead.mockImplementationOnce(() => new Promise((res) => (resolve = res)));
    fireEvent(r.getByTestId('canli-kamera'), 'layout', { nativeEvent: { layout: { width: 800, height: 600 } } });
    await act(async () => mockCam.props?.onText?.(frame));
    now += LIVE_REQUEST_INTERVAL_MS * 3;
    await act(async () => mockCam.props?.onText?.(frame));
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(r.getByTestId('canli-kutular').children.length).toBeGreaterThan(0);
    await act(async () => resolve(reading('1.250')));
    expect(r.getByTestId('canli-belge-adi')).toHaveTextContent('Örnek irsaliye');
    expect(r.queryByTestId('canli-tarama-cizgisi')).toBeNull();
    expect(r.getByTestId('canli-alan-durum-hedefMetraj')).toHaveTextContent(/Okunuyor/);
    expect(r.getByTestId('canli-alan-durum-musteri')).toHaveTextContent(/Bilgi/);
  });

  it('⭐ üç aynı okuma kilitler; kilitli + sabit + net → halka → TEK çekim → onDone + kilitler fotoğrafa (müşteri beklenmez)', async () => {
    const { r, onDone } = setup();
    for (let i = 0; i < 3; i++) await sendFrame(reading('1.250', null));
    expect(r.getByTestId('canli-alan-durum-hedefMetraj')).toHaveTextContent(/Kilitli/);
    const still = { still: true, sharpness: LIVE_MIN_SHARPNESS };
    await act(async () => mockCam.props?.onStability?.(still));
    expect(r.getByTestId('canli-halka')).toBeTruthy();
    now += LIVE_HOLD_MS;
    await act(async () => mockCam.props?.onStability?.(still));
    await act(async () => mockCam.props?.onStability?.(still));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockCam.still).toHaveBeenCalledTimes(1);
    const [[pages]] = onDone.mock.calls;
    expect(pages[0].sha256).toBe(photoSha256(jpeg));
    bindLiveLocks('not-1', [pages[0].sha256]);
    expect(liveLocksFor('not-1')).toEqual({ hedefMetraj: '1.250' });
  });

  it('⭐ çekim ayarı "Dokunarak": kilitli + net + süre dolsa da halka yok, otomatik çekim yok; "Çek ve bitir" çeker', async () => {
    useDeviceSettingsStore.setState({ docDeskCaptureMode: 'tap' });
    const { r, onDone } = setup();
    for (let i = 0; i < 3; i++) await sendFrame(reading('1.250', null));
    expect(r.getByTestId('canli-alan-durum-hedefMetraj')).toHaveTextContent(/Kilitli/);
    const still = { still: true, sharpness: LIVE_MIN_SHARPNESS };
    await act(async () => mockCam.props?.onStability?.(still));
    expect(r.queryByTestId('canli-halka')).toBeNull();
    now += LIVE_HOLD_MS * 3;
    await act(async () => mockCam.props?.onStability?.(still));
    expect(mockCam.still).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('canli-simdi-cek'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

});

describe('LiveReadModal — müşteri metni, öneri, netlik', () => {
  it('G müşteri okunmadıysa "Fotoğraftan eşleşecek"; C kilitli alanda farklı son kareler → öneri, dokununca elle kilit', async () => {
    const { r } = setup();
    for (let i = 0; i < 3; i++) await sendFrame(reading('1.250', null));
    expect(r.getByTestId('canli-alan-deger-musteri')).toHaveTextContent('Fotoğraftan eşleşecek');
    expect(r.queryByTestId('canli-alan-oneri-hedefMetraj')).toBeNull();
    for (let i = 0; i < 2; i++) await sendFrame(reading('1.520', null));
    expect(r.getByTestId('canli-alan-oneri-hedefMetraj')).toHaveTextContent(/Son karelerde: 1.520/);
    fireEvent.press(r.getByTestId('canli-alan-oneri-hedefMetraj'));
    await waitFor(() => expect(r.getByTestId('canli-alan-deger-hedefMetraj')).toHaveTextContent('1.520'));
    expect(r.queryByTestId('canli-alan-oneri-hedefMetraj')).toBeNull();
  });

  it('F bulanık karenin yanıtı oy değildir: net olmayan üç kare kilitlemez', async () => {
    const { r } = setup();
    await act(async () => mockCam.props?.onStability?.({ still: false, sharpness: 0.5 }));
    for (let i = 0; i < 3; i++) await sendFrame(reading('1.250'));
    expect(r.getByTestId('canli-alan-durum-hedefMetraj')).toHaveTextContent(/Okunuyor/);
    await act(async () => mockCam.props?.onStability?.({ still: true, sharpness: LIVE_MIN_SHARPNESS }));
    for (let i = 0; i < 3; i++) await sendFrame(reading('1.250'));
    expect(r.getByTestId('canli-alan-durum-hedefMetraj')).toHaveTextContent(/Kilitli/);
  });
});

describe('LiveReadModal — halka', () => {
  it('görüntü bulanıklaşır/kararırsa halka sıfırlanır, çekim olmaz', async () => {
    const { r, onDone } = setup();
    for (let i = 0; i < 3; i++) await sendFrame(reading('1.250'));
    await act(async () => mockCam.props?.onStability?.({ still: true, sharpness: LIVE_MIN_SHARPNESS }));
    now += LIVE_HOLD_MS;
    await act(async () => mockCam.props?.onStability?.({ still: true, sharpness: LIVE_MIN_SHARPNESS - 1 }));
    expect(r.queryByTestId('canli-halka')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

});

describe('LiveReadModal — elle bitiş, düzeltme, kapanış', () => {
  it('⭐ "Çek ve bitir" kilit olmadan da bitirir', async () => {
    const { r, onDone } = setup();
    fireEvent.press(r.getByTestId('canli-simdi-cek'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('iyileştirme yoksa: Toast, onDone yok, ekran açık kalır', async () => {
    mockEnhance.mockResolvedValueOnce(null);
    const { r, onDone } = setup();
    fireEvent.press(r.getByTestId('canli-simdi-cek'));
    await waitFor(() => expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: LIVE_CAPTURE_FAILED })));
    expect(onDone).not.toHaveBeenCalled();
    expect(r.getByTestId('canli-simdi-cek')).toBeEnabled();
  });

  it('elle düzeltme alanı kilitler; "Kilidi aç" açar; müşteri düzeltilemez', async () => {
    const { r } = setup();
    await sendFrame(reading('1.250'));
    fireEvent.press(r.getByTestId('canli-alan-hedefMetraj'));
    fireEvent.changeText(await r.findByTestId('canli-alan-girdi'), '1.300');
    fireEvent.press(r.getByTestId('canli-alan-kaydet'));
    await waitFor(() => expect(r.getByTestId('canli-alan-deger-hedefMetraj')).toHaveTextContent('1.300'));
    expect(r.getByTestId('canli-alan-durum-hedefMetraj')).toHaveTextContent(/Kilitli/);
    await waitFor(() => expect(r.queryByTestId('canli-alan-girdi')).toBeNull());
    fireEvent.press(r.getByTestId('canli-alan-hedefMetraj'));
    fireEvent.press(await r.findByTestId('canli-alan-kilit-ac'));
    await waitFor(() => expect(r.getByTestId('canli-alan-durum-hedefMetraj')).not.toHaveTextContent(/Kilitli/));
    expect(r.getByLabelText('Metraj düzelt')).toBeTruthy();
    expect(r.queryByLabelText('Müşteri düzelt')).toBeNull();
  });

  it('kapandıktan sonra gelen yanıt atılır (yeniden açılış temiz)', async () => {
    const props = { capacity: 20, firstPageNo: 1, onDone: jest.fn(), onDismiss: jest.fn() };
    const r = renderWithPaper(<LiveReadModal visible {...props} />);
    let resolve: (v: unknown) => void = () => undefined;
    mockRead.mockImplementationOnce(() => new Promise((res) => (resolve = res)));
    await act(async () => mockCam.props?.onText?.(frame));
    r.rerender(<LiveReadModal visible={false} {...props} />);
    r.rerender(<LiveReadModal visible {...props} />);
    await act(async () => resolve(reading('1.250')));
    expect(r.getByTestId('canli-durum')).toHaveTextContent(new RegExp(LIVE_SEARCHING));
  });

  it('kapat düğmesi onDismiss', () => {
    const { r, onDismiss } = setup();
    fireEvent.press(r.getByTestId('canli-kapat'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('⭐ `live` bağlaması MultiPageCameraModal içinden canlı ekranı açar', () => {
    const r = renderWithPaper(<MultiPageCameraModal visible live capacity={20} firstPageNo={1} onDone={jest.fn()} onDismiss={jest.fn()} onError={jest.fn()} />);
    expect(r.getByTestId('canli-kamera')).toBeTruthy();
    expect(r.queryByTestId('belge-cok-cek')).toBeNull();
  });
});
