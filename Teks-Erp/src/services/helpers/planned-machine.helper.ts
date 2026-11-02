/**
 * Plan makinesi (Gülkesim 2026-11-02) — rota/İE adımının ÖNERİLEN makinesi.
 *
 * Yalnız öneri: fiilî makine okutan tabletin oturumundan gelir, engel/uyarı yoktur.
 * Tek doğrulama kuralı burada: makine VAR, AKTİF ve adımın İSTASYONUNA ait.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Db = PrismaClient | Prisma.TransactionClient;

export interface PlannedMachinePair {
  stationId: string;
  plannedMachineId?: string | null;
}

export const PLANNED_MACHINE_STATION_MISMATCH = "PLANNED_MACHINE_STATION_MISMATCH";
export const PLANNED_MACHINE_INACTIVE = "PLANNED_MACHINE_INACTIVE";

/** Gövde adımlarından (istasyonu belli olanlar) doğrulanacak çiftler. */
export function plannedPairsOf(steps: ReadonlyArray<{ stationId?: unknown; plannedMachineId?: string | null }>): PlannedMachinePair[] {
  return steps
    .filter((st): st is { stationId: string; plannedMachineId?: string | null } => typeof st.stationId === "string")
    .map((st) => ({ stationId: st.stationId, plannedMachineId: st.plannedMachineId ?? null }));
}

/** Verilen (istasyon, makine) çiftlerini doğrular; ihlalde 400 (details.code). */
export async function assertPlannedMachines(db: Db, pairs: PlannedMachinePair[]): Promise<void> {
  const wanted = pairs.filter((p): p is { stationId: string; plannedMachineId: string } => !!p.plannedMachineId);
  if (wanted.length === 0) return;
  const ids = [...new Set(wanted.map((p) => p.plannedMachineId))];
  const rows = await db.machine.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, stationId: true, isActive: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const p of wanted) {
    const m = byId.get(p.plannedMachineId);
    if (!m) throw AppError.badRequest("Önerilen makine bulunamadı", { code: PLANNED_MACHINE_STATION_MISMATCH });
    if (!m.isActive) {
      throw AppError.badRequest(`Önerilen makine pasif: ${m.name}`, { code: PLANNED_MACHINE_INACTIVE });
    }
    if (m.stationId !== p.stationId) {
      throw AppError.badRequest(`${m.name} bu adımın istasyonuna ait değil`, { code: PLANNED_MACHINE_STATION_MISMATCH });
    }
  }
}

/**
 * Şablondan gelen öneriyi süzer: makine pasife düşmüş ya da istasyonu değişmişse öneri DÜŞER
 * ve uyarı döner — eski şablon iş emri açılışını durdurmaz (öneri, kilit değil).
 */
export async function filterTemplatePlannedMachines<T extends PlannedMachinePair>(
  db: Db,
  steps: T[],
): Promise<{ steps: T[]; warnings: string[] }> {
  const ids = [...new Set(steps.map((s) => s.plannedMachineId).filter((x): x is string => !!x))];
  if (ids.length === 0) return { steps, warnings: [] };
  const rows = await db.machine.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, stationId: true, isActive: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const warnings: string[] = [];
  const out = steps.map((s) => {
    if (!s.plannedMachineId) return s;
    const m = byId.get(s.plannedMachineId);
    if (m && m.isActive && m.stationId === s.stationId) return s;
    warnings.push(`Rota şablonundaki önerilen makine kullanılamıyor (${m?.name ?? "silinmiş"}) — öneri boş bırakıldı.`);
    return { ...s, plannedMachineId: null };
  });
  return { steps: out, warnings };
}
