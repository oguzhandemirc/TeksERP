// Emanet ekstresi servisi + emanet sahibi seçici kaynağı. Sahip listesi müşteri KATALOĞU değil (`customer:read` istemez):
// en az bir topun sahibi olmuş müşteriler (`/api/rolls/owner-customers`, `roll:read`) — İçerideki İşler'in izniyle aynı.
import { lowerTr } from "@/lib/tr-case";
import apiClient from "@/services/apiClient";
import type { CrudService } from "@/services/crudService";
import type { ApiResponse } from "@/types/api";
import type { ConsignedStatement } from "./types";

export const CONSIGNED_STATEMENT_QUERY_KEY = "consigned-statement";

export interface StatementResponse {
  data: ConsignedStatement;
  /** Sunucu uyarıları (canlı metreyle fark · defter ufku öncesi doğmuş top). */
  warnings: string[];
}

export async function getConsignedStatement(customerId: string, from: string, to: string): Promise<StatementResponse> {
  const r = await apiClient.get<ApiResponse<ConsignedStatement> & { warnings?: string[] }>(
    `/api/consigned-work/${encodeURIComponent(customerId)}/statement`,
    { params: { from, to } },
  );
  return { data: r.data.data, warnings: r.data.warnings ?? [] };
}

export interface OwnerCustomer {
  id: string;
  name: string;
  code: string | null;
}

async function loadOwners(): Promise<OwnerCustomer[]> {
  const r = await apiClient.get<{ data: OwnerCustomer[] }>("/api/rolls/owner-customers");
  return r.data.data ?? [];
}

/**
 * `EntityPickerModal` kaynağı: liste küçük ve TEK istekte tamamı gelir (EL-15) → arama burada süzer, sayfalama yok.
 * Yalnız modalın kullandığı iki yöntem gerçektir; yazma yöntemleri bu kaynakta yoktur.
 */
export const ownerCustomerPickerService = {
  listCursor: async ({ search }: { search?: string }) => {
    const q = lowerTr((search ?? "").trim());
    const all = await loadOwners();
    const data = q ? all.filter((o) => lowerTr(`${o.name} ${o.code ?? ""}`).includes(q)) : all;
    return { success: true, data, pagination: { nextCursor: null, hasMore: false, limit: data.length, totalEstimate: data.length } };
  },
  getById: async (id: string) => {
    const hit = (await loadOwners()).find((o) => o.id === id);
    if (!hit) throw new Error("Emanet sahibi bulunamadı");
    return { success: true, data: hit };
  },
} as unknown as CrudService<OwnerCustomer>;
