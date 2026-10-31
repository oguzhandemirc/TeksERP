// SY-K2 — sipariş satırının plan alanları (varyant · top boyu · hedef değer) gövde parçası.
// Yeni satırda yalnız DOLU alan gönderilir (varyantsız sipariş gövdesi bugünküyle bayt-aynı);
// güncellemede alan her zaman gider: gövdede yoksa sunucu dokunmaz, kaldırma için null/[] gerekir.
import type { OrderLineFormValues } from "./schema";

export interface OrderLinePlanPayload {
  recipeId?: string | null;
  pieceLengthM?: number | null;
  targetValues?: Array<{ propertyId: string; valueId: string }>;
}

export function linePlanPayload(l: OrderLineFormValues, mode: "create" | "update"): OrderLinePlanPayload {
  const targets = l.targetValues ?? [];
  if (mode === "update") {
    return { recipeId: l.recipeId ?? null, pieceLengthM: l.pieceLengthM ?? null, targetValues: targets };
  }
  return {
    ...(l.recipeId ? { recipeId: l.recipeId } : {}),
    ...(l.pieceLengthM != null ? { pieceLengthM: l.pieceLengthM } : {}),
    ...(targets.length > 0 ? { targetValues: targets } : {}),
  };
}
