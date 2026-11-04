// Bekçi: canlı okuma (L2) JS katmanı. Eski APK/iOS/bozuk köprü → isLiveCameraAvailable false (çökmez); onText yükü
// ClientOcr sözleşmesinden geçer (sunucuya aynen gider), tavan aşımı/bozuk şekil → kare atlanır; native tavanlar
// (LiveTuning.kt) deviceOcr.ts tavanlarıyla AYNI; FIT_CENTER dönüşümü.
import * as fs from 'fs';
import * as path from 'path';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { CLIENT_OCR_MAX_LINES, CLIENT_OCR_MAX_WORDS } from './deviceOcr';
import {
  frameToView,
  isLiveCameraAvailable,
  parseLiveError,
  parseLiveStability,
  parseLiveStill,
  parseLiveText,
} from './liveCamera';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
const req = requireOptionalNativeModule as jest.MockedFunction<typeof requireOptionalNativeModule>;

const Q: [number, number][] = [[10, 10], [60, 10], [60, 30], [10, 30]];
const textEvent = (over: Record<string, unknown> = {}) => ({
  width: 960,
  height: 1280,
  rotation: 0,
  ms: 87,
  lines: [{ c: Q, p: 0.9 }],
  words: [{ t: 'İrsaliye', c: Q, l: 0, p: 0.95 }],
  sensorRotation: 90,
  at: 1_790_000_000_000,
  ...over,
});

const origOS = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: origOS, configurable: true });
  req.mockReset();
});
const android = () => Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

describe('isLiveCameraAvailable', () => {
  it('⭐ eski APK (modül yok / liveCameraInfo yok) → false, fırlatmaz', () => {
    android();
    req.mockReturnValue(null);
    expect(isLiveCameraAvailable()).toBe(false);
    req.mockReturnValue({ recognizeTextAsync: jest.fn() } as never);
    expect(isLiveCameraAvailable()).toBe(false);
    req.mockImplementation(() => {
      throw new Error('köprü bozuk');
    });
    expect(isLiveCameraAvailable()).toBe(false);
  });

  it('sürüm eksik/düşük ya da işlev fırlatırsa → false; sürüm ≥1 → true', () => {
    android();
    req.mockReturnValue({ liveCameraInfo: () => ({}) } as never);
    expect(isLiveCameraAvailable()).toBe(false);
    req.mockReturnValue({ liveCameraInfo: () => ({ version: 0 }) } as never);
    expect(isLiveCameraAvailable()).toBe(false);
    req.mockReturnValue({ liveCameraInfo: () => { throw new Error('x'); } } as never);
    expect(isLiveCameraAvailable()).toBe(false);
    req.mockReturnValue({ liveCameraInfo: () => ({ version: 1 }) } as never);
    expect(isLiveCameraAvailable()).toBe(true);
  });

  it('Android dışı → false (modüle hiç sorulmaz)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    req.mockReturnValue({ liveCameraInfo: () => ({ version: 1 }) } as never);
    expect(isLiveCameraAvailable()).toBe(false);
    expect(req).not.toHaveBeenCalled();
  });
});

describe('parseLiveText', () => {
  it('⭐ geçerli kare → ClientOcr (engine mlkit, rotation 0) + algılayıcı açısı + an', () => {
    expect(parseLiveText(textEvent())).toEqual({
      ocr: {
        engine: 'mlkit', width: 960, height: 1280, rotation: 0, ms: 87,
        lines: [{ c: Q, p: 0.9 }],
        words: [{ t: 'İrsaliye', c: Q, l: 0, p: 0.95 }],
      },
      sensorRotation: 90,
      at: 1_790_000_000_000,
    });
  });

  it('⭐ ocr sunucu tel sözleşmesinin anahtarlarından başkasını taşımaz (sensorRotation/at sızmaz)', () => {
    const f = parseLiveText(textEvent());
    expect(Object.keys(f!.ocr).sort()).toEqual(['engine', 'height', 'lines', 'ms', 'rotation', 'width', 'words']);
  });

  it('boş kare (kelime yok) geçerlidir', () => {
    expect(parseLiveText(textEvent({ lines: [], words: [] }))?.ocr.words).toEqual([]);
  });

  it('⭐ tavan aşımı / bozuk şekil / dik olmayan çerçeve / geçersiz açı → null (kare atlanır)', () => {
    const many = Array.from({ length: CLIENT_OCR_MAX_WORDS + 1 }, () => ({ t: 'a', c: Q, l: 0 }));
    expect(parseLiveText(textEvent({ words: many }))).toBeNull();
    expect(parseLiveText(textEvent({ words: [{ t: 'a', c: [[1, 2]], l: 0 }] }))).toBeNull();
    expect(parseLiveText(textEvent({ rotation: 90 }))).toBeNull();
    expect(parseLiveText(textEvent({ sensorRotation: 45 }))).toBeNull();
    expect(parseLiveText(textEvent({ width: 0 }))).toBeNull();
    expect(parseLiveText(null)).toBeNull();
    expect(parseLiveText('x')).toBeNull();
  });
});

