// Görsel sözlük — durum → renk değişkeni; kademe → sayaç rengi. Renk tek başına
// anlam taşımaz: her durumun bir ŞEKLİ (StatusShape) ve simgesi de vardır.
import type { EscalationTier } from "./metrics";
import { reasonOf } from "./stopReasons";
import type { LiveLoom, LossClass, LoomType } from "./types";

export type StatusKey = "RUN" | LossClass;

export const STATUS_COLOR: Record<StatusKey, string> = {
  RUN: "var(--ds-run)",
  UNPLANNED: "var(--ds-unplanned)",
  SETUP: "var(--ds-setup)",
  PLANNED: "var(--ds-planned)",
  NON_SCHEDULED: "var(--ds-idle)",
};

export const STATUS_LABEL: Record<StatusKey, string> = {
  RUN: "Çalışıyor",
  UNPLANNED: "Arıza / kopuş",
  SETUP: "Ayar / hazırlık",
  PLANNED: "Planlı duruş",
  NON_SCHEDULED: "Plan dışı",
};

export function statusOf(t: LiveLoom): StatusKey {
  return t.openStop ? reasonOf(t.openStop.reasonCode).lossClass : "RUN";
}

/** Sayaç rengi: hedef içinde mürekkep, aşınca kehribar, iletilince koyu kırmızı. */
export const TIER_COLOR: Record<EscalationTier, string> = {
  UNTRACKED: "var(--ds-idle)",
  WITHIN: "var(--ds-ink)",
  OVERDUE: "var(--ds-over)",
  ESCALATED: "var(--ds-escalated)",
};

export const TIER_LABEL: Record<EscalationTier, string> = {
  UNTRACKED: "Süre izlenmiyor",
  WITHIN: "Hedef süre içinde",
  OVERDUE: "Hedef süre aşıldı",
  ESCALATED: "Patrona iletildi",
};

export const LOOM_TYPE_LABEL: Record<LoomType, string> = {
  AIR_JET: "Hava jetli",
  RAPIER: "Kancalı",
};

export const hsl = (v: string, alpha?: number): string => (alpha === undefined ? `hsl(${v})` : `hsl(${v} / ${alpha})`);

/** Devir → mekik vuruş süresi (sn): hızlı tezgah hızlı görünür, göz yormayacak aralıkta. */
export function beatSeconds(rpm: number): number {
  if (rpm <= 0) return 1.4;
  return Math.max(0.7, Math.min(1.6, 600 / rpm));
}
