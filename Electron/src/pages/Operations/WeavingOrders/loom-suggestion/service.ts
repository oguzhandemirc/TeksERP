// Tezgâh önerisi istemcisi (SY-M3). Uç salt okumadır; kapı `gates.loomSuggestionVisible` (ayar + dokuma + izin).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { LoomSuggestion, LoomSuggestionDraft } from "./types";

const BASE = "/api/loom-suggestions";

export const LOOM_SUGGESTION_QUERY_KEY = ["loom-suggestions"] as const;

function draftQuery(d: LoomSuggestionDraft): string {
  const p = new URLSearchParams({ itemId: d.itemId });
  if (d.recipeId) p.set("recipeId", d.recipeId);
  if (d.warpSpecId) p.set("warpSpecId", d.warpSpecId);
  if (d.plannedM != null && d.plannedM > 0) p.set("plannedM", String(d.plannedM));
  return p.toString();
}

export const loomSuggestionService = {
  forWeavingOrder: (id: string): Promise<LoomSuggestion> =>
    apiClient.get<ApiResponse<LoomSuggestion>>(`${BASE}/weaving-orders/${id}`).then((r) => r.data.data),
  forDraft: (d: LoomSuggestionDraft): Promise<LoomSuggestion> =>
    apiClient.get<ApiResponse<LoomSuggestion>>(`${BASE}?${draftQuery(d)}`).then((r) => r.data.data),
};
