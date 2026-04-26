import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export interface CustomerVariantAliasDto {
  id: string;
  customerId: string;
  variantId: string;
  customerLabel: string;
  customerCode: string | null;
  isActive: boolean;
  variant: {
    id: string;
    code: string;
    name: string;
    item: { id: string; code: string; name: string };
  };
}

export interface CreateAliasRequest {
  variantId: string;
  customerLabel: string;
  customerCode?: string | null;
}

export interface UpdateAliasRequest {
  customerLabel?: string;
  customerCode?: string | null;
  isActive?: boolean;
}

export const customerVariantAliasService = {
  list(
    customerId: string,
  ): Promise<ApiResponse<CustomerVariantAliasDto[]>> {
    return apiClient
      .get<ApiResponse<CustomerVariantAliasDto[]>>(
        `/api/customers/${customerId}/variant-aliases`,
      )
      .then((r) => r.data);
  },

  create(
    customerId: string,
    data: CreateAliasRequest,
  ): Promise<ApiResponse<CustomerVariantAliasDto>> {
    return apiClient
      .post<ApiResponse<CustomerVariantAliasDto>>(
        `/api/customers/${customerId}/variant-aliases`,
        data,
      )
      .then((r) => r.data);
  },

  update(
    customerId: string,
    aliasId: string,
    data: UpdateAliasRequest,
  ): Promise<ApiResponse<CustomerVariantAliasDto>> {
    return apiClient
      .patch<ApiResponse<CustomerVariantAliasDto>>(
        `/api/customers/${customerId}/variant-aliases/${aliasId}`,
        data,
      )
      .then((r) => r.data);
  },

  delete(
    customerId: string,
    aliasId: string,
  ): Promise<ApiResponse<{ id: string }>> {
    return apiClient
      .delete<ApiResponse<{ id: string }>>(
        `/api/customers/${customerId}/variant-aliases/${aliasId}`,
      )
      .then((r) => r.data);
  },
};
