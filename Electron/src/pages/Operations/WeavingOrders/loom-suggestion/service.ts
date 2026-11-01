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

// Liste kolonu satır başına sorar (toplu uç yok); sunucu her istekte tüm tezgâhları hesapladığından aynı anda
// en fazla LIST_CONCURRENCY istek uçar. Hata hücrede/bölümde gösterilir, global toast basılmaz.
const LIST_CONCURRENCY = 4;
let inFlight = 0;
const waiting: Array<() => void> = [];

export async function withListSlot<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight >= LIST_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
  try {
    return await run();
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

export const loomSuggestionService = {
  forWeavingOrder: (id: string): Promise<LoomSuggestion> =>
    withListSlot(() =>
      apiClient
        .get<ApiResponse<LoomSuggestion>>(`${BASE}/weaving-orders/${id}`, { suppressErrorToast: true })
        .then((r) => r.data.data),
    ),
  forDraft: (d: LoomSuggestionDraft): Promise<LoomSuggestion> =>
    apiClient
      .get<ApiResponse<LoomSuggestion>>(`${BASE}?${draftQuery(d)}`, { suppressErrorToast: true })
      .then((r) => r.data.data),
};
