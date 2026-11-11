import type { Machine } from "./types";
import type { MachineFormValues } from "./schema";

export const MACHINE_PLANNING_KEYS = ["planRpm", "planEfficiencyPct", "maxWorkingWidthCm"] as const;
type PlanningKey = (typeof MACHINE_PLANNING_KEYS)[number];

/** Kayıtlı planlama değeri forma: sayı/metin → virgüllü metin, yok → "". */
export function planningToFormText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n).replace(".", ",") : "";
}

/**
 * Planlama gövdesi: dolu → sayı; boş + kayıtta değer VAR → `null` (temizle); boş + kayıtta yok → anahtar
 * hiç gitmez (gövde bugünküyle aynı; eski sunucu da tanımadığı anahtarı görmez).
 */
export function machinePlanningPayload(
  v: Pick<MachineFormValues, PlanningKey>,
  initial: Pick<Machine, PlanningKey> | null | undefined,
): Partial<Record<PlanningKey, number | null>> {
  const out: Partial<Record<PlanningKey, number | null>> = {};
  for (const k of MACHINE_PLANNING_KEYS) {
    const text = v[k].trim();
    if (text !== "") out[k] = Number(text.replace(",", "."));
    else if (initial?.[k] != null && initial[k] !== "") out[k] = null;
  }
  return out;
}

/** İstek gövdesi — allowlist: yalnız burada adı geçen alan sunucuya gider. */
export const buildMachinePayload = (v: MachineFormValues, initial: Machine | null): Partial<Machine> => ({
  stationId: v.stationId,
  // Kod backend'de üretilir (MAK+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  // Devere Faz 3: yuva sayısı — allowlist satırı (istek gövdesini elle kuran katman).
  warpBeamSlots: v.warpBeamSlots,
  ...machinePlanningPayload(v, initial),
});
