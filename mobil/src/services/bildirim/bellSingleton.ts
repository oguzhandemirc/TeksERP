// Uygulama başına TEK zil istemcisi. Akış `expo/fetch` ile açılır (axios akış okuyamaz); başlıklar
// `clientHeaders.ts` tek kurucusundan. `expo/fetch` aynı OkHttp fabrikasını (sabitlenmiş TLS) kullanır.
import { resolveAuthToken } from '../api';
import { buildDeviceHeaders } from '../clientHeaders';
import { getCurrentBaseUrl } from '../../store/baseUrlStore';
import { bildirimApi, httpStatusOf } from './bildirimApi';
import { createBellClient, type BellClient } from './bellTransport';
import type { StreamResponse } from './bellClient';

/** LAN TLS ölçümü olumsuzsa false yapılır: uzun yoklama varsayılan olur (docs/kurallar/bildirim.md). */
export const BELL_SSE_ENABLED = true;

async function openStream(signal: AbortSignal): Promise<StreamResponse> {
  const url = `${getCurrentBaseUrl()}/bildirim/zil`;
  const token = await resolveAuthToken();
  const headers: Record<string, string> = { Accept: 'text/event-stream', ...(await buildDeviceHeaders('get', url)) };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Tembel yükleme: native fetch modülü yalnız akış açılırken gerekir (test ortamı ve bayrak kapalı kurulum yüklemez).
  const { fetch: expoFetch } = await import('expo/fetch');
  const res = await expoFetch(url, { headers, signal });
  return { status: res.status, ok: res.ok, body: res.body as ReadableStream<Uint8Array> | null };
}

let client: BellClient | null = null;

export function bellClient(): BellClient {
  client ??= createBellClient({
    summary: bildirimApi.summary,
    wait: bildirimApi.wait,
    openStream,
    httpStatus: httpStatusOf,
    sseEnabled: BELL_SSE_ENABLED,
  });
  return client;
}
