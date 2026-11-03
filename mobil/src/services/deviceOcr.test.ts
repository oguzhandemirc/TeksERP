// Bekçi: cihazda OCR (S16c) kapısı + tel dönüştürücüsü. Modül yok · fonksiyon yok · reddedildi · zaman aşımı · bozuk
// şekil → null (sayfa bugünkü gibi sunucuda okunur); bu katman hiçbir yolda fırlatmaz. Satır sırası `l` ZORUNLU.
import { requireOptionalNativeModule } from 'expo';
import { CLIENT_OCR_MAX_WORDS, prefetchPageText, readPageText, resetDeviceOcrCache, toClientOcr } from './deviceOcr';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
const req = requireOptionalNativeModule as jest.MockedFunction<typeof requireOptionalNativeModule>;

const Q: [number, number][] = [[10, 10], [60, 10], [60, 30], [10, 30]];
const raw = (over: Record<string, unknown> = {}) => ({
  width: 1950,
  height: 2600,
  rotation: 0,
  ms: 412.6,
  lines: [{ c: Q, p: 0.9 }],
  words: [{ t: 'Toplam', c: Q, l: 0, p: 0.95 }],
  ...over,
});
const page = (sha = 'a'.repeat(64)) => ({ sha256: sha, uri: `file:///${sha.slice(0, 4)}.jpg` });

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  req.mockReset();
  resetDeviceOcrCache();
  jest.useRealTimers();
});

describe('toClientOcr', () => {
  it('⭐ geçerli native dönüşü → tel sözleşmesi (engine mlkit, satır sırası, ms tamsayı)', () => {
    expect(toClientOcr(raw())).toEqual({
      engine: 'mlkit', width: 1950, height: 2600, rotation: 0, ms: 413,
      lines: [{ c: Q, p: 0.9 }],
      words: [{ t: 'Toplam', c: Q, l: 0, p: 0.95 }],
    });
  });

  it('⭐ satır sırası `l` yoksa ya da satır listesinin dışındaysa → null (tablo satırları ancak cihaz satırıyla kurulur)', () => {
    expect(toClientOcr(raw({ words: [{ t: 'A', c: Q, p: 1 }] }))).toBeNull();
    expect(toClientOcr(raw({ words: [{ t: 'A', c: Q, l: 1, p: 1 }] }))).toBeNull();
  });

  it('bozuk şekil → null: 3 köşe · sonsuz koordinat · |v| > 20000 · boyut 0 · dönüş 45 · liste yok', () => {
    expect(toClientOcr(raw({ words: [{ t: 'A', c: Q.slice(0, 3), l: 0 }] }))).toBeNull();
    expect(toClientOcr(raw({ lines: [{ c: [[0, 0], [Infinity, 0], [1, 1], [0, 1]] }] }))).toBeNull();
    expect(toClientOcr(raw({ lines: [{ c: [[0, 0], [20001, 0], [1, 1], [0, 1]] }] }))).toBeNull();
    expect(toClientOcr(raw({ width: 0 }))).toBeNull();
    expect(toClientOcr(raw({ rotation: 45 }))).toBeNull();
    expect(toClientOcr(raw({ words: undefined }))).toBeNull();
    expect(toClientOcr(null)).toBeNull();
  });

  it('tavan aşımı (kelime > 4000) → null; tavanda kabul', () => {
    const w = { t: 'x', c: Q, l: 0 };
    expect(toClientOcr(raw({ words: Array.from({ length: CLIENT_OCR_MAX_WORDS + 1 }, () => w) }))).toBeNull();
    expect(toClientOcr(raw({ words: Array.from({ length: CLIENT_OCR_MAX_WORDS }, () => w) }))?.words).toHaveLength(CLIENT_OCR_MAX_WORDS);
  });

  it('boş kelime atılır, kelime 200 karaktere kısalır, güven [0,1]e kırpılır, NaN güven null; 90° dönüş geçer', () => {
    const r = toClientOcr(raw({
      rotation: 90,
      words: [{ t: '  ', c: Q, l: 0 }, { t: 'y'.repeat(250), c: Q, l: 0, p: 1.7 }, { t: 'z', c: Q, l: 0, p: NaN }],
    }));
    expect(r?.rotation).toBe(90);
    expect(r?.words.map((w) => [w.t.length, w.p])).toEqual([[200, 1], [1, null]]);
  });
});

describe('readPageText — düşme yolları', () => {
  it('modül yok (eski APK) → null', async () => {
    req.mockReturnValue(null);
    await expect(readPageText(page())).resolves.toBeNull();
  });

  it('modül çözümlemesi patlar · fonksiyon yok (eski native) → null', async () => {
    req.mockImplementation(() => { throw new Error('x'); });
    await expect(readPageText(page())).resolves.toBeNull();
    req.mockReset();
    req.mockReturnValue({ scanAsync: jest.fn() });
    await expect(readPageText(page('b'.repeat(64)))).resolves.toBeNull();
  });

  it('native reddeder · eşzamanlı fırlatır · bozuk şekil döner → null', async () => {
    req.mockReturnValue({ recognizeTextAsync: jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'ERR_TEXT_READ_FAILED' }); }) });
    await expect(readPageText(page('1'.repeat(64)))).resolves.toBeNull();
    req.mockReturnValue({ recognizeTextAsync: jest.fn(() => { throw new Error('senkron'); }) });
    await expect(readPageText(page('2'.repeat(64)))).resolves.toBeNull();
    req.mockReturnValue({ recognizeTextAsync: jest.fn(async () => ({ width: 1 })) });
    await expect(readPageText(page('3'.repeat(64)))).resolves.toBeNull();
  });

  it('⭐ zaman aşımı (4 sn) → null; native de aynı süreyi alır', async () => {
    jest.useFakeTimers();
    const fn = jest.fn(() => new Promise(() => {}));
    req.mockReturnValue({ recognizeTextAsync: fn });
    const p = readPageText(page());
    jest.advanceTimersByTime(3999);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(p).resolves.toBeNull();
    expect(fn).toHaveBeenCalledWith('file:///aaaa.jpg', 4000);
  });

  it('⭐ önden okuma + gönderim aynı native çağrıyı paylaşır; başarısız okuma önbellekte kalmaz', async () => {
    const fn = jest.fn(async () => raw());
    req.mockReturnValue({ recognizeTextAsync: fn });
    prefetchPageText(page());
    const r = await readPageText(page());
    expect(r?.words[0]?.t).toBe('Toplam');
    expect(fn).toHaveBeenCalledTimes(1);

    const bad = jest.fn(async () => { throw new Error('x'); });
    req.mockReturnValue({ recognizeTextAsync: bad });
    await readPageText(page('c'.repeat(64)));
    await readPageText(page('c'.repeat(64)));
    expect(bad).toHaveBeenCalledTimes(2);
  });
});
