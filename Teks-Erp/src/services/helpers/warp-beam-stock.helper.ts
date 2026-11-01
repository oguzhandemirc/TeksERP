// =============================================================================
// HAZIR ÇÖZGÜ STOĞU — çözgü kartı başına READY/MOUNTED leventler + kalan metre (gösterim okuyucusu)
// =============================================================================
// Kalan metre YALNIZ `remainingByBeam`tan (olay defteri); plan uzunluğu kalan yerine okunmaz. Maliyet
// köprüsü (`readReadyBeamRemainingM`), üretim önerisinin levent ihtiyacı ve tezgâh önerisi buradan okur.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import { remainingByBeam } from "./warp-beam.helper";

export interface StockBeam {
  id: string;
  beamNo: string;
  status: WarpBeamStatus;
  currentMachineId: string | null;
  remainingM: number;
}

/** Çözgü kartı başına kalanı > 0 olan READY + MOUNTED leventler (levent no sırasıyla). */
export async function readBeamStockBySpec(
  db: Pick<Prisma.TransactionClient, "warpBeam" | "warpBeamEvent">,
  warpSpecIds: readonly string[],
): Promise<Map<string, StockBeam[]>> {
  const out = new Map<string, StockBeam[]>();
  if (warpSpecIds.length === 0) return out;
  const beams = await db.warpBeam.findMany({
    where: { warpSpecId: { in: [...warpSpecIds] }, status: { in: [WarpBeamStatus.READY, WarpBeamStatus.MOUNTED] } },
    select: { id: true, beamNo: true, status: true, currentMachineId: true, warpSpecId: true },
    orderBy: { beamNo: "asc" },
  });
  const remaining = await remainingByBeam(db, beams.map((b) => b.id));
  for (const b of beams) {
    const m = remaining.get(b.id) ?? 0;
    if (m <= 0) continue;
    const list = out.get(b.warpSpecId) ?? [];
    list.push({ id: b.id, beamNo: b.beamNo, status: b.status, currentMachineId: b.currentMachineId, remainingM: m });
    out.set(b.warpSpecId, list);
  }
  return out;
}
