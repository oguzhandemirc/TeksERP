import { create } from 'zustand';
import Constants from 'expo-constants';
import { storage } from '../utils/storage';

const BACKEND_PORT = 4000;
const CUSTOM_URL_KEY = 'api_base_url_custom';

function getDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost;
  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

export function computeAutoUrl(): string {
  const envApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const devHost = __DEV__ ? getDevHost() : null;
  return devHost
    ? `http://${devHost}:${BACKEND_PORT}/api`
    : (envApiUrl ?? `http://localhost:${BACKEND_PORT}/api`);
}

export function normalizeUrl(input: string): string {
  let v = input.trim();
  if (!v) return v;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  v = v.replace(/\/+$/, '');
  if (!/\/api$/i.test(v)) v = `${v}/api`;
  return v;
}

interface BaseUrlState {
  baseUrl: string;
  customUrl: string | null;
  isLoaded: boolean;

  init: () => Promise<void>;
  setCustomUrl: (url: string) => Promise<void>;
  reset: () => Promise<void>;
}

export const useBaseUrlStore = create<BaseUrlState>((set) => ({
  baseUrl: computeAutoUrl(),
  customUrl: null,
  isLoaded: false,

  init: async () => {
    const stored = await storage.getItem(CUSTOM_URL_KEY);
    const auto = computeAutoUrl();
    set({
      customUrl: stored,
      baseUrl: stored ?? auto,
      isLoaded: true,
    });
  },

  setCustomUrl: async (url) => {
    const normalized = normalizeUrl(url);
    await storage.setItem(CUSTOM_URL_KEY, normalized);
    set({ customUrl: normalized, baseUrl: normalized });
  },

  reset: async () => {
    await storage.deleteItem(CUSTOM_URL_KEY);
    set({ customUrl: null, baseUrl: computeAutoUrl() });
  },
}));

export function getCurrentBaseUrl(): string {
  return useBaseUrlStore.getState().baseUrl;
}
