// Bekçi: native zorlama katmanının varlık kapısı. Zorlayamayan sürüm (modül yok · D4 adıyla eski arayüz ·
// ağ istemcisine kurulmamış) "yok" sayılır — sabit yazılmaz, kart QR'ı açmaz.
import { requireOptionalNativeModule } from 'expo';
import { lanTlsNative } from './lanTlsNative';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
const req = requireOptionalNativeModule as jest.MockedFunction<typeof requireOptionalNativeModule>;

const tam = (installed: boolean) => ({
  setPinState: jest.fn(async () => undefined),
  getPinState: () => ({ installed, fingerprints: [], endpoints: [] }),
});

it('modül yoksa null', () => {
  req.mockReturnValue(null);
  expect(lanTlsNative()).toBeNull();
});

it('yalnız D4 adını (setPins) taşıyan modül zorlayıcı sayılmaz', () => {
  req.mockReturnValue({ setPins: jest.fn() });
  expect(lanTlsNative()).toBeNull();
});

it('ağ istemcisine kurulmamışsa null', () => {
  req.mockReturnValue(tam(false));
  expect(lanTlsNative()).toBeNull();
});

it('durum okunamıyorsa ya da çözümleme patlarsa null', () => {
  req.mockReturnValue({ setPinState: jest.fn(), getPinState: () => { throw new Error('x'); } });
  expect(lanTlsNative()).toBeNull();
  req.mockImplementation(() => { throw new Error('y'); });
  expect(lanTlsNative()).toBeNull();
});

it('kurulu modül döner', () => {
  const m = tam(true);
  req.mockReturnValue(m);
  expect(lanTlsNative()).toBe(m);
});
