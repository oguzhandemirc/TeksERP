import axios from 'axios';
import Toast from 'react-native-toast-message';
import { storage } from '../utils/storage';
import { API_URL } from '../constants/api';
import { getCurrentBaseUrl } from '../store/baseUrlStore';
import { getOrCreateDeviceId } from '../utils/deviceId';
// Import yönü güvenli: authStore yalnız utils/storage'a bağımlı (api'yi import etmez).
import { useAuthStore } from '../store/authStore';
import { recordNetSample } from './netStats';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Token çözümü — BELLEK ÖNCE: her istekte SecureStore/Keystore okumak istek
 * başına 5-30ms (zayıf cihazda 200-300ms) sabit vergiydi. authStore zaten
 * token'ı bellekte tutar ve setAuth/clearAuth ile günceller → tek kaynak.
 * Cold start (loadStoredAuth bitmeden atılan istek) SecureStore'a düşer.
 * mutations.ts NoAuth guard'ı da bunu kullanır (token yok → HTTP'ye çıkma).
 */
export async function resolveAuthToken(): Promise<string | null> {
  const s = useAuthStore.getState();
  if (!s.isLoading) return s.token;
  return (await storage.getItem('auth_token')) ?? null;
}

/** İstek süresi ölçümü için config'e damgalanan başlangıç zamanı. */
interface TimedConfig {
  __startedAt?: number;
}

function sampleFromConfig(
  config: { method?: string; url?: string } | undefined,
  status: number | 'ERR' | 'TIMEOUT',
  startedAt: number | undefined,
): void {
  if (!startedAt) return;
  recordNetSample({
    method: (config?.method ?? 'GET').toUpperCase(),
    url: config?.url ?? '?',
    status,
    ms: Date.now() - startedAt,
    at: Date.now(),
  });
}

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

// 429 LOGIN_LOCKED → hızlı-PIN/kart brute-force deneme kilidi. Backend ardışık
// yanlış denemeden sonra IP/cihazı süreli bloklar. Interceptor bunun için TEK
// yetkili "neden giremiyorum" toast'ını gösterir; login ekranı kendi genel
// "Giriş başarısız" toast'ını isLoginLocked ile bastırır (aksi hâlde iki toast).
let lastLoginLockToastAt = 0;

/** Hata "çok fazla yanlış giriş denemesi" (429 LOGIN_LOCKED) mi? Interceptor bu
 *  durumda ZATEN net toast gösterir → LoginScreen kendi genel "Giriş başarısız"
 *  toast'ını BASTIRSIN (inline hata mesajı yine set edilir). isWorkSessionLost eşi. */
export function isLoginLocked(err: unknown): boolean {
  const e = err as { status?: number; details?: { code?: string } } | null;
  return e?.status === 429 && e?.details?.code === 'LOGIN_LOCKED';
}

apiClient.interceptors.request.use(async (config) => {
  (config as TimedConfig).__startedAt = Date.now();
  // baseURL'i her istekte store'dan oku — kullanıcı Settings'ten değiştirdiğinde
  // restart gerekmeden anında geçer.
  config.baseURL = getCurrentBaseUrl();
  const token = await resolveAuthToken();
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
  (res) => {
    sampleFromConfig(res.config, res.status, (res.config as TimedConfig).__startedAt);
    return res;
  },
  (error) => {
    const status = error.response?.status;
    sampleFromConfig(
      error.config,
      status ?? (error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'ERR'),
      (error.config as TimedConfig | undefined)?.__startedAt,
    );
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

    // Deneme kilidi (429 LOGIN_LOCKED) → hızlı-PIN/kart girişinde çok fazla yanlış
    // deneme. Login çağrısında da göster (401'in aksine bastırma yok — kullanıcı
    // neden giremediğini bilmeli). details.retryAfterSec = kalan blok süresi (sn).
    // 5sn dedup: PIN spam'i tek toast üretir. LoginScreen isLoginLocked ile kendi
    // genel toast'ını bastırır; inline hata mesajı yine görünür.
    if (status === 429 && error.response?.data?.details?.code === 'LOGIN_LOCKED') {
      const now = Date.now();
      if (now - lastLoginLockToastAt > 5000) {
        lastLoginLockToastAt = now;
        const sec = Number(error.response?.data?.details?.retryAfterSec) || 0;
        const wait =
          sec >= 60
            ? `${Math.ceil(sec / 60)} dakika sonra tekrar deneyin`
            : sec > 0
              ? `${sec} saniye sonra tekrar deneyin`
              : 'Bir süre sonra tekrar deneyin';
        Toast.show({
          type: 'error',
          text1: 'Çok fazla yanlış deneme',
          text2: wait,
          visibilityTime: 6000,
        });
      }
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
