// Tezgâh önerisi (SY-M2 `GET /api/loom-suggestions`) tel tipleri — backend `helpers/loom-suggestion.helper.ts` aynası.
export type LoomTier = "READY" | "BEAM_SHORT" | "WARP_CHANGE";

export interface LoomCandidate {
  machineId: string;
  code: string;
  name: string;
  tier: LoomTier;
  weavableM: number | null;
  surplusM: number | null;
  missingWarpSpecCodes: string[];
  readyBeamNos: string[];
  sameDesignRunning: boolean;
  hasOpenRun: boolean;
  widthWarning: boolean;
}

export interface LoomSuggestion {
  weavingOrderId: string | null;
  itemId: string;
  recipeId: string | null;
  plannedM: number | null;
  candidates: LoomCandidate[];
  warnings: Array<{ code: string; message: string }>;
}

export interface LoomSuggestionDraft {
  itemId: string;
  recipeId?: string | null;
  warpSpecId?: string | null;
  plannedM?: number | null;
}

export const LOOM_TIER_META: Record<LoomTier, { short: string; label: string; tone: string }> = {
  READY: { short: "T1", label: "Hazır", tone: "bg-success/15 text-success border-success/30" },
  BEAM_SHORT: { short: "T2", label: "Levent yetmez", tone: "bg-warning/15 text-warning border-warning/30" },
  WARP_CHANGE: { short: "T3", label: "Çözgü değişimi", tone: "bg-muted text-muted-foreground border-border" },
};

const fmtM = (n: number) => `${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} m`;

/** Adayın tek satırlık açıklaması (kademe ayrıntısı). */
export function candidateDetail(c: LoomCandidate): string {
  if (c.tier === "READY") {
    const run = c.sameDesignRunning ? "aynı desen koşuyor" : c.hasOpenRun ? "başka iş koşuyor" : "boş";
    return c.surplusM == null ? run : `${run} · levent artığı ${fmtM(c.surplusM)}`;
  }
  if (c.tier === "BEAM_SHORT") return c.weavableM == null ? "takılı levent yetmez" : `takılı leventle ${fmtM(c.weavableM)} dokur`;
  const missing = c.missingWarpSpecCodes.join(", ");
  return c.readyBeamNos.length ? `${missing} takılmalı · hazır levent: ${c.readyBeamNos.slice(0, 3).join(", ")}` : `${missing} takılmalı · hazır levent yok`;
}

/** Liste kolonu özeti: hazır tezgâh sayısı + ilk kod; hazır yoksa en iyi kademe. */
export function suggestionSummary(s: LoomSuggestion): { tier: LoomTier | null; text: string } {
  const ready = s.candidates.filter((c) => c.tier === "READY");
  const first = ready[0];
  if (first) return { tier: "READY", text: ready.length === 1 ? first.code : `${first.code} +${ready.length - 1}` };
  const best = s.candidates[0];
  if (!best) return { tier: null, text: "—" };
  return { tier: best.tier, text: best.code };
}

/** machineId → aday (Salon rozeti ve sıralama için). */
export function candidatesByMachine(s: LoomSuggestion | undefined): Map<string, LoomCandidate> {
  return new Map((s?.candidates ?? []).map((c) => [c.machineId, c]));
}

const TIER_RANK: Record<LoomTier, number> = { READY: 0, BEAM_SHORT: 1, WARP_CHANGE: 2 };

/** Salon: seçili tezgâhları önerinin sırasıyla dizer; önerisi olmayan sona. Sıra sunucudandır (yeniden sıralanmaz). */
export function orderByFit<T extends { id: string }>(looms: readonly T[], s: LoomSuggestion | undefined): T[] {
  const rank = new Map((s?.candidates ?? []).map((c, i) => [c.machineId, TIER_RANK[c.tier] * 10_000 + i]));
  return [...looms].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
