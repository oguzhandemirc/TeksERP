import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export interface CustomerBranch {
  id: string;
  customerId: string;
  code: string | null;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
}

export const customerBranchService = {
  list: (customerId: string): Promise<ApiResponse<CustomerBranch[]>> =>
    apiClient
      .get<ApiResponse<CustomerBranch[]>>(`/customers/${customerId}/branches`)
      .then((r) => r.data),
};
