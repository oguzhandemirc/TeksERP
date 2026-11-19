// =============================================================================
// FASON DEVERE — siparişin İADE listesi (D6-be; salt okuma, iade stornosunun kimlik kaynağı)
// =============================================================================
// Kapsam = `cancelWarpingYarnReturn`ın kabul ettiği kalemler: siparişin kendi sevk kalemleri + aktarma geçmişi olan
// başka sipariş kalemleri (aktarımla gelen kalemden iade, kalemin sevkine yazılır). Storno edilebilirlik kapının
// TEK tanımından (`yarnReturnOpen`; storno satırı ↔ dönüş eşlemesi `cancelledYarnReturnIds`).
// =============================================================================
import { Prisma, ReasonPresetKind, SubcontractorDispatchItemKind, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { yarnReturnOpen } from "../subcontractor-yarn.service";
import { WARPING_WASTE } from "../helpers/warping-yarn-open.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface WarpingYarnReturnRow {
  movementId: string;
  createdAt: string;
  dispatchItemId: string;
  dispatchId: string;
  dispatchNo: string;
  /** Kalem bu siparişin kendi sevkinden mi (false = aktarımla gelen kalem). */
  ownDispatch: boolean;
  yarnItemId: string;
  yarnItemCode: string;
  yarnItemName: string;
  warehouseId: string;
  warehouseName: string | null;
  lotId: string | null;
  lotNo: string | null;
  qtyKg: string;
  /** İadeyle aynı istekte yazılan fire (canlı; iade stornosuyla geri alınır). */
  wasteKg: string;
  reasonCode: string | null;
  reasonLabel: string | null;
  note: string | null;
  status: "ACTIVE" | "CANCELLED";
  canCancel: boolean;
  cancelBlockedReason: string | null;
}

export async function listWarpingYarnReturns(id: string): Promise<WarpingYarnReturnRow[]> {
  const exists = await prisma.warpingOrder.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const items = await sequentialTx(prisma).subcontractorDispatchItem.findMany({
    where: {
      kind: SubcontractorDispatchItemKind.YARN,
      dispatch: { warpingOrderId: { not: null } },
      yarnMovements: { some: { kind: YarnMovementKind.SUBCONTRACT_RETURN } },
      OR: [
        { dispatch: { warpingOrderId: id } },
        { warpingYarnTransfers: { some: { OR: [{ fromWarpingOrderId: id }, { toWarpingOrderId: id }] } } },
      ],
    },
    select: {
      id: true, yarnItemId: true,
      dispatch: { select: { id: true, dispatchNo: true, warpingOrderId: true } },
      yarnItem: { select: { code: true, name: true } },
      yarnMovements: {
        where: { kind: { in: [YarnMovementKind.SUBCONTRACT_RETURN, YarnMovementKind.SUBCONTRACT_RETURN_CANCEL] } },
        select: { id: true, kind: true, qtyKg: true, warehouseId: true, lotId: true, reasonCode: true, reason: true, createdAt: true, warehouse: { select: { name: true } }, lot: { select: { lotNo: true } },
          warpingWastes: { where: { kind: WARPING_WASTE, reversal: null }, select: { qtyKg: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const codes = [...new Set(items.flatMap((i) => i.yarnMovements.map((m) => m.reasonCode).filter((c): c is string => c !== null)))];
  const presets = codes.length > 0
    ? await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.YARN_SUBCONTRACT_RETURN, code: { in: codes } }, select: { code: true, label: true } })
    : [];
  const labels = new Map(presets.map((p) => [p.code, p.label]));
  const out: WarpingYarnReturnRow[] = [];
  for (const it of items) {
    const ms = it.yarnMovements;
    for (const m of ms) {
      if (m.kind !== YarnMovementKind.SUBCONTRACT_RETURN) continue;
      // Durum ve storno edilebilirlik kapının TEK tanımından (iade satırı başka engel taşımaz).
      const cancelled = !yarnReturnOpen(ms, m);
      const blocked = cancelled ? "İade zaten iptal edilmiş." : null;
      out.push({
        movementId: m.id, createdAt: m.createdAt.toISOString(), dispatchItemId: it.id, dispatchId: it.dispatch.id, dispatchNo: it.dispatch.dispatchNo,
        ownDispatch: it.dispatch.warpingOrderId === id, yarnItemId: it.yarnItemId!, yarnItemCode: it.yarnItem?.code ?? "", yarnItemName: it.yarnItem?.name ?? "",
        warehouseId: m.warehouseId, warehouseName: m.warehouse?.name ?? null, lotId: m.lotId, lotNo: m.lot?.lotNo ?? null,
        qtyKg: D(m.qtyKg).toFixed(3), wasteKg: m.warpingWastes.reduce((a, w) => a.plus(w.qtyKg), D(0)).toFixed(3), reasonCode: m.reasonCode, reasonLabel: m.reasonCode ? labels.get(m.reasonCode) ?? null : null, note: m.reason,
        status: cancelled ? "CANCELLED" : "ACTIVE", canCancel: blocked === null, cancelBlockedReason: blocked,
      });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.movementId.localeCompare(a.movementId));
}
