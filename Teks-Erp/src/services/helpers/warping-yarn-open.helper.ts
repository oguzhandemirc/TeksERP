// =============================================================================
// FASON DEVERE — siparişin deverecideki ipliği (D4b; TEK OKUYUCU: sevk önizlemesi, sevk kapıları, iptal, sipariş DTO)
// =============================================================================
// Kalem açık bakiyesi = çıkış − net iade − (eski) WOUND bağı; yalnız iptal edilmemiş, `warpingOrderId` dolu başlıkların
// iplik kalemleri. Sanal depo yok, satır yazılmaz — iplik defterinden (`YarnMovement` SUBCONTRACT_*) türetilir.
// Sahip = kalemin lotunun `ownerCustomerId`si (lotsuz = fabrikanın malı, null). D5 dağıtım/fire bu helper'ı genişletir.
// =============================================================================
import { Prisma, SubcontractorDispatchItemKind, YarnMovementKind } from "@prisma/client";
import { sequentialTx } from "./tx-sequential-relations.helper";

type Db = Pick<Prisma.TransactionClient, "subcontractorDispatchItem">;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface WarpingYarnItem {
  dispatchItemId: string;
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: Date;
  warpingOrderId: string;
  yarnItemId: string;
  warehouseId: string;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  /** Kalemin brüt çıkışı (sevk rakamı her yüzeyde BRÜT). */
  outKg: Prisma.Decimal;
  /** Net iade (SUBCONTRACT_RETURN − SUBCONTRACT_RETURN_CANCEL). */
  returnedKg: Prisma.Decimal;
  /** Eski tek kalem bağıyla (G1c) sarılan nominal kg — devere sevkinde D5'e kadar 0. */
  woundKg: Prisma.Decimal;
  /** = çıkış − iade − sarılan; bu siparişin deverecide duran ipliği. */
  openKg: Prisma.Decimal;
}

export const WARPING_YARN_ITEM_SELECT = {
  id: true, yarnItemId: true, warehouseId: true, lotId: true, dispatchedQty: true,
  lot: { select: { lotNo: true, ownerCustomerId: true } },
  dispatch: { select: { id: true, dispatchNo: true, dispatchedAt: true, warpingOrderId: true } },
  yarnMovements: { select: { kind: true, qtyKg: true } },
  warpBeamEvents: { where: { kind: "WOUND" as const, reversal: null }, select: { theoreticalKg: true } },
} satisfies Prisma.SubcontractorDispatchItemSelect;
type Row = Prisma.SubcontractorDispatchItemGetPayload<{ select: typeof WARPING_YARN_ITEM_SELECT }>;

export function toWarpingYarnItem(r: Row): WarpingYarnItem {
  const returned = r.yarnMovements.reduce((acc, m) => {
    if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN) return acc.plus(m.qtyKg);
    if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN_CANCEL) return acc.minus(m.qtyKg);
    return acc;
  }, D(0));
  const wound = r.warpBeamEvents.reduce((acc, e) => acc.plus(e.theoreticalKg ?? 0), D(0));
  const out = D(r.dispatchedQty);
  return {
    dispatchItemId: r.id, dispatchId: r.dispatch.id, dispatchNo: r.dispatch.dispatchNo, dispatchedAt: r.dispatch.dispatchedAt,
    warpingOrderId: r.dispatch.warpingOrderId!, yarnItemId: r.yarnItemId!, warehouseId: r.warehouseId!, lotId: r.lotId,
    lotNo: r.lot?.lotNo ?? null, ownerCustomerId: r.lot?.ownerCustomerId ?? null,
    outKg: out, returnedKg: returned, woundKg: wound, openKg: out.minus(returned).minus(wound),
  };
}

/** Canlı (iptal edilmemiş) devere sevklerinin iplik kalemleri — sevk sırası (`dispatchedAt`, eşitlikte kalem `createdAt`, `id`). */
export async function loadWarpingYarnItems(db: Db, where: { warpingOrderId: string } | { dispatchId: string }): Promise<WarpingYarnItem[]> {
  // Dört ilişki aynı düzeyde: tx içinde paralel SQL (pg uyarısı) olmasın diye sıralı yükle.
  const rows = await sequentialTx(db).subcontractorDispatchItem.findMany({
    where: {
      kind: SubcontractorDispatchItemKind.YARN,
      dispatch: "warpingOrderId" in where ? { warpingOrderId: where.warpingOrderId, cancelledAt: null } : { id: where.dispatchId, warpingOrderId: { not: null } },
    },
    select: WARPING_YARN_ITEM_SELECT,
    orderBy: [{ dispatch: { dispatchedAt: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toWarpingYarnItem);
}

/** İplik başına toplam — brüt çıkış · iade · deverecide kalan. */
export function sumByYarn(items: WarpingYarnItem[]): Map<string, { outKg: Prisma.Decimal; returnedKg: Prisma.Decimal; openKg: Prisma.Decimal }> {
  const m = new Map<string, { outKg: Prisma.Decimal; returnedKg: Prisma.Decimal; openKg: Prisma.Decimal }>();
  for (const it of items) {
    const cur = m.get(it.yarnItemId) ?? { outKg: D(0), returnedKg: D(0), openKg: D(0) };
    m.set(it.yarnItemId, { outKg: cur.outKg.plus(it.outKg), returnedKg: cur.returnedKg.plus(it.returnedKg), openKg: cur.openKg.plus(it.openKg) });
  }
  return m;
}

/** Lot kümesi anahtarı — lotsuz satır ayrı bir "lot" sayılır (karışımın bilinmediği hâl). */
export const lotKey = (lotId: string | null): string => lotId ?? "∅";
