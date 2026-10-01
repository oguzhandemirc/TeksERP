// Bekçi: global 403 LICENSE_* dalı GERÇEK interceptor'dan geçer (axios adapter'ı sahte).
// Kısıtlı kip / kapalı modül → tek (tekilleştirilmiş) uyarı; K5 → store sinyali, toast YOK;
// kimliksiz kapı → sessiz; başka 403 → dokunulmaz. Hata ekrana `details` ile yine ulaşır.
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import Toast from 'react-native-toast-message';
import { apiClient, isDeviceNotApproved } from './api';
import { useLicenseStore } from '../store/licenseStore';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const show = Toast.show as jest.Mock;

function reject403(details: Record<string, unknown>) {
  return (config: InternalAxiosRequestConfig) => {
    const response = {
      data: { success: false, message: 'Lisans reddi', details },
      status: 403,
      statusText: 'Forbidden',
      headers: {},
      config,
    } as AxiosResponse;
    return Promise.reject(new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, response));
  };
}

async function call(details: Record<string, unknown>): Promise<{ status?: number; details?: { code?: string } }> {
  try {
    await apiClient.post('/orders', {}, { adapter: reject403(details) });
  } catch (e) {
    return e as { status?: number; details?: { code?: string } };
  }
  throw new Error('istek reddedilmeliydi');
}

let now = 1_000_000;
beforeEach(() => {
  show.mockClear();
  useLicenseStore.setState({ suspended: false, blockSeq: 0 });
  now += 60_000; // her vaka tekilleştirme penceresinin dışında başlasın
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

describe('403 LICENSE_* global dalı', () => {
  it('kısıtlı kip: tek uyarı, 10 sn içinde tekrar edilmez; hata ekrana details ile gider', async () => {
    const err = await call({ code: 'LICENSE_RESTRICTED', kademe: 'KISITLI' });
    expect(err.status).toBe(403);
    expect(err.details?.code).toBe('LICENSE_RESTRICTED');
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0].text1).toBe('Lisans kısıtlı kipte — yeni kayıt yapılamaz');
    now += 5_000;
    await call({ code: 'LICENSE_RESTRICTED' });
    expect(show).toHaveBeenCalledTimes(1);
    now += 11_000;
    await call({ code: 'LICENSE_RESTRICTED' });
    expect(show).toHaveBeenCalledTimes(2);
    expect(useLicenseStore.getState().blockSeq).toBe(3);
    expect(useLicenseStore.getState().suspended).toBe(false);
  });

  it('kapalı modül: modülün adını söyler', async () => {
    await call({ code: 'LICENSE_MODULE', modul: 'finance.enabled' });
    expect(show.mock.calls[0][0].text1).toBe('Ön muhasebe modülü lisansınızda kapalı');
  });

  it('K5: tam ekran sinyali, toast YOK', async () => {
    await call({ code: 'LICENSE_SUSPENDED' });
    expect(useLicenseStore.getState().suspended).toBe(true);
    expect(show).not.toHaveBeenCalled();
  });

  it('kimliksiz kapı: sessiz (ayrıntı bilinçli yok), K5 sayılmaz', async () => {
    await call({ code: 'LICENSE_GATE' });
    expect(show).not.toHaveBeenCalled();
    expect(useLicenseStore.getState().suspended).toBe(false);
  });

  it('lisans dışı 403 (izin / kapalı modül bayrağı) bu dala girmez', async () => {
    await call({ code: 'FORBIDDEN' });
    await call({ code: 'MODULE_DISABLED' });
    expect(show).not.toHaveBeenCalled();
    expect(useLicenseStore.getState().blockSeq).toBe(0);
  });
});

describe('403 DEVICE_NOT_APPROVED (kısa kimlik yalnız onaylı cihaz)', () => {
  it('lisans dalına girmez, ekrana details.code ile ulaşır ve yöntem kapanması sayılmaz', async () => {
    const err = await call({ code: 'DEVICE_NOT_APPROVED' });
    expect(show).not.toHaveBeenCalled();
    expect(isDeviceNotApproved(err)).toBe(true);
    expect(isDeviceNotApproved({ status: 403, details: { code: 'MODULE_DISABLED' } })).toBe(false);
  });
});
