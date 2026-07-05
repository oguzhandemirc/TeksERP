import axios from 'axios';
import Toast from 'react-native-toast-message';
import { storage } from '../utils/storage';
import { API_URL } from '../constants/api';
import { getCurrentBaseUrl } from '../store/baseUrlStore';
import { getOrCreateDeviceId } from '../utils/deviceId';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// 401 → kullanıcıyı login ekranına döndür. Eşleşme korunur (machineId silinmez);
// cihaz pasifleştirilse bile admin aktif yapınca aynı eşleşme ile devam edilir.
let onUnauthorized: (() => void) | null = null;
let lastUnauthorizedToastAt = 0;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

// 409 WORK_SESSION_REQUIRED → çalışma oturumu düştü (idle / devralındı / panelden
// kapatıldı). Handler yerel oturumu temizler → SessionGate yeniden yer onayı ister;
// operatör onaylayıp işlemi tekrarlar. (Import döngüsü olmasın diye kayıt deseni —
// sessionStore bu dosyayı dolaylı import ediyor.)
let onWorkSessionRequired: (() => void) | null = null;
let lastSessionToastAt = 0;
export const setWorkSessionRequiredHandler = (fn: () => void) => {
  onWorkSessionRequired = fn;
};

/** Hata "çalışma oturumu düştü" (409 WORK_SESSION_REQUIRED) mi? Interceptor bu
 *  durumda ZATEN net bildirim (devralındı / zaman aşımı …) gösterir; ekranların
 *  kendi "Kayıt başarısız" toast'ını BASTIRMASI için (aksi hâlde onu ezer). */
export function isWorkSessionLost(err: unknown): boolean {
  const e = err as { status?: number; details?: { code?: string } } | null;
  return e?.status === 409 && e?.details?.code === 'WORK_SESSION_REQUIRED';
}

