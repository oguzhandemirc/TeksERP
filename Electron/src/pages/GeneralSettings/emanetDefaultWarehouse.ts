// Emanet varsayılan deposu (`emanet.defaultWarehouseId`, genel fason F1b/P1) — `GET/PUT /api/feature-flags/emanet-default-warehouse`
// aynası. Tek yazar o uç (ayar şifresi); ham ayar ucu bu anahtarı reddeder. Doğrulama (pasif/olmayan depo 400) sunucuda.
import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";

export interface EmanetDefaultWarehouseView {
  /** null = ayar boş → emanet top varsayılan depoya doğar (bugünkü davranış). */
  warehouse: { id: string; code: string; name: string; isActive: boolean } | null;
  /** null = kullanılabilir; dolu = sahipli doğumun 400 vereceği sebep (pasif / silinmiş depo). */
  problem: string | null;
  emanetEnabled: boolean;
}

export const EMANET_DEFAULT_WAREHOUSE_QUERY_KEY = ["feature-flags", "emanet-default-warehouse"] as const;

export async function getEmanetDefaultWarehouse(): Promise<EmanetDefaultWarehouseView> {
  return (await apiClient.get<ApiResponse<EmanetDefaultWarehouseView>>("/api/feature-flags/emanet-default-warehouse")).data.data;
}

export function updateEmanetDefaultWarehouse(warehouseId: string | null): Promise<EmanetDefaultWarehouseView> {
  return withSettingsPassword((headers) =>
    apiClient
      .put<ApiResponse<EmanetDefaultWarehouseView>>("/api/feature-flags/emanet-default-warehouse", { warehouseId }, { headers })
      .then((r) => r.data.data),
  );
}
