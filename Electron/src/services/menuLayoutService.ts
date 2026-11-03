// Menü düzeni (K19) — backend `GET/PUT /api/menu-layout`. Yazım admin:settings + ayar şifresi.
import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";

export interface MenuPresetScreen {
  key: string;
  app: "desktop" | "mobile";
  title: string;
  reason: string;
}

export interface MenuLayoutView {
  hiddenScreens: string[];
  advancedGroup: boolean;
  unhideable: Array<{ key: string; reason: string }>;
  advancedScreens: string[];
  presets: Array<{ id: string; label: string; description: string; screens: MenuPresetScreen[] }>;
}

export async function getMenuLayout(): Promise<MenuLayoutView> {
  const r = await apiClient.get<ApiResponse<MenuLayoutView>>("/api/menu-layout");
  return r.data.data;
}

export function updateMenuLayout(body: { hiddenScreens?: string[]; advancedGroup?: boolean }): Promise<MenuLayoutView> {
  return withSettingsPassword((headers) =>
    apiClient.put<ApiResponse<MenuLayoutView>>("/api/menu-layout", body, { headers }).then((r) => r.data.data),
  );
}
