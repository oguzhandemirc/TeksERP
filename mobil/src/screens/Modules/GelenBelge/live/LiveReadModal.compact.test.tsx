// Bekçi: canlı okuma ekranı dar/dikey ekranda (el terminali 480×800, telefon). Kamera tam genişlik, yan panel YOK; "Çek ve
// bitir" üstünde tek satır özet şeridi (sayım + işaretler `liveSummary` modelinden); şeride dokununca alttan alan sayfası
// (aynı LiveFieldPanel, tam alan listesi); sayfa açıkken okuma döngüsü sürer, alanlar canlı güncellenir; ▼ ve arka kapatır.
// Geniş ekranda bugünkü yan panel kalır, şerit yoktur.
import React from 'react';
import { act, fireEvent, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import LiveReadModal, { LIVE_FOUND, LIVE_FOUND_SHORT } from './LiveReadModal';
import { resetLiveLocks } from './liveLocks';
import { fitLiveStrip, liveProgress, liveStripItems, liveStripMark } from './liveSummary';
import { LIVE_REQUEST_INTERVAL_MS } from './liveTuning';
import type { LiveField, LiveVoteState } from './liveVote';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';

let mockDims = { width: 480, height: 800, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
type CamProps = { onText?: (f: unknown) => void; onStability?: (s: unknown) => void };
const mockCam: { props: CamProps | null } = { props: null };
jest.mock('../../../../components/liveCamera/LiveCameraView', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: R.forwardRef((p: CamProps, ref: unknown) => {
      mockCam.props = p;
      R.useImperativeHandle(ref, () => ({ captureStill: jest.fn(), setActive: async () => undefined }));
      return R.createElement(View, { testID: 'canli-onizleme' });
    }),
  };
});
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] }));
jest.mock('../../../../services/docScannerNative', () => ({ enhanceWithNative: jest.fn() }));
const mockRead = jest.fn();
jest.mock('../../../../services/liveRead.service', () => ({ liveReadService: { readFrame: (o: unknown) => mockRead(o) } }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const frame = { ocr: { engine: 'mlkit', width: 1000, height: 1400, words: [] }, sensorRotation: 0, at: 1 };
const reading = (fis: string | null, parti: string | null) => ({
  template: { code: 'IRS', name: 'Çok uzun adlı örnek tekstil sevk irsaliyesi', version: 1 },
  score: 0.9,
  engineMs: 12,
  fields: [
    { key: 'belgeNo', label: 'Fiş no', value: fis, needsReview: false },
    { key: 'partiNo', label: 'Parti', value: parti, needsReview: false },
    { key: 'hedefMetraj', label: 'Metraj', value: null, needsReview: false },
    { key: 'renk', label: 'Renk açıklaması', value: null, needsReview: false },
    { key: 'desen', label: 'Desen kodu', value: null, needsReview: false },
    { key: 'musteri', label: 'Müşteri', value: 'Örnek', needsReview: false },
  ],
});

let now = 1_000_000;
beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockCam.props = null;
  mockRead.mockReset();
  resetLiveLocks();
  useDeviceSettingsStore.setState({ docDeskCaptureMode: 'tap' });
  mockDims = { width: 480, height: 800, scale: 1, fontScale: 1 };
});
afterEach(() => jest.restoreAllMocks());

async function sendFrame(result: unknown) {
  now += LIVE_REQUEST_INTERVAL_MS;
  mockRead.mockResolvedValueOnce(result);
  await act(async () => mockCam.props?.onText?.(frame));
}
// Modal içeriği portalda ertelenmiş çizilir (Date.now sahte → waitFor yoklaması işlemez): bir act turu boşaltır.
const flush = () => act(async () => {});
const setup = () => renderWithPaper(<LiveReadModal visible capacity={20} firstPageNo={1} onDone={jest.fn()} onDismiss={jest.fn()} />);

