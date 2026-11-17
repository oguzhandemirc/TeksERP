import { useQuery, keepPreviousData } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { ApiResponse } from "@/types/api";
import type { WarpEndsSuggest, WarpEndsSuggestBody, WarpPlanBody, WarpPlanResult } from "./types";

/** Çözgü hesabı — YAZMAZ (`POST /api/warp-plan/calculate`, `warpspec:read`; devere kapalıysa 403 `MODULE_DISABLED`). */
export async function calculateWarpPlan(body: WarpPlanBody): Promise<ApiResponse<WarpPlanResult>> {
  // Canlı hesap (yazarken): uyarılar ve hata ekranda satır içi gösterilir — tost yağmaz.
  return (await apiClient.post<ApiResponse<WarpPlanResult>>("/api/warp-plan/calculate", body, { suppressErrorToast: true, serverWarnings: "handled" })).data;
}

/** Kart formu tel önerisi — YAZMAZ ("1000 m'ye kg'dan" · "Taraktan"). */
export async function suggestWarpEnds(body: WarpEndsSuggestBody): Promise<WarpEndsSuggest> {
  return (await apiClient.post<ApiResponse<WarpEndsSuggest>>("/api/warp-plan/ends-suggest", body)).data.data;
}

export const WARP_PLAN_DEBOUNCE_MS = 400;

/** Canlı hesap: gövde ~400 ms durulunca istek; aynı gövdeye ikinci istek yok, eski yanıt yenisi gelene dek kalır. */
export function useWarpPlan(body: WarpPlanBody | null) {
  const settled = useDebouncedValue(body ? JSON.stringify(body) : null, WARP_PLAN_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["warp-plan", settled],
    queryFn: () => calculateWarpPlan(JSON.parse(settled!) as WarpPlanBody),
    enabled: settled !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}
