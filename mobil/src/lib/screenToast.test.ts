// Bekçi: ekranın hata toast'ı ORTAK yardımcıdan geçer ve lisans reddinde SUSAR — interceptor
// kısıtlı kip / modül uyarısını ya da K5 ekranını zaten gösterdi; ekran toast'ı onu ezerdi.
import Toast from 'react-native-toast-message';
import { showScreenError } from './screenToast';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
const show = Toast.show as jest.Mock;

function apiError(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { status, details: { code } });
}

beforeEach(() => show.mockClear());

describe('showScreenError', () => {
  it('lisans reddi (kısıtlı kip · modül · K5) → toast YOK', () => {
    showScreenError(apiError('Lisans kısıtlı kipte.', 403, 'LICENSE_RESTRICTED'), 'Kayıt başarısız');
    showScreenError(apiError('Modül kapalı.', 403, 'LICENSE_MODULE'), 'Kayıt başarısız');
    showScreenError(apiError('Durduruldu.', 403, 'LICENSE_SUSPENDED'), 'Kayıt başarısız');
    expect(show).not.toHaveBeenCalled();
  });
  it('başka her hata eskisi gibi: başlık + sunucunun mesajı', () => {
    showScreenError(apiError('Top bulunamadı.', 404, 'NOT_FOUND'), 'Taşıma yapılamadı');
    expect(show).toHaveBeenLastCalledWith({ type: 'error', text1: 'Taşıma yapılamadı', text2: 'Top bulunamadı.' });
    showScreenError(apiError('Genel kapı.', 403, 'LICENSE_GATE'), 'Kayıt başarısız');
    expect(show).toHaveBeenLastCalledWith({ type: 'error', text1: 'Kayıt başarısız', text2: 'Genel kapı.' });
    showScreenError({ status: 500 }, 'Kayıt başarısız');
    expect(show).toHaveBeenLastCalledWith({ type: 'error', text1: 'Kayıt başarısız' });
  });
});