describe('parseLiveStability / parseLiveError / parseLiveStill', () => {
  it('sabitlik: still boolean + netlik sonlu ≥0 (255 tavan); bozuk → null', () => {
    expect(parseLiveStability({ still: true, sharpness: 12.34 })).toEqual({ still: true, sharpness: 12.34 });
    expect(parseLiveStability({ still: false, sharpness: 999 })).toEqual({ still: false, sharpness: 255 });
    expect(parseLiveStability({ still: 'evet', sharpness: 1 })).toBeNull();
    expect(parseLiveStability({ still: true, sharpness: NaN })).toBeNull();
    expect(parseLiveStability({ still: true, sharpness: -1 })).toBeNull();
  });

  it('⭐ hata kaybolmaz: bilinen kod korunur, bilinmeyen UNKNOWN, mesajsız genel Türkçe metin', () => {
    expect(parseLiveError({ code: 'NO_PERMISSION', message: 'Kamera izni yok' })).toEqual({ code: 'NO_PERMISSION', message: 'Kamera izni yok' });
    expect(parseLiveError({ code: 'BAŞKA' })).toEqual({ code: 'UNKNOWN', message: 'Kamera çalışmadı' });
    expect(parseLiveError(undefined)).toEqual({ code: 'UNKNOWN', message: 'Kamera çalışmadı' });
  });

  it('fotoğraf: file:// + pozitif tamsayı boyut; değilse fırlatır', () => {
    expect(parseLiveStill({ uri: 'file:///c/canli-1.jpg', width: 3000, height: 4000 })).toEqual({ uri: 'file:///c/canli-1.jpg', width: 3000, height: 4000 });
    expect(() => parseLiveStill({ uri: 'content://x', width: 1, height: 1 })).toThrow('Fotoğraf çekilemedi');
    expect(() => parseLiveStill({ uri: 'file:///a.jpg', width: 0, height: 1 })).toThrow();
    expect(() => parseLiveStill(null)).toThrow();
  });
});

describe('frameToView (FIT_CENTER)', () => {
  it('kare görünüme orantılı sığar, boşluk ortalanır', () => {
    expect(frameToView({ width: 1280, height: 960 }, { width: 640, height: 640 })).toEqual({ scale: 0.5, dx: 0, dy: 80 });
    expect(frameToView({ width: 960, height: 1280 }, { width: 1000, height: 640 })).toEqual({ scale: 0.5, dx: 260, dy: 0 });
    expect(frameToView({ width: 0, height: 1 }, { width: 1, height: 1 })).toBeNull();
  });
});

describe('native tavan aynası', () => {
  it('⭐ LiveTuning.kt MAX_WORDS/MAX_LINES = deviceOcr.ts CLIENT_OCR_MAX_WORDS/LINES', () => {
    const kt = fs.readFileSync(
      path.join(__dirname, '../../modules/teks-erp-belge-tarayici/android/src/main/java/com/tekserp/belgetarayici/LiveTuning.kt'),
      'utf8',
    );
    const val = (name: string) => Number(new RegExp(`const val ${name} = (\\d+)`).exec(kt)?.[1]);
    expect(val('MAX_WORDS')).toBe(CLIENT_OCR_MAX_WORDS);
    expect(val('MAX_LINES')).toBe(CLIENT_OCR_MAX_LINES);
  });
});
