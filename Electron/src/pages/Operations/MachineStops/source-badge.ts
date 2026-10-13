// =============================================================================
// TEZGAH DURUŞLARI — KAYNAK ROZETİ (saf): "Kart" / "Elle" / "Simüle" / "Türetilmiş"
// =============================================================================
// Simüle duruş canlı veri gibi görünmemeli (kesif-cihaz: SIMULATED açıkça söylenir);
// K1'de kart insanın açtığı duruşu devralır — kaynak insan kalır, alt satır söyler.
// =============================================================================
import { SOURCE_LABEL, type MachineStop, type StopSource } from "./types";

export type SourceTone = "card" | "manual" | "simulated" | "inferred";

export interface SourceBadge {
  label: string;
  tone: SourceTone;
  hint: string;
  /** Alt satır: K1 devralma · ham kart kodu; yoksa boş. */
  notes: string[];
}

const BASE: Record<StopSource, { label: string; tone: SourceTone; hint: string }> = {
  MACHINE: { label: "Kart", tone: "card", hint: "Tezgaha bağlı makine kartı bildirdi." },
  OPERATOR: { label: "Elle", tone: "manual", hint: `${SOURCE_LABEL.OPERATOR} girdi.` },
  SUPERVISOR: { label: "Elle", tone: "manual", hint: `${SOURCE_LABEL.SUPERVISOR} girdi.` },
  SIMULATED: { label: "Simüle", tone: "simulated", hint: "SİMÜLASYON — gerçek kart verisi değil (demo/eğitim)." },
  INFERRED: { label: "Türetilmiş", tone: "inferred", hint: "Başka kayıtlardan türetildi." },
};

export function stopSourceBadge(s: Pick<MachineStop, "source" | "collectorId" | "rawStopCode">): SourceBadge {
  const base = BASE[s.source] ?? { label: String(s.source), tone: "inferred" as const, hint: "Tanınmayan kaynak." };
  const notes: string[] = [];
  if (base.tone === "manual" && s.collectorId) notes.push("kart devraldı");
  if (s.rawStopCode) notes.push(`kod ${s.rawStopCode}`);
  return { ...base, notes };
}

export const SOURCE_TONE_CLASS: Record<SourceTone, string> = {
  card: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  manual: "bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-200",
  simulated: "bg-fuchsia-100 text-fuchsia-900 border border-dashed border-fuchsia-500 dark:bg-fuchsia-950 dark:text-fuchsia-200",
  inferred: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
};