describe('LiveReadModal — dar ekran', () => {
  it('⭐ 480×800: yan panel yok, şerit "Çek ve bitir" ile birlikte; sayım ve işaretler modelden; kısa rozet', async () => {
    const r = setup();
    expect(r.queryByTestId('canli-alan-paneli')).toBeNull();
    expect(r.getByTestId('canli-ozet-serit')).toBeTruthy();
    expect(r.getByTestId('canli-simdi-cek')).toBeTruthy();
    for (let i = 0; i < 3; i++) await sendFrame(reading('A-17', i === 2 ? null : '55'));
    expect(within(r.getByTestId('canli-durum')).getByText(LIVE_FOUND_SHORT)).toBeTruthy();
    expect(r.queryByText(LIVE_FOUND)).toBeNull();
    // Fiş no 3 kez aynı → kilitli; parti 2 kez → okunuyor; müşteri bilgi alanı sayılmaz (5 alan).
    expect(within(r.getByTestId('canli-ozet-sayi')).getByText('Okunan 1/5')).toBeTruthy();
    expect(r.getByTestId('canli-ozet-belgeNo-read')).toBeTruthy();
    expect(r.getByTestId('canli-ozet-partiNo-reading')).toBeTruthy();
    expect(r.queryByTestId('canli-ozet-musteri-reading')).toBeNull();
    expect(r.getByTestId('canli-ozet-fazla')).toBeTruthy(); // 5 alan 480 px'e sığmaz → "+N"
  });

  it('⭐ şeride dokununca alt sayfa: tam alan listesi; açıkken okuma sürer ve alan canlı güncellenir; ▼ ve arka kapatır', async () => {
    const r = setup();
    await sendFrame(reading('A-17', '55'));
    fireEvent.press(r.getByTestId('canli-ozet-serit'));
    await flush();
    expect(r.getByTestId('canli-alan-sayfasi')).toBeTruthy();
    for (const k of ['belgeNo', 'partiNo', 'hedefMetraj', 'renk', 'desen', 'musteri']) expect(r.getByTestId(`canli-alan-${k}`)).toBeTruthy();
    expect(r.getByText('Renk açıklaması')).toBeTruthy();
    expect(r.getByTestId('canli-onizleme')).toBeTruthy(); // kamera arkada açık
    await sendFrame(reading('A-17', '55'));
    await sendFrame(reading('A-17', '55'));
    expect(within(r.getByTestId('canli-alan-durum-belgeNo')).getByText('Kilitli')).toBeTruthy();
    expect(r.getByText('2/5 tamam')).toBeTruthy();
    fireEvent.press(r.getByTestId('canli-sayfa-kapat'));
    await flush();
    expect(r.queryByTestId('canli-alan-sayfasi')).toBeNull();
    expect(within(r.getByTestId('canli-ozet-sayi')).getByText('Okunan 2/5')).toBeTruthy();
    fireEvent.press(r.getByTestId('canli-ozet-serit'));
    await flush();
    fireEvent.press(r.getByTestId('canli-sayfa-arka'));
    await flush();
    expect(r.queryByTestId('canli-alan-sayfasi')).toBeNull();
  });

  it('⭐ geniş ekran (1280×800): bugünkü yan panel, şerit yok, uzun rozet', async () => {
    mockDims = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    const r = setup();
    await sendFrame(reading('A-17', '55'));
    expect(r.getByTestId('canli-alan-paneli')).toBeTruthy();
    expect(r.queryByTestId('canli-ozet-serit')).toBeNull();
    expect(r.getByText(LIVE_FOUND)).toBeTruthy();
  });
});

const field = (key: string, over: Partial<LiveField> = {}): LiveField => ({ key, label: key, history: [], candidate: null, lock: null, ...over });

describe('liveSummary', () => {
  it('işaretler: oy kilidi okundu · elle kilit · aday okunuyor · belgede yok · son kareler farklı → uyarı', () => {
    expect(liveStripMark(field('a', { lock: { value: '1', by: 'vote' }, history: ['1', '1', '1'] }))).toBe('read');
    expect(liveStripMark(field('a', { lock: { value: '1', by: 'user' } }))).toBe('userLocked');
    expect(liveStripMark(field('a', { candidate: '1', history: ['1'] }))).toBe('reading');
    expect(liveStripMark(field('a', { lock: { value: '1', by: 'vote' }, history: ['1', '2', '2'] }))).toBe('warn');
  });

  it('sayım panel başlığıyla aynı; bilgi alanı hariç; uyarılı alan şeritte öne, sığmayan "+N"', () => {
    const vote: LiveVoteState = {
      template: { code: 'X', name: 'X' },
      fields: [
        field('belgeNo', { label: 'Fiş no', lock: { value: '1', by: 'vote' }, history: ['1', '1', '1'] }),
        field('renk', { label: 'Renk', candidate: 'K', history: ['K'] }),
        field('partiNo', { label: 'Parti', lock: { value: '5', by: 'vote' }, history: ['5', '6', '6'] }),
        field('musteri', { label: 'Müşteri', candidate: 'M', history: ['M'] }),
      ],
    };
    expect(liveProgress(vote)).toEqual({ settled: 2, total: 3 });
    const items = liveStripItems(vote);
    expect(items.map((i) => i.key)).toEqual(['belgeNo', 'renk', 'partiNo']);
    const fit = fitLiveStrip(items, 17);
    expect(fit.shown.map((i) => i.key)).toEqual(['partiNo', 'belgeNo']);
    expect(fit.hidden).toBe(1);
    // Bütçe sıfırken bile bir alan görünür.
    expect(fitLiveStrip(items, 0).shown).toHaveLength(1);
  });
});
