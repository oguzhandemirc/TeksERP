// Armür ızgarası saf yardımcıları — satır = atkı, sütun = çerçeve, hücre 0/1. Tavan backend'le
// aynı (32 çerçeve × 512 atkı; `constants/weave-design.ts`); asıl kapı sunucudadır (LIFT_PLAN_INVALID).
import type { LiftPlan } from "./types";

export const LIFT_PLAN_MAX_FRAMES = 32;
export const LIFT_PLAN_MAX_PICKS = 512;

export function liftPlanSize(plan: LiftPlan | null | undefined): { picks: number; frames: number } {
  if (!plan || plan.length === 0) return { picks: 0, frames: 0 };
  return { picks: plan.length, frames: plan.reduce((m, row) => Math.max(m, row.length), 0) };
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.trunc(Number.isFinite(n) ? n : 0)));

/** Izgarayı yeni boyuta getirir; mevcut hücreler korunur, yeni hücreler 0 doğar. */
export function resizeLiftPlan(plan: LiftPlan | null | undefined, picks: number, frames: number): LiftPlan {
  const p = clamp(picks, LIFT_PLAN_MAX_PICKS);
  const f = clamp(frames, LIFT_PLAN_MAX_FRAMES);
  if (f === 0) return [];
  return Array.from({ length: p }, (_, r) => Array.from({ length: f }, (_, c) => (plan?.[r]?.[c] === 1 ? 1 : 0)));
}

/** Tek hücreyi çevirir (değişmez kopya döner). */
export function toggleLiftCell(plan: LiftPlan, pick: number, frame: number): LiftPlan {
  return plan.map((row, r) => (r === pick ? row.map((v, c) => (c === frame ? (v === 1 ? 0 : 1) : v)) : row));
}

/** Kayda giden değer: boş ızgara `null` (sunucuda temizler). */
export function liftPlanForSave(plan: LiftPlan): LiftPlan | null {
  return plan.length === 0 || (plan[0]?.length ?? 0) === 0 ? null : plan;
}
