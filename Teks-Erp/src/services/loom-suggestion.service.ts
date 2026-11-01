// Tezgâh önerisi (SY-M2) — HTTP katmanının servis kapısı; karar `helpers/loom-suggestion.helper` (salt okuma).
import prisma from "../lib/prisma";
import type { ApiResponse } from "../types/api.types";
import { suggestLoomsForWeaving, type LoomSuggestion, type LoomSuggestionInput } from "./helpers/loom-suggestion.helper";

export async function getLoomSuggestion(input: LoomSuggestionInput): Promise<ApiResponse<LoomSuggestion>> {
  return { success: true, data: await suggestLoomsForWeaving(prisma, input) };
}
