// =============================================================================
// EMANET İPLİK / LEVENT — müşteri başına içerideki bakiye (genel fason PB1, 2026-11-08)
// =============================================================================
// Top tarafının tek kaynağı `getConsignedWorkSummary` (İçerideki İşler); bu dosya yalnız iplik ve leventi ekler.
// İplik kg lot defterinin TEK işaret kaynağından (`yarnLotBalancesTx`), levent "içeride" kümesi aşağıdaki sabitten.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { yarnLotBalancesTx } from "./yarn-lot.helper";

/**
 * Emanet levent "hâlâ bizim elimizde" kümesi: depoda hazır · tezgahta · fasoncuda (dönecek). Planlı (henüz sarılmamış),
 * iptal, bitmiş, hurda ve sahibine verilmiş levent içeride sayılmaz.
 */
export const CONSIGNED_BEAM_INSIDE_STATUSES: readonly WarpBeamStatus[] = [
  WarpBeamStatus.READY,
  WarpBeamStatus.MOUNTED,
  WarpBeamStatus.SHIPPED_OUT,
];

export interface ConsignedMaterialRow {
  /** Lot defterinden kalan kg (`null` = iplik modülü kapalı, ölçülmedi). */
  yarnKg: Prisma.Decimal | null;
  /** İçerideki emanet levent sayısı (`null` = devere modülü kapalı). */
  beamCount: number | null;
}

/** Sahip → iplik kg + levent sayısı. Kapalı modülün alanı `null` (0 değil: "yok" ile "ölçülmedi" ayrı). */
export async function consignedMaterialByOwner(opts: { yarn: boolean; beam: boolean }): Promise<Map<string, ConsignedMaterialRow>> {
  const out = new Map<string, ConsignedMaterialRow>();
  const row = (id: string): ConsignedMaterialRow => {
    let r = out.get(id);
    if (!r) {
      r = { yarnKg: opts.yarn ? new Prisma.Decimal(0) : null, beamCount: opts.beam ? 0 : null };
      out.set(id, r);
    }
    return r;
  };
  if (opts.yarn) {
    const lots = await prisma.yarnLot.findMany({ where: { ownerCustomerId: { not: null } }, select: { id: true, ownerCustomerId: true } });
    const balances = await yarnLotBalancesTx(prisma, lots.map((l) => l.id));
    for (const l of lots) {
      const kg = balances.get(l.id);
      // Bakiyesi sıfırlanmış eski lot sahibi listeye satır doğurmaz.
      if (!kg || kg.isZero()) continue;
      const r = row(l.ownerCustomerId!);
      r.yarnKg = r.yarnKg!.plus(kg);
    }
  }
  if (opts.beam) {
    const groups = await prisma.warpBeam.groupBy({
      by: ["ownerCustomerId"],
      where: { ownerCustomerId: { not: null }, status: { in: [...CONSIGNED_BEAM_INSIDE_STATUSES] } },
      _count: { _all: true },
    });
    for (const g of groups) row(g.ownerCustomerId!).beamCount = g._count._all;
  }
  return out;
}
