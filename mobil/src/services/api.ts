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
        Toast.show({
          type: 'error',
          text1: 'Oturum süresi doldu',
          text2: 'Lütfen tekrar giriş yapın — bekleyen kayıtlar girişten sonra gönderilir.',
          visibilityTime: 6000,
        });
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
        Toast.show({
          type: 'info',
          text1: 'Çalışma oturumu kapandı',
          text2: 'Makine/istasyon onayını yenileyin — işlem kaydedilmedi, onaydan sonra tekrarlayın.',
          visibilityTime: 6000,
        });
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
