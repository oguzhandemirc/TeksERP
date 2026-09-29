// =============================================================================
// İNDİRME BELİRTECİ (3c) — tablet güncelleme isteklerini fabrikanın backend'inden alınan kısa ömürlü
// belirteçle yapar: OTA manifest isteği `Expo-Extra-Params` içinde `tkl` (Updates.setExtraParamAsync;
// yeni APK gerekmez), APK künye/indirme isteği `X-TKL-Indirme` başlığı. Alınamazsa BAŞLIKSIZ — bugünkü
// davranış (Worker açılana dek sorunsuz, sonra geçiş listesi).
//
// ⚠️ `apiClient` KULLANILMAZ: global 401/lisans interceptor'ları arka plandaki güncelleme denetimini
// operatöre "oturum düştü"/lisans uyarısı olarak gösterirdi. Uç onaylı cihazı da kabul eder, yani
// giriş öncesi de çalışır. Belirteç loglanmaz, diske yazılmaz.
// =============================================================================

import * as Updates from 'expo-updates';

import { getCurrentBaseUrl } from '../store/baseUrlStore';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { resolveAuthToken } from './api';

export const DOWNLOAD_TOKEN_HEADER = 'X-TKL-Indirme';
export const OTA_EXTRA_PARAM_KEY = 'tkl';
const TIMEOUT_MS = 5_000;
const JWS_PATTERN = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const MAX_TOKEN_LENGTH = 8192;

export interface DownloadTokenDeps {
  baseUrl: () => string;
  authToken: () => Promise<string | null>;
  deviceId: () => Promise<string | null>;
  fetchImpl: typeof fetch;
}

const defaultDeps: DownloadTokenDeps = {
  baseUrl: getCurrentBaseUrl,
  authToken: resolveAuthToken,
  deviceId: getOrCreateDeviceId,
  fetchImpl: (...a) => fetch(...a),
};

/** Belirteci backend'den alır; her hata (yok · 403 K1 · 404 · zaman aşımı · biçimsiz) → null. Asla atmaz. */
export async function fetchDownloadToken(d: DownloadTokenDeps = defaultDeps): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const base = d.baseUrl().trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return null;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const session = await d.authToken().catch(() => null);
    const device = await d.deviceId().catch(() => null);
    if (session) headers.Authorization = `Bearer ${session}`;
    if (device) headers['x-device-id'] = device;
    if (!session && !device) return null;
    const res = await d.fetchImpl(`${base}/license/indirme-belirteci?urun=mobil`, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { belirtec?: unknown } } | null;
    const token = body?.data?.belirtec;
    return typeof token === 'string' && token.length <= MAX_TOKEN_LENGTH && JWS_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OTA denetiminden ÖNCE çağrılır: taze belirteç `tkl` olarak saklanır; alınamazsa saklı (bayat olabilecek)
 * param SİLİNİR ki istek başlıksız gitsin (bayat belirteç Worker'da 403 alır, başlıksız geçiş listesinden
 * geçer). Açılıştaki native ON_LOAD denetimi saklı paramla koşar — o yüzden her açılışta da tazelenir.
 */
export async function refreshOtaDownloadToken(d: DownloadTokenDeps = defaultDeps): Promise<string | null> {
  if (!Updates.isEnabled) return null;
  const token = await fetchDownloadToken(d);
  try {
    await Updates.setExtraParamAsync(OTA_EXTRA_PARAM_KEY, token);
  } catch {
    /* param yazılamazsa denetim bugünkü gibi sürer */
  }
  return token;
}

/** APK künye/indirme isteğinin başlıkları — belirteç yoksa boş (başlıksız). */
export async function downloadTokenHeaders(d: DownloadTokenDeps = defaultDeps): Promise<Record<string, string>> {
  const token = await fetchDownloadToken(d);
  return token ? { [DOWNLOAD_TOKEN_HEADER]: token } : {};
}
