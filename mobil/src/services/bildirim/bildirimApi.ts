// Bildirim uçları (`/api/bildirim`). Süzme SUNUCUDA: tablet yalnız parametre gönderir (plan §6.8);
// istemci listeyi süzmez, sayıyı kendisi hesaplamaz.
import { apiClient } from '../api';
import type { ApiResponse } from '../../types/api';
import type {
  CatalogKind, InboxPage, InboxTab, NotificationSummary, NotificationWaitResult, PreferenceItem, PreferencesResponse,
} from './types';

const BASE = '/bildirim';

/** Tablet gelen kutusu: yalnız katalogda tablet kanalı olan türler (sunucu süzgeci). */
export const TABLET_INBOX_FILTER = 'filter[kanal]=TABLET_SES';
/** İstasyon şeridi: tablet kanalı açık (sessiz saat sunucuda çözülmüş) okunmamış satırlar. */
export const STRIP_FILTER = `${TABLET_INBOX_FILTER}&filter[tablet]=true&filter[ozet]=false`;

export function inboxListQuery(p: { tab: InboxTab; extra?: string; cursor?: string | null; limit?: number }): string {
  const parts = [`sekme=${p.tab}`, `limit=${p.limit ?? 30}`];
  if (p.extra) parts.push(p.extra);
  if (p.cursor) parts.push(`cursor=${encodeURIComponent(p.cursor)}`);
  return parts.join('&');
}

/** Axios hatasından HTTP durumu (yanıtsız ağ hatası → null). */
export function httpStatusOf(e: unknown): number | null {
  const s = (e as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof s === 'number' ? s : null;
}

export const bildirimApi = {
  async summary(): Promise<NotificationSummary> {
    const r = await apiClient.get<ApiResponse<NotificationSummary>>(`${BASE}/ozet`);
    return r.data.data;
  },
  async list(p: { tab: InboxTab; extra?: string; cursor?: string | null; limit?: number }): Promise<InboxPage> {
    const r = await apiClient.get<ApiResponse<InboxPage>>(`${BASE}?${inboxListQuery(p)}`);
    return r.data.data;
  },
  /** Uzun yoklama: sunucu ≤25 sn bekler; istemci zaman aşımı bunun üstünde olmalı. */
  async wait(p: { rev: number; alarmRev: number; epoch: number }, signal: AbortSignal): Promise<NotificationWaitResult> {
    const r = await apiClient.get<ApiResponse<NotificationWaitResult>>(
      `${BASE}/bekle?rev=${p.rev}&alarmRev=${p.alarmRev}&epoch=${p.epoch}`,
      { signal, timeout: 35_000 },
    );
    return r.data.data;
  },
  async markRead(id: string): Promise<void> {
    await apiClient.post(`${BASE}/${encodeURIComponent(id)}/okundu`);
  },
  async snooze(id: string): Promise<void> {
    await apiClient.post(`${BASE}/${encodeURIComponent(id)}/ertele`, { sure: '1s' });
  },
  async catalog(): Promise<CatalogKind[]> {
    const r = await apiClient.get<ApiResponse<{ turler: CatalogKind[] }>>(`${BASE}/katalog`);
    return r.data.data.turler;
  },
  async preferences(): Promise<PreferencesResponse> {
    const r = await apiClient.get<ApiResponse<PreferencesResponse>>(`${BASE}/tercihler`);
    return r.data.data;
  },
  /** Tam gövde PUT — aynı gövdenin tekrarı aynı sonucu verir (kuyruk yeniden oynatması güvenli). */
  async savePreferences(tercihler: PreferenceItem[]): Promise<PreferencesResponse> {
    const r = await apiClient.put<ApiResponse<PreferencesResponse>>(`${BASE}/tercihler`, { tercihler });
    return r.data.data;
  },
};
