import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

/**
 * Demo senaryoları — `demo.modeEnabled` KAPALIYKEN tüm uçlar 403 döner.
 *
 * ⚠️ AYNA LİSTE TUTULMAZ: senaryoların künyesi sunucudan okunur
 * (`GET /api/demo/scenarios`). Burada bir kopya tutulsaydı yeni senaryo
 * eklendiğinde panel onu göremezdi — mobil `permissions.ts` ayna derdinin
 * birebir tekrarı olurdu.
 */
export interface DemoScenario {
  code: string;
  title: string;
  screen: string;
  description: string;
  permissions: string[];
  /** Kullanıcının izinleri bu senaryoya yetiyor mu (sunucu hesaplar). */
  allowed: boolean;
}

export interface RelabelStaleResult {
  rollId: string;
  barcode: string | null;
  oncekiMetraj: number;
  yeniMetraj: number;
  zatenHazir: boolean;
}

export const demoService = {
  listScenarios: async (): Promise<ApiResponse<DemoScenario[]>> => {
    const { data } = await apiClient.get<ApiResponse<DemoScenario[]>>("/api/demo/scenarios");
    return data;
  },

  relabelStale: async (rollId?: string): Promise<ApiResponse<RelabelStaleResult>> => {
    const { data } = await apiClient.post<ApiResponse<RelabelStaleResult>>(
      "/api/demo/scenarios/relabel-stale",
      rollId ? { rollId } : {},
    );
    return data;
  },
};
