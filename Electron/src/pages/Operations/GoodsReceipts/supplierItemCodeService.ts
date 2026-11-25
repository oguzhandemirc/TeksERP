// =============================================================================
// Tedarikçi kalem kodu ↔ iplik kartı (Seyitoğlu d5) — backend `/api/supplier-item-codes` aynası
// =============================================================================
// Eşleme mal kabulde ÖĞRENİLİR (backend, kabul kaydında); panel öneri ister, tedarikçi kartında listeler/düzeltir/kaldırır.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface SupplierItemCodeMatch {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  hitCount: number;
}

export interface SupplierItemCodeSuggestion {
  code: string | null;
  match: SupplierItemCodeMatch | null;
}

export interface SupplierItemCodeRow {
  id: string;
  supplierId: string;
  codeKey: string;
  rawCode: string;
  itemId: string;
  hitCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: { id: string; name: string };
  item: { id: string; code: string; name: string; itemType: string };
}

export const supplierItemCodeService = {
  suggest: (supplierId: string, code: string): Promise<ApiResponse<SupplierItemCodeSuggestion>> =>
    apiClient.get<ApiResponse<SupplierItemCodeSuggestion>>("/api/supplier-item-codes/suggest", { params: { supplierId, code } }).then((r) => r.data),

  list: (supplierId: string): Promise<ApiResponse<SupplierItemCodeRow[]>> =>
    apiClient.get<ApiResponse<SupplierItemCodeRow[]>>("/api/supplier-item-codes", { params: { supplierId } }).then((r) => r.data),

  /** Ürün kartı "Ticari" sekmesi: bu iplik kartına eşlenmiş tedarikçi kodları (salt okuma). */
  listByItem: (itemId: string): Promise<ApiResponse<SupplierItemCodeRow[]>> =>
    apiClient.get<ApiResponse<SupplierItemCodeRow[]>>("/api/supplier-item-codes", { params: { itemId } }).then((r) => r.data),

  update: (id: string, itemId: string): Promise<ApiResponse<SupplierItemCodeRow>> =>
    apiClient.patch<ApiResponse<SupplierItemCodeRow>>(`/api/supplier-item-codes/${id}`, { itemId }).then((r) => r.data),

  remove: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient.delete<ApiResponse<{ id: string }>>(`/api/supplier-item-codes/${id}`).then((r) => r.data),
};
