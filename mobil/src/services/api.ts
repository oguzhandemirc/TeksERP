import axios from 'axios';
import { storage } from '../utils/storage';
import { API_URL } from '../constants/api';
import { getOrCreateDeviceId } from '../utils/deviceId';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

apiClient.interceptors.request.use(async (config) => {
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

    if (status === 401 && !isLoginCall && onUnauthorized) {
      onUnauthorized();
    }

    const message =
      error.response?.data?.message || error.message || 'Sunucu hatası';
    return Promise.reject(new Error(message));
  }
);
