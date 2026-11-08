// =============================================================================
// LEVENTİN SAHİBİNE DÖNÜŞÜ — F4 (levent sarım işi faturalanabilirliği) okuyucu arayüzü
// =============================================================================
// Faturalanabilir AN = AKTİF (ters kaydı olmayan) `SHIP_TO_OWNER` olayı (F5 emanet çıkışı). "Aktif" sorusunun TEK
// cevabı burası: olayın `reversal`ı (SHIP_TO_OWNER_CANCEL) yok. `serviceAt` = belgenin `dispatchedAt`ı, müşteri =
// belgenin `ownerCustomerId`si; sarım metresi F4'ün kendi okuyucusundadır (burada yalnız çıkış anındaki kalan).
// Belge iptali aynı tx'te F4 bağını damgalar (`consignment-dispatch/cancel.ts`, sebep `CONSIGNMENT_CANCEL`).
// =============================================================================
import { Prisma } from "@prisma/client";

/** F4 bağının iptaldeki damga sebebi (sözleşme). */
export const CONSIGNMENT_CANCEL_REVOKE_REASON = "CONSIGNMENT_CANCEL";

export interface ActiveShipToOwnerBeam {
  warpBeamId: string;
  beamNo: string;
  ownerCustomerId: string;
  dispatchId: string;
  dispatchNo: string;
  consignmentItemId: string;
  shipEventId: string;
  /** Belgenin çıkış anı — F4 `serviceAt`. */
  dispatchedAt: Date;
  /** Çıkışta leventte kalan metre (kalem snapshot'ı). */
  lengthM: Prisma.Decimal;
}

export interface ActiveShipToOwnerFilter {
  ownerCustomerId?: string;
  /** `dispatchedAt >= from` (çağıran fabrika günü sınırını `resolveRangeStart` ile verir). */
  from?: Date;
  /** `dispatchedAt <= to`. */
  to?: Date;
  warpBeamIds?: string[];
}

/** Aktif `SHIP_TO_OWNER` yüklemi — Prisma parçası; iptal edilmiş belgenin olayı ters kayıtlıdır, ayrıca başlık da süzülür. */
export const ACTIVE_SHIP_TO_OWNER_WHERE = {
  kind: "SHIP_TO_OWNER",
  reversal: { is: null },
  consignmentItem: { is: { dispatch: { is: { cancelledAt: null } } } },
} satisfies Prisma.WarpBeamEventWhereInput;

export async function listActiveShipToOwnerBeams(
  db: Pick<Prisma.TransactionClient, "warpBeamEvent">,
  filter: ActiveShipToOwnerFilter = {},
): Promise<ActiveShipToOwnerBeam[]> {
  if (filter.warpBeamIds && filter.warpBeamIds.length === 0) return [];
  const dispatchWhere: Prisma.ConsignmentDispatchWhereInput = {
    cancelledAt: null,
    ...(filter.ownerCustomerId ? { ownerCustomerId: filter.ownerCustomerId } : {}),
    ...(filter.from || filter.to ? { dispatchedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
  };
  const rows = await db.warpBeamEvent.findMany({
    where: {
      kind: ACTIVE_SHIP_TO_OWNER_WHERE.kind,
      reversal: { is: null },
      consignmentItem: { is: { dispatch: { is: dispatchWhere } } },
      ...(filter.warpBeamIds ? { beamId: { in: filter.warpBeamIds } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, beamId: true,
      beam: { select: { beamNo: true } },
      consignmentItem: { select: { id: true, lengthM: true, dispatch: { select: { id: true, dispatchNo: true, ownerCustomerId: true, dispatchedAt: true } } } },
    },
  });
  const out: ActiveShipToOwnerBeam[] = [];
  for (const r of rows) {
    const item = r.consignmentItem;
    if (!item || !item.lengthM) continue; // CHECK gereği SHIP_TO_OWNER kalemsiz olamaz; tip daraltması
    out.push({
      warpBeamId: r.beamId, beamNo: r.beam.beamNo, ownerCustomerId: item.dispatch.ownerCustomerId, dispatchId: item.dispatch.id,
      dispatchNo: item.dispatch.dispatchNo, consignmentItemId: item.id, shipEventId: r.id, dispatchedAt: item.dispatch.dispatchedAt, lengthM: item.lengthM,
    });
  }
  return out;
}

/** Belge iptalinde F4 levent bağlarını damgalar (silinmez); audit çağıranın eyleminde (`revokedBillingLinkIds`). */
export async function revokeConsignmentBeamLinksTx(
  tx: Pick<Prisma.TransactionClient, "serviceBillingLink">,
  input: { linkIds: string[]; userId: string; at: Date },
): Promise<number> {
  if (input.linkIds.length === 0) return 0;
  const r = await tx.serviceBillingLink.updateMany({
    where: { id: { in: input.linkIds }, revokedAt: null },
    data: { revokedAt: input.at, revokedById: input.userId, revokeReason: CONSIGNMENT_CANCEL_REVOKE_REASON },
  });
  return r.count;
}
