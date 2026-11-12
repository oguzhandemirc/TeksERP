// Etiket alıcısı kataloğu (2026-11-10) — emanet topun "kimin için" adı. Backend `customer-consignee.routes.ts`.
// Eski backend (uç yok) → 404 → `null`: çağıran alıcı bölümünü çizmez.
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export interface Consignee {
  id: string;
  customerId: string;
  name: string;
  isActive: boolean;
  labelTemplate: { id: string; name: string } | null;
  lastUsedAt?: string | null;
}

const is404 = (e: unknown) => (e as { response?: { status?: number } })?.response?.status === 404;

export const consigneeService = {
  /** Aktif alıcılar, son kullanılan önce. */
  list: (customerId: string, search?: string): Promise<Consignee[] | null> =>
    apiClient
      .get<ApiResponse<Consignee[]>>(`/customers/${customerId}/consignees`, { params: search ? { search } : undefined })
      .then((r) => r.data.data ?? [])
      .catch((e: unknown) => {
        if (is404(e)) return null;
        throw e;
      }),
  /** Adla bul ya da doğur — doğal anahtarla idempotent (aynı ad iki kez → aynı kayıt). */
  ensure: (customerId: string, name: string): Promise<Consignee> =>
    apiClient
      .post<ApiResponse<{ consignee: Consignee }>>(`/customers/${customerId}/consignees/ensure`, { name })
      .then((r) => (r.data.data as { consignee: Consignee }).consignee),
};
