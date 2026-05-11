import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export interface SystemSetting {
  key: string;
  value: string;
  description: string | null;
  updatedById: string | null;
  updatedBy?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export const SETTING_KEYS = {
  SHIPPING_TOLERANCE_METERS: "shipping.toleranceMeters",
} as const;

export const systemSettingService = {
  list: (): Promise<ApiResponse<SystemSetting[]>> =>
    apiClient.get<ApiResponse<SystemSetting[]>>("/api/admin/settings").then((r) => r.data),

  upsert: (
    key: string,
    value: string,
    description?: string,
  ): Promise<ApiResponse<SystemSetting>> =>
    apiClient
      .put<ApiResponse<SystemSetting>>(`/api/admin/settings/${encodeURIComponent(key)}`, {
        value,
        description,
      })
      .then((r) => r.data),
};