apiClient.interceptors.request.use(async (config) => {
  // baseURL'i her istekte store'dan oku — kullanıcı Settings'ten değiştirdiğinde
  // restart gerekmeden anında geçer.
  config.baseURL = getCurrentBaseUrl();
  const token = await storage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Backend bu header'ı Device → Machine'a çözer; rolMovement/rollOperation kayıtlarına yazılır.
  try {
    const deviceId = await getOrCreateDeviceId();
    if (deviceId) config.headers['x-device-id'] = deviceId;
  } catch {
    // header yoksa backend normal çalışmaya devam eder
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const url: string | undefined = error.config?.url;
    const isLoginCall = url?.includes('/auth/login');

    // Login çağrısındaki 401 (yanlış şifre / pasif cihaz) LoginScreen'de inline
    // gösterilir — global handler tetiklenmez. Diğer 401'lerde logout.
    // Y12 fix: logout artık SESSİZ değil — operatör vardiya ortasında neden
    // login ekranına düştüğünü görmeli (8h JWT süresi dolması en yaygın sebep).
    // 5sn tekilleştirme: eşzamanlı isteklerin 401 yağmuru tek toast üretir.
    if (status === 401 && !isLoginCall && onUnauthorized) {
      const now = Date.now();
      if (now - lastUnauthorizedToastAt > 5000) {
        lastUnauthorizedToastAt = now;
        // Sebebe göre NET bildirim — backend details.code/reason döner. Kick
        // (başka cihazdan giriş) "süresi doldu" DEĞİL, doğru mesajı göster.
        const d = error.response?.data?.details;
        let text1 = 'Oturum süresi doldu';
        let text2 = 'Lütfen tekrar giriş yapın — bekleyen kayıtlar girişten sonra gönderilir.';
        if (d?.code === 'SESSION_REVOKED') {
          if (d?.reason === 'NEW_LOGIN') {
            text1 = 'Başka cihazda giriş yapıldı';
            text2 = 'Bu hesap başka bir cihazda açıldığı için burada oturum kapatıldı.';
          } else {
            text1 = 'Oturum kapatıldı';
            text2 = error.response?.data?.message || 'Lütfen tekrar giriş yapın.';
          }
        } else if (d?.code === 'SESSION_INVALID') {
          text1 = 'Oturum kapatıldı';
          text2 = 'Lütfen tekrar giriş yapın.';
        }
        Toast.show({ type: 'error', text1, text2, visibilityTime: 6000 });
      }
      onUnauthorized();
    }

    // Çalışma oturumu düştü (idle / başka cihaz devraldı / panelden kapatıldı) —
    // kullanıcı OTURUMU değil YER onayını kaybetti: login'e atmayız, gate yer sorar.
    if (
      status === 409 &&
      error.response?.data?.details?.code === 'WORK_SESSION_REQUIRED' &&
      onWorkSessionRequired
    ) {
      const now = Date.now();
      if (now - lastSessionToastAt > 5000) {
        lastSessionToastAt = now;
        // Sebebe göre NET bildirim — backend details.reason döner (TAKEOVER /
        // IDLE / NEW_LOGIN / ADMIN). "Alakasız bir şey" değil, ne olduğunu yaz.
        const details = error.response?.data?.details;
        const reason = details?.reason;
        const takenBy: string | undefined = details?.takenBy;
        let type: 'info' | 'error' = 'info';
        let duration = 6000;
        let text1 = 'Çalışma oturumu kapandı';
        let text2 = 'Makine/istasyon onayını yenileyin — işlem kaydedilmedi, onaydan sonra tekrarlayın.';
        if (reason === 'TAKEOVER') {
          type = 'error';
          duration = 10000; // devralma bildirimi biraz daha uzun dursun
          if (takenBy) {
            // Devralan kişinin adı BAŞLIKTA (toast başlığı kalın/büyük) → en belirgin.
            text1 = `${takenBy} makinenizi devraldı`;
            text2 = 'İşleminiz kaydedilmedi — yeni yer onayı gerekir.';
          } else {
            text1 = 'Makineniz devralındı';
            text2 = 'Bu makineyi/istasyonu başka bir operatör devraldı. İşleminiz kaydedilmedi — yeni yer onayı gerekir.';
          }
        } else if (reason === 'IDLE') {
          text1 = 'Oturum zaman aşımına uğradı';
          text2 = 'Uzun süre işlem olmadığı için çalışma oturumu kapandı. Yer onayını yenileyin.';
        } else if (reason === 'NEW_LOGIN') {
          type = 'error';
          text1 = 'Başka yerde oturum açıldı';
          text2 = 'Bu hesapla başka bir yerde oturum açıldı. Yer onayını yenileyin.';
        } else if (reason === 'ADMIN') {
          text1 = 'Oturum yönetici tarafından kapatıldı';
          text2 = 'Çalışma oturumunuz kapatıldı. Yer onayını yenileyin.';
        }
        Toast.show({ type, text1, text2, visibilityTime: duration });
      }
      onWorkSessionRequired();
    }

    // K-A3 fix: backend mesajı yoksa ham axios İngilizcesi ('Network Error',
    // 'timeout of 10000ms exceeded') operatöre sızıyordu — Türkçe karşılıkları.
    const fallback =
      error.code === 'ECONNABORTED'
        ? 'Sunucu yanıt vermedi (zaman aşımı) — ağ bağlantısını kontrol edin'
        : !error.response
          ? 'Sunucuya ulaşılamıyor — Wi-Fi/ağ bağlantısını kontrol edin'
          : 'Sunucu hatası';
    const message = error.response?.data?.message || fallback;
    // Backend AppError.details payload'ı koru — frontend "ITEM_MISMATCH" gibi
    // özel handling için (modal göster, override ile retry) bu yapıya bakar.
    const details = error.response?.data?.details;
    const wrapped = new Error(message) as Error & {
      details?: Record<string, unknown>;
      status?: number;
    };
    if (details) wrapped.details = details;
    if (status) wrapped.status = status;
    return Promise.reject(wrapped);
  }
);
