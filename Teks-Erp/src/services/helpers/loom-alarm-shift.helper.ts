// =============================================================================
// TEZGAH ALARMI — hedef saatinin vardiya girdisi (motor ve Tezgah Salonu aynı okuma)
// =============================================================================
// `alarmClockStart` (loom-floor.helper, saf) vardiya dışında açılıp vardiyaya taşan duruşun saatini
// taştığı ilk canlı vardiyanın başından başlatır; bunun için açık duruşların en eskisinden ŞU ANA kadar
// kesişen canlı vardiya pencereleri gerekir. Okuma tek yerde: iki yüzey aynı kümeyi görsün.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { alarmShiftEligible, type ShiftWindow } from "./loom-floor.helper";

type Db = Pick<Prisma.TransactionClient, "shiftInstance">;

/** Pencere gereken en eski an: açıldığı vardiya canlı OLMAYAN açık duruşların en eski başlangıcı (yoksa null). */
export function clockShiftsFrom(stops: ReadonlyArray<{ startedAt: Date; shiftInstance: { isCancelled: boolean } | null }>): Date | null {
  let from: number | null = null;
  for (const s of stops) {
    if (alarmShiftEligible(s.shiftInstance)) continue;
    const t = s.startedAt.getTime();
    if (from === null || t < from) from = t;
  }
  return from === null ? null : new Date(from);
}

/** `[from, now]` ile kesişen canlı (iptal edilmemiş) vardiya pencereleri, başlangıç sırasıyla. */
export async function loadClockShiftWindows(db: Db, from: Date | null, now: Date): Promise<ShiftWindow[]> {
  if (from === null) return [];
  return db.shiftInstance.findMany({
    where: { isCancelled: false, startsAt: { lte: now }, endsAt: { gt: from } },
    select: { startsAt: true, endsAt: true, isCancelled: true },
    orderBy: { startsAt: "asc" },
  });
}
