import { create } from 'zustand';
import Constants from 'expo-constants';
import { storage } from '../utils/storage';

const BACKEND_PORT = 4000;
const CUSTOM_URL_KEY = 'api_base_url_custom';
const RECENT_URLS_KEY = 'api_base_url_recent';
const MAX_RECENT = 6;

export const DEFAULT_PORT = BACKEND_PORT;

/** Normalize/tam URL'i http|ip|port parçalarına ayırır — 3 alanı ön-doldurmak için.
 *  `/api` ve yol yok sayılır; port yoksa varsayılan (4000). */
export function parseUrlParts(url: string): {
  scheme: 'http' | 'https';
  host: string;
  port: string;
} {
  const m = /^(https?):\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? '').trim());
  if (!m) return { scheme: 'http', host: '', port: String(BACKEND_PORT) };
  return {
    scheme: m[1].toLowerCase() === 'https' ? 'https' : 'http',
    host: m[2],
    port: m[3] ?? String(BACKEND_PORT),
  };
}

/** http|ip|port → ham URL (normalizeUrl `/api`'yi ekler). Host boşsa boş döner. */
export function buildUrl(scheme: string, host: string, port: string): string {
  const h = host.trim();
  if (!h) return '';
  const p = port.trim();
  return `${scheme}://${h}${p ? `:${p}` : ''}`;
}

/** Çip etiketi — şema ve `/api` sıyrılır ("192.168.1.10:4000"). */
export function displayUrl(url: string): string {
  return (url ?? '').replace(/^https?:\/\//i, '').replace(/\/api\/?$/i, '');
}

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

function readRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface BaseUrlState {
  baseUrl: string;
  customUrl: string | null;
  /** Daha önce kaydedilmiş adresler (en yeni önce, MAX_RECENT ile sınırlı). */
  recentUrls: string[];
  isLoaded: boolean;

  init: () => Promise<void>;
  setCustomUrl: (url: string) => Promise<void>;
  reset: () => Promise<void>;
}

export const useBaseUrlStore = create<BaseUrlState>((set, get) => ({
  baseUrl: computeAutoUrl(),
  customUrl: null,
  recentUrls: [],
  isLoaded: false,

  init: async () => {
    const [stored, recentRaw] = await Promise.all([
      storage.getItem(CUSTOM_URL_KEY),
      storage.getItem(RECENT_URLS_KEY),
    ]);
    const auto = computeAutoUrl();
    set({
      customUrl: stored,
      baseUrl: stored ?? auto,
      recentUrls: readRecent(recentRaw),
      isLoaded: true,
    });
  },

  setCustomUrl: async (url) => {
    const normalized = normalizeUrl(url);
    // Geçmiş: en yeni önde, tekrarları at, MAX_RECENT ile sınırla.
    const recent = [normalized, ...get().recentUrls.filter((u) => u !== normalized)].slice(
      0,
      MAX_RECENT,
    );
    await Promise.all([
      storage.setItem(CUSTOM_URL_KEY, normalized),
      storage.setItem(RECENT_URLS_KEY, JSON.stringify(recent)),
    ]);
    set({ customUrl: normalized, baseUrl: normalized, recentUrls: recent });
  },

  reset: async () => {
    await storage.deleteItem(CUSTOM_URL_KEY);
    set({ customUrl: null, baseUrl: computeAutoUrl() });
  },
}));

export function getCurrentBaseUrl(): string {
  return useBaseUrlStore.getState().baseUrl;
}
