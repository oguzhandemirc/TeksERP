// Kumaş görünümünün tahar kaynağı (T1 paneli): kumaşın tahar planı varsa plan dizisi, yoksa tür dizilimi.
// Sunucu `weave-card.service.fabricView` ile aynı seçim (`planDraw` ?? `drawUnit`) — basım ile önizleme ayrışmasın.
import { drawUnit, planDraw } from "@/components/weave/weave-drawdown";
import type { DrawingInType } from "@/components/weave/weave-drawing-in";

/** Ürünün seçili tahar planından önizlemenin okuduğu alt küme (sunucu açılmış 1-tabanlı dizi). */
export interface PreviewDrawingInPlan { code: string; threading: number[] }

export interface PreviewDrawingIn {
  /** computeDrawdown'a gidecek plan dizisi (1-tabanlı) ya da null → türden. */
  threading: number[] | null;
  /** Bir tahar raporunun tel sayısı (rapor bandı). */
  unitEnds: number;
  /** Plan kullanılabildi mi (çerçeve no'ları desen örgüsüne sığıyor). */
  planApplied: boolean;
}

export function resolvePreviewDrawingIn(
  plan: PreviewDrawingInPlan | null | undefined, frames: number, ground: readonly number[], type: DrawingInType | null,
): PreviewDrawingIn {
  const fromPlan = planDraw(plan?.threading, frames);
  if (fromPlan) return { threading: plan!.threading, unitEnds: fromPlan.length, planApplied: true };
  return { threading: null, unitEnds: drawUnit(ground, type).length, planApplied: false };
}

/** Önizleme yanındaki kısa not; plan yoksa boş (bugünkü metin aynen kalır). */
export function drawingInPlanNote(plan: PreviewDrawingInPlan | null | undefined, applied: boolean): string | null {
  if (!plan) return null;
  return applied
    ? `Tahar: ${plan.code}`
    : `Tahar: ${plan.code} — plan çerçeveleri desen örgüsünü aşıyor, tahar türüyle çizildi`;
}
