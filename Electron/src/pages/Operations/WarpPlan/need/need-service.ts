import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { needQueryString } from "./need-model";
import type { WarpNeedQuery, WarpNeedResult } from "./need-types";

export const WARP_NEED_QUERY_KEY = "warp-need";

/** Çözgü ihtiyacı → devere önerisi — YAZMAZ (`GET /api/warp-plan/need`, `warpspec:read`; devere kapalıysa 403
 *  `MODULE_DISABLED`). Hata ekranda satır içi gösterilir; tost yağmaz. */
export async function fetchWarpNeed(q: WarpNeedQuery): Promise<WarpNeedResult> {
  const res = await apiClient.get<ApiResponse<WarpNeedResult>>(`/api/warp-plan/need?${needQueryString(q)}`, { suppressErrorToast: true });
  return res.data.data;
}

export function useWarpNeed(q: WarpNeedQuery | null, enabled = true) {
  return useQuery({
    queryKey: [WARP_NEED_QUERY_KEY, q ? needQueryString(q) : null],
    queryFn: () => fetchWarpNeed(q!),
    enabled: enabled && q !== null,
    staleTime: 15_000,
    retry: false,
  });
}

/** 403 (modül kapalı, lisans, yetki) → öneri yüzeyi hiç çizilmez; diğer hatalar satır içi gösterilir. */
export function isNeedHidden(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 403;
}
