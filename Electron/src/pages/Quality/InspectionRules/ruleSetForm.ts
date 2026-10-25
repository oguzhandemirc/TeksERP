// Kural seti formunun saf durumu: form satırı ↔ sunucu gövdesi. Bant SIRASI/eşik doğruluğu sunucuda
// (`validateBands`); burada yalnız "alan boş mu" sorulur.
import type { RuleBand, RuleScope, RuleSet, RuleSetCreateBody, RunningCap, ScoreUnit } from "./service";

export interface BandRow { key: string; maxScore: string; label: string; accepted: boolean; qualityGradeId: string | null }
export interface RuleSetFormState {
  name: string; scope: RuleScope; customerId: string | null; item: { id: string; name: string } | null;
  unit: ScoreUnit; runningCap: RunningCap; bands: BandRow[];
}

let seq = 0;
export const newBandKey = () => `b${++seq}`;
const fmt = (v: RuleBand["maxScore"]) => (v === null || v === "" ? "" : String(v).replace(".", ","));

export function emptyBand(): BandRow {
  return { key: newBandKey(), maxScore: "", label: "", accepted: true, qualityGradeId: null };
}

export function initialState(set: RuleSet | null, scope: RuleScope): RuleSetFormState {
  if (!set) return { name: "", scope, customerId: null, item: null, unit: "M2", runningCap: "YARD", bands: [emptyBand(), { ...emptyBand(), accepted: false }] };
  return {
    name: set.name, scope: set.scope, customerId: set.customerId, item: set.item ? { id: set.item.id, name: set.item.name } : null,
    unit: set.unit, runningCap: set.runningCap,
    bands: set.bands.map((b) => ({ key: newBandKey(), maxScore: fmt(b.maxScore), label: b.label, accepted: b.accepted, qualityGradeId: b.qualityGradeId })),
  };
}

/** Eksik alanların Türkçe listesi (boşsa kaydedilebilir). Son bandın üst sınırı boş = sınırsız (zorunlu boş değil). */
export function missingFields(s: RuleSetFormState): string[] {
  const out: string[] = [];
  if (!s.name.trim()) out.push("Ad");
  if (s.scope === "CUSTOMER" && !s.customerId) out.push("Müşteri");
  if (s.bands.length === 0) out.push("En az bir bant");
  s.bands.forEach((b, i) => {
    const n = i + 1;
    if (!b.label.trim()) out.push(`${n}. bant etiketi`);
    if (i < s.bands.length - 1 && !b.maxScore.trim()) out.push(`${n}. bant üst sınırı`);
    if (s.scope === "FACTORY" && !b.qualityGradeId) out.push(`${n}. bant kalite derecesi`);
  });
  return out;
}

/** Gövde: virgül → nokta; derece yalnız FACTORY'de gider (CUSTOMER bandında sunucu reddeder). */
export function toBody(s: RuleSetFormState): RuleSetCreateBody {
  return {
    name: s.name.trim(), scope: s.scope, unit: s.unit, runningCap: s.runningCap,
    ...(s.scope === "CUSTOMER" ? { customerId: s.customerId, itemId: s.item?.id ?? null } : {}),
    bands: s.bands.map((b, i) => ({
      sortOrder: i,
      maxScore: b.maxScore.trim() === "" ? null : b.maxScore.trim().replace(",", "."),
      label: b.label.trim(),
      accepted: b.accepted,
      ...(s.scope === "FACTORY" ? { qualityGradeId: b.qualityGradeId } : {}),
    })),
  };
}

export const UNIT_LABEL: Record<ScoreUnit, string> = { M2: "puan / 100 m²", YD2: "puan / 100 yd²" };
export const CAP_LABEL: Record<RunningCap, string> = { YARD: "Yarda başına en çok 4", METER: "Metre başına en çok 4", NONE: "Tavan yok" };
