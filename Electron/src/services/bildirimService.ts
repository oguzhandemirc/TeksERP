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
  NotificationUserSettings,
  NotificationPreferencePreview,
  NotificationResetRow,
  FollowRecordType,
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

/** Hata ayrıntısındaki tek alan (ör. 409 `NOTIFICATION_KIND_LOCKED` → `details.tur`). */
export function notificationErrorDetail(e: unknown, alan: string): string | undefined {
  if (!axios.isAxiosError(e)) return undefined;
  const v = (e.response?.data as { details?: Record<string, unknown> } | undefined)?.details?.[alan];
  return typeof v === "string" ? v : undefined;
}

const get = <T>(path: string, signal?: AbortSignal, timeout?: number): Promise<T> =>
  apiClient.get<ApiResponse<T>>(path, { ...Q, signal, ...(timeout ? { timeout } : {}) }).then((r) => r.data.data);
const post = <T>(path: string, body: object = {}): Promise<T> =>
  apiClient.post<ApiResponse<T>>(path, body, Q).then((r) => r.data.data);
const put = <T>(path: string, body: object = {}): Promise<T> =>
  apiClient.put<ApiResponse<T>>(path, body, Q).then((r) => r.data.data);
const followPath = (tur: FollowRecordType, id: string) => `${BASE}/takip/${tur}/${encodeURIComponent(id)}`;

export interface NotificationPreferencesResult {
  hucreler: NotificationPreferenceCell[];
  satirlar: NotificationPreferenceRow[];
}
export interface FollowState {
  takip: boolean;
}

export const bildirimService = {
  ozet: (): Promise<NotificationSummary> => get<NotificationSummary>(`${BASE}/ozet`),
  /** Uzun yoklama — sunucu ≤25 sn bekletir; istemci zaman aşımı bunun üstünde. */
  bekle: (p: { rev: number; alarmRev: number; epoch: number }, signal?: AbortSignal): Promise<NotificationWaitResult> =>
    get<NotificationWaitResult>(`${BASE}/bekle?rev=${p.rev}&alarmRev=${p.alarmRev}&epoch=${p.epoch}`, signal, 35_000),
  liste: (p: NotificationListParams): Promise<NotificationListResult> => get<NotificationListResult>(`${BASE}?${notificationListQuery(p)}`),
  /** `hucreler` F4 sunucusunda gelir (eski sunucu yalnız `turler`). */
  /** `hucreler` F4, `kapsam`/`yetkiDisi` N4-PANEL sunucusunda gelir (eski sunucu yalnız `turler`). */
  katalog: (): Promise<{ turler: NotificationCatalogKind[]; hucreler?: NotificationPreferenceCell[]; yetkiDisi?: number }> =>
    get(`${BASE}/katalog`),
  tercihler: (): Promise<NotificationPreferencesResult> => get(`${BASE}/tercihler`),
  /** Tam gövde PUT — sunucu seyrek yazar, istemci CEVAPTAN formu yeniden kurar. */
  tercihleriYaz: (tercihler: NotificationPreferenceInput[]): Promise<NotificationPreferencesResult> =>
    put(`${BASE}/tercihler`, { tercihler }),
  /** Taslağın haftalık tahmini (sunucu sayar; yazmaz). */
  tercihOnizleme: (tercihler?: NotificationPreferenceInput[]): Promise<NotificationPreferencePreview> =>
    post(`${BASE}/tercihler/onizleme`, tercihler ? { tercihler } : {}),
  varsayilanaDonOnizleme: (): Promise<{ satirlar: NotificationResetRow[] }> => post(`${BASE}/tercihler/varsayilana-don/onizleme`),
  varsayilanaDon: (ids: string[]): Promise<{ silinen: number }> => post(`${BASE}/tercihler/varsayilana-don`, { ids }),
  ayarlar: (): Promise<NotificationUserSettings> => get(`${BASE}/ayarlar`),
  ayarlariYaz: (a: NotificationUserSettings): Promise<NotificationUserSettings> => put(`${BASE}/ayarlar`, a),
  takip: (tur: FollowRecordType, id: string): Promise<FollowState> => get(followPath(tur, id)),
  takipEt: (tur: FollowRecordType, id: string): Promise<FollowState> => put(followPath(tur, id)),
  takibiBirak: (tur: FollowRecordType, id: string): Promise<FollowState> =>
    apiClient.delete<ApiResponse<FollowState>>(followPath(tur, id), Q).then((r) => r.data.data),
  okundu: (id: string): Promise<{ degisti: boolean }> => post(`${BASE}/${encodeURIComponent(id)}/okundu`),
  okunmadi: (id: string): Promise<{ degisti: boolean }> => post(`${BASE}/${encodeURIComponent(id)}/okunmadi`),
  ertele: (id: string, sure: SnoozeDuration): Promise<{ erteleBitis: string }> =>
    post(`${BASE}/${encodeURIComponent(id)}/ertele`, { sure }),
  tumunuOkundu: (): Promise<{ ids: string[] }> => post(`${BASE}/tumunu-okundu`),
  geriAlOkundu: (ids: string[]): Promise<{ ids: string[] }> => post(`${BASE}/geri-al-okundu`, { ids }),
};
