// =============================================================================
// BİLDİRİM GELEN KUTUSU İSTEMCİSİ — `/api/bildirim/*` (plan §5.6 F1)
// =============================================================================
// Yollar tam yazılır ("/api/…"; `apiClient.baseURL` `/api` içermez). Genel hata toast'ı bastırılır:
// zil arka planda yoklar; eski backend (404) ve kapalı bayrak (409 `BILDIRIM_KAPALI`) sessiz durumdur,
// eylem hatalarının cümlesini çağıran basar. Hata kodu `details.code`tan okunur.
// =============================================================================
import axios from "axios";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  NotificationWaitResult,
  NotificationCatalogKind,
  NotificationListResult,
  NotificationSummary,
  NotificationTab,
  SnoozeDuration,
  NotificationPreferenceCell,
  NotificationPreferenceInput,
  NotificationPreferenceRow,
} from "@/lib/bildirim/types";

const BASE = "/api/bildirim";
const Q = { suppressErrorToast: true } as const;

export interface NotificationListParams {
  sekme: NotificationTab;
  cursor?: string | null;
  limit?: number;
  /** Katalog tür kodları — sunucu `filter[tur]` CSV'si (süzme SUNUCUDA). */
  turler?: readonly string[];
}

export function notificationListQuery(p: NotificationListParams): string {
  const sp = new URLSearchParams();
  sp.set("sekme", p.sekme);
  if (p.cursor) sp.set("cursor", p.cursor);
  if (p.limit !== undefined) sp.set("limit", String(p.limit));
  if (p.turler && p.turler.length) sp.set("filter[tur]", [...p.turler].sort().join(","));
  return sp.toString();
}

/** HTTP durum kodu (yanıt yoksa null) — merdiven 403/404/409'u ağ hatasından ayırır. */
export function httpStatusOf(e: unknown): number | null {
  return axios.isAxiosError(e) && e.response ? e.response.status : null;
}

/** Backend hata kodu — `details.code` (body.code hep undefined). */
export function notificationErrorCode(e: unknown): string | undefined {
  if (!axios.isAxiosError(e)) return undefined;
  const code = (e.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof code === "string" ? code : undefined;
}

const get = <T>(path: string, signal?: AbortSignal, timeout?: number): Promise<T> =>
  apiClient.get<ApiResponse<T>>(path, { ...Q, signal, ...(timeout ? { timeout } : {}) }).then((r) => r.data.data);
const post = <T>(path: string, body: object = {}): Promise<T> =>
  apiClient.post<ApiResponse<T>>(path, body, Q).then((r) => r.data.data);

export const bildirimService = {
  ozet: (): Promise<NotificationSummary> => get<NotificationSummary>(`${BASE}/ozet`),
  /** Uzun yoklama — sunucu ≤25 sn bekletir; istemci zaman aşımı bunun üstünde. */
  bekle: (p: { rev: number; alarmRev: number; epoch: number }, signal?: AbortSignal): Promise<NotificationWaitResult> =>
    get<NotificationWaitResult>(`${BASE}/bekle?rev=${p.rev}&alarmRev=${p.alarmRev}&epoch=${p.epoch}`, signal, 35_000),
  liste: (p: NotificationListParams): Promise<NotificationListResult> => get<NotificationListResult>(`${BASE}?${notificationListQuery(p)}`),
  /** `hucreler` F4 sunucusunda gelir (eski sunucu yalnız `turler`). */
  katalog: (): Promise<{ turler: NotificationCatalogKind[]; hucreler?: NotificationPreferenceCell[] }> => get(`${BASE}/katalog`),
  tercihler: (): Promise<{ hucreler: NotificationPreferenceCell[]; satirlar: NotificationPreferenceRow[] }> => get(`${BASE}/tercihler`),
  tercihleriYaz: (tercihler: NotificationPreferenceInput[]): Promise<{ hucreler: NotificationPreferenceCell[]; satirlar: NotificationPreferenceRow[] }> =>
    apiClient.put<ApiResponse<{ hucreler: NotificationPreferenceCell[]; satirlar: NotificationPreferenceRow[] }>>(`${BASE}/tercihler`, { tercihler }, Q).then((r) => r.data.data),
  okundu: (id: string): Promise<{ degisti: boolean }> => post(`${BASE}/${encodeURIComponent(id)}/okundu`),
  okunmadi: (id: string): Promise<{ degisti: boolean }> => post(`${BASE}/${encodeURIComponent(id)}/okunmadi`),
  ertele: (id: string, sure: SnoozeDuration): Promise<{ erteleBitis: string }> =>
    post(`${BASE}/${encodeURIComponent(id)}/ertele`, { sure }),
  tumunuOkundu: (): Promise<{ ids: string[] }> => post(`${BASE}/tumunu-okundu`),
  geriAlOkundu: (ids: string[]): Promise<{ ids: string[] }> => post(`${BASE}/geri-al-okundu`, { ids }),
};
