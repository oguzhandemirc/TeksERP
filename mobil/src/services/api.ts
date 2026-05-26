import axios from 'axios';
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
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
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
    if (status === 401 && !isLoginCall && onUnauthorized) {
      onUnauthorized();
    }

    const message =
      error.response?.data?.message || error.message || 'Sunucu hatası';
    return Promise.reject(new Error(message));
  }
);
