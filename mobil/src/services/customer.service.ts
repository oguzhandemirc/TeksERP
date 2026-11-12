import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Customer } from '../types/models';

/** Hızlı kaydın opsiyonel kart alanları — sunucu `quickCreateBody` ile aynı küme (alan iki uçta eklenir). */
export interface QuickCustomerExtra {
  taxNumber?: string;
  contactName?: string;
  contactPhone?: string;
  email?: string;
  city?: string;
  district?: string;
  address?: string;
  notes?: string;
}

export const customerService = {
  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Customer>> =>
    apiClient
      .get<PaginatedResponse<Customer>>(`/customers${buildQueryString(params)}`)
      .then((r) => r.data),

  getById: (id: string): Promise<ApiResponse<Customer>> =>
    apiClient.get<ApiResponse<Customer>>(`/customers/${id}`).then((r) => r.data),

  /**
   * Belgeden İE formunda hızlı müşteri kaydı: ad + (seçicinin "Diğer" bölümünden) opsiyonel iletişim alanları. Boş alan
   * GÖNDERİLMEZ (eski sunucu gövdeyi `.strict` doğrular). `clientToken` mantıksal deneme başına; aynı token aynı kartı döner.
   */
  quickCreate: (body: { name: string; clientToken: string } & QuickCustomerExtra): Promise<ApiResponse<Customer>> =>
    apiClient.post<ApiResponse<Customer>>('/customers/quick-create', body).then((r) => r.data),
};
