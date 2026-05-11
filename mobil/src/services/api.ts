import axios from 'axios';
import { storage } from '../utils/storage';
import { API_URL } from '../constants/api';

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
