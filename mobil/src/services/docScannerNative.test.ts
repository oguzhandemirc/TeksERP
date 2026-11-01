// Bekçi: ML Kit belge tarayıcısının yetenek kapısı. Modül yok · arayüz eksik · Play Hizmetleri/modül hazır değil ·
// başlatılamadı → "kullanılamaz" (ekran klasik kameraya düşer); bu katman hiçbir yolda fırlatmaz.
import { requireOptionalNativeModule } from 'expo';
import { AVAILABILITY_TIMEOUT_MS, START_TIMEOUT_MS, scanWithDocScanner } from './docScannerNative';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
const req = requireOptionalNativeModule as jest.MockedFunction<typeof requireOptionalNativeModule>;
const REQ = { pageLimit: 20, longEdge: 2600, maxBytes: 5 * 1024 * 1024, quality: 0.8 };
const page = { uri: 'file:///a.jpg', base64: '/9j/AAAA', width: 1950, height: 2600, bytes: 6 };

function mod(over: Record<string, unknown> = {}) {
  return {
    availabilityAsync: jest.fn(async () => ({ available: true, reason: 'ok' })),
    scanAsync: jest.fn(async () => ({ canceled: false, pages: [page] })),
    ...over,
  };
}

beforeEach(() => req.mockReset());

it('modül yok (eski APK) → unavailable', async () => {
  req.mockReturnValue(null);
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'unavailable', reason: 'no_module' });
});

it('modül çözümlemesi patlarsa → unavailable', async () => {
  req.mockImplementation(() => {
    throw new Error('x');
  });
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'unavailable', reason: 'no_module' });
});

it('beklenen işlevleri taşımayan modül → unavailable', async () => {
  req.mockReturnValue({ availabilityAsync: jest.fn() });
  await expect(scanWithDocScanner(REQ)).resolves.toMatchObject({ kind: 'unavailable' });
});

it.each(['play_services', 'module_missing', 'timeout'])('uygunluk "%s" → tarama AÇILMAZ, unavailable', async (reason) => {
  const m = mod({ availabilityAsync: jest.fn(async () => ({ available: false, reason })) });
  req.mockReturnValue(m);
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'unavailable', reason });
  expect(m.scanAsync).not.toHaveBeenCalled();
});

it('uygunluk yoklaması fırlatırsa → unavailable', async () => {
  req.mockReturnValue(mod({ availabilityAsync: jest.fn(async () => Promise.reject(new Error('gms'))) }));
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'unavailable', reason: 'error' });
});

it('⭐ hazır → native parametreleri (kalite yüzde, süre sınırları) ve sayfalar', async () => {
  const m = mod();
  req.mockReturnValue(m);
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'pages', pages: [page] });
  expect(m.availabilityAsync).toHaveBeenCalledWith(AVAILABILITY_TIMEOUT_MS);
  expect(m.scanAsync).toHaveBeenCalledWith({ pageLimit: 20, longEdge: 2600, maxBytes: 5 * 1024 * 1024, quality: 80, startTimeoutMs: START_TIMEOUT_MS });
});

it('iptal → canceled; boş/bozuk sayfa listesi de iptal sayılır', async () => {
  req.mockReturnValue(mod({ scanAsync: jest.fn(async () => ({ canceled: true, pages: [] })) }));
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'canceled' });
  req.mockReturnValue(mod({ scanAsync: jest.fn(async () => ({ canceled: false, pages: [{ uri: 'x' }, null] })) }));
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'canceled' });
});

it('başlatılamadı (ERR_DOC_SCAN_UNAVAILABLE) → sessiz unavailable; diğer hata → error', async () => {
  const unavailable = Object.assign(new Error('modül iniyor'), { code: 'ERR_DOC_SCAN_UNAVAILABLE' });
  req.mockReturnValue(mod({ scanAsync: jest.fn(async () => Promise.reject(unavailable)) }));
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'unavailable', reason: 'start_failed' });
  const failed = Object.assign(new Error('Taranan sayfa işlenemedi'), { code: 'ERR_DOC_SCAN_FAILED' });
  req.mockReturnValue(mod({ scanAsync: jest.fn(async () => Promise.reject(failed)) }));
  await expect(scanWithDocScanner(REQ)).resolves.toEqual({ kind: 'error', message: 'Taranan sayfa işlenemedi' });
});
