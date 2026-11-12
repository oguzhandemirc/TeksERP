// Adım `outputStage` eski-istemci koruması (2026-11-10, plan "Top aşaması").
// Rota/İE adımları her kayıtta silinip yeniden yazılır; alanı bilmeyen eski panel/tablet
// `outputStage` göndermez → aynı sıra + istasyondaki eski değer taşınır. Gönderilen null = otomatik.
import type { RollStage } from "@prisma/client";

export interface StageCarrierStep {
  sequence?: unknown;
  stationId?: unknown;
  outputStage?: RollStage | null;
}

export interface OldStepStage {
  sequence: number;
  stationId: string | null;
  outputStage: RollStage | null;
}

/** `outputStage` anahtarı HİÇ olmayan adımlara eski eşleşenin değerini yazar (yerinde). */
export function keepStepOutputStage<T extends StageCarrierStep>(steps: T[], old: readonly OldStepStage[]): void {
  if (old.length === 0) return;
  const byKey = new Map<string, RollStage | null>();
  for (const o of old) byKey.set(`${o.sequence}|${o.stationId ?? ""}`, o.outputStage);
  for (const s of steps) {
    if ("outputStage" in s) continue;
    const key = `${String(s.sequence)}|${s.stationId == null ? "" : String(s.stationId)}`;
    const kept = byKey.get(key);
    if (kept != null) s.outputStage = kept;
  }
}
