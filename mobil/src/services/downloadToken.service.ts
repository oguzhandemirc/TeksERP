// =============================================================================
// İNDİRME BELİRTECİ (3c) — tablet güncelleme isteklerini fabrikanın backend'inden alınan kısa ömürlü
// belirteçle yapar: OTA manifest isteği `Expo-Extra-Params` içinde `tkl` (Updates.setExtraParamAsync).
// Alınamazsa BAŞLIKSIZ — bugünkü davranış (Worker açılana dek sorunsuz, sonra geçiş listesi). Ortak tablet
// APK indirmez (native güncelleme Google Play'den, K-14).
//
// ⚠️ `apiClient` KULLANILMAZ: global 401/lisans interceptor'ları arka plandaki güncelleme denetimini
// operatöre "oturum düştü"/lisans uyarısı olarak gösterirdi. Uç onaylı cihazı da kabul eder, yani
// giriş öncesi de çalışır. Belirteç loglanmaz, diske yazılmaz.
// Yanıtın `grup` alanı (tek ortak paket O3/O8) tabletin güncelleme grubudur — kaynağı kurulumun doğrulanmış
// kirasıdır; eski backend alanı göndermez → null (ortak paket güncelleme denetlemez).
// =============================================================================

import * as Updates from 'expo-updates';

import { getCurrentBaseUrl } from '../store/baseUrlStore';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { resolveAuthToken } from './api';

export const OTA_EXTRA_PARAM_KEY = 'tkl';
const TIMEOUT_MS = 5_000;
const JWS_PATTERN = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const MAX_TOKEN_LENGTH = 8192;
/** Grup kodu biçimi (backend `update-group.ts` GROUP_CODE); küme backend'de süzülür, tablet yalnız biçimi tutar. */
const GROUP_CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface DownloadGrant {
  belirtec: string;
  /** Kurulumun güncelleme grubu (doğrulanmış kiradan); yok/biçimsiz → null. */
  grup: string | null;
}

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

/** Belirteç + grup; her hata (yok · 403 K1 · 404 · zaman aşımı · biçimsiz belirteç) → null. Asla atmaz. */
export async function fetchDownloadGrant(d: DownloadTokenDeps = defaultDeps): Promise<DownloadGrant | null> {
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
    const body = (await res.json()) as { data?: { belirtec?: unknown; grup?: unknown } } | null;
    const token = body?.data?.belirtec;
    if (!(typeof token === 'string' && token.length <= MAX_TOKEN_LENGTH && JWS_PATTERN.test(token))) return null;
    const grup = body?.data?.grup;
    return { belirtec: token, grup: typeof grup === 'string' && GROUP_CODE.test(grup) ? grup : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Yalnız belirteç (eski çağıranlar); grup gerekmiyorsa. */
export async function fetchDownloadToken(d: DownloadTokenDeps = defaultDeps): Promise<string | null> {
  return (await fetchDownloadGrant(d))?.belirtec ?? null;
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
