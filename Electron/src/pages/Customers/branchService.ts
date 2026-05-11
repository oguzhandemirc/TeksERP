import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { CustomerBranch, CustomerBranchPayload } from "./branch-types";

const path = (customerId: string, branchId?: string) =>
  `/api/customers/${customerId}/branches${branchId ? `/${branchId}` : ""}`;

export const customerBranchService = {
  list: (customerId: string, includeInactive = false) =>
    apiClient
      .get<ApiResponse<CustomerBranch[]>>(
        `${path(customerId)}${includeInactive ? "?includeInactive=true" : ""}`,
      )
      .then((r) => r.data),

  create: (customerId: string, data: Partial<CustomerBranchPayload>) =>
    apiClient
      .post<ApiResponse<CustomerBranch>>(path(customerId), data)
      .then((r) => r.data),

  update: (customerId: string, branchId: string, data: Partial<CustomerBranchPayload>) =>
    apiClient
      .patch<ApiResponse<CustomerBranch>>(path(customerId, branchId), data)
      .then((r) => r.data),

  deactivate: (customerId: string, branchId: string) =>
    apiClient
      .delete<ApiResponse<CustomerBranch>>(path(customerId, branchId))
      .then((r) => r.data),
};
