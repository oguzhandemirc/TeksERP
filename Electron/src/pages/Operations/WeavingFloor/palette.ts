// Görsel sözlük — durum → renk değişkeni; kademe → sayaç rengi. Renk tek başına
// anlam taşımaz: her durumun bir ŞEKLİ (StatusShape) ve simgesi de vardır.
import { SOURCE_LABELS } from "../../Reports/Dokuma/dokuma-regime";
import type { EscalationTier } from "./metrics";
import type { LiveLoom, LossClass, LoomType, StateSource } from "./types";

/** `UNMONITORED` = durumu bilinmeyen tezgah (sensör yok, bugün elle kayıt yok; sayılara girmez). */
export type StatusKey = "RUN" | LossClass | "UNMONITORED";

export const STATUS_COLOR: Record<StatusKey, string> = {
  RUN: "var(--ds-run)",
  UNPLANNED: "var(--ds-unplanned)",
  SETUP: "var(--ds-setup)",
  PLANNED: "var(--ds-planned)",
  NON_SCHEDULED: "var(--ds-idle)",
  UNMONITORED: "var(--ds-idle)",
};

export const STATUS_LABEL: Record<StatusKey, string> = {
  RUN: "Çalışıyor",
  UNPLANNED: "Arıza / kopuş",
  SETUP: "Ayar / hazırlık",
  PLANNED: "Planlı duruş",
  NON_SCHEDULED: "Plan dışı",
  UNMONITORED: "Veri yok",
};

/** Kart kaynak etiketi — sözcükler karne raporlarının kaynak etiketleriyle aynı. */
export const STATE_SOURCE_LABEL: Record<StateSource, string> = {
  olculen: SOURCE_LABELS.MACHINE,
  elle: "Elle",
  simule: SOURCE_LABELS.SIMULATED,
  cikarim: SOURCE_LABELS.INFERRED,
};

export const STATE_SOURCE_HINT: Record<StateSource, string> = {
  olculen: "Durum tezgah sensöründen ölçülüyor.",
  elle: "Durum tabletten elle girilen kayıtlardan (duruş · koşum · indirme) — sensör ölçümü değil; süre, kaydın girildiği andan sayılır.",
  simule: "Simüle veri — gerçek ölçüm değil.",
  cikarim: "Sensör yok ve bugün elle kayıt yok.",
};

/** Sebep bekleyen duruş (sınıfı yok) plansız kayıp gibi çizilir — açıklanmamış duruş kayıptır. */
export function statusOf(t: LiveLoom): StatusKey {
  if (!t.monitored) return "UNMONITORED";
  return t.openStop ? (t.openStop.lossClass ?? "UNPLANNED") : "RUN";
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
