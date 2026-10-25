// SSE isteğinin adresi ve başlıkları — `apiClient`ın TEK kurucusundan (`buildAuthHeaders`) ve
// çalışma anı `baseURL`inden alınır; interceptor mantığı burada tekrar yazılmaz.
import apiClient, { buildAuthHeaders } from "@/services/apiClient";
import { ensureConnectOrigin } from "@/lib/connect-gate";

export const BELL_PATH = "/api/bildirim/zil";

export function bellUrl(): string {
  return apiClient.getUri({ url: BELL_PATH });
}

export async function bellHeaders(): Promise<Record<string, string>> {
  return { ...(await buildAuthHeaders("get")), Accept: "text/event-stream", "Cache-Control": "no-cache" };
}

/** Panelin varsayılan SSE açıcısı — web'de kimlik httpOnly çerezde, `credentials` onu taşır. */
export async function openBellStream(signal: AbortSignal): Promise<Response> {
  await ensureConnectOrigin(bellUrl());
  return fetch(bellUrl(), { headers: await bellHeaders(), credentials: "include", cache: "no-store", signal });
}
