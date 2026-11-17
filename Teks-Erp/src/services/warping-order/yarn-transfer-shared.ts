// =============================================================================
// FASON DEVERE — aktarma ortakları: aktarma belgesi okuyucusu · liste (D4b-2; claim `yarn-transfer-cancel.ts`te)
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { WARPING_TRANSFER, WARPING_TRANSFER_CANCEL } from "../helpers/warping-yarn-open.helper";

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, "warpingYarnTransfer">;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const ROW_SELECT = {
  id: true, kind: true, batchId: true, qtyKg: true, note: true, createdAt: true, createdById: true, reversesId: true,
  fromWarpingOrderId: true, toWarpingOrderId: true,
  fromWarpingOrder: { select: { orderNo: true } },
  toWarpingOrder: { select: { orderNo: true } },
  reversal: { select: { id: true, batchId: true, createdAt: true } },
  dispatchItem: { select: { id: true, yarnItemId: true, lotId: true, lot: { select: { lotNo: true } }, yarnItem: { select: { code: true } }, dispatch: { select: { dispatchNo: true } } } },
} satisfies Prisma.WarpingYarnTransferSelect;
type Row = Prisma.WarpingYarnTransferGetPayload<{ select: typeof ROW_SELECT }>;

export interface WarpingTransferBatch {
  batchId: string;
  kind: typeof WARPING_TRANSFER | typeof WARPING_TRANSFER_CANCEL;
  fromWarpingOrderId: string;
  fromOrderNo: string;
  toWarpingOrderId: string;
  toOrderNo: string;
  createdAt: string;
  note: string | null;
  totalKg: string;
  /** Aktarma belgesinin satırlarından en az biri stornolu mu (storno belge başına yazılır: hepsi ya da hiçbiri). */
  cancelled: boolean;
  cancelBatchId: string | null;
  rows: Array<{ transferId: string; kind: string; dispatchItemId: string; dispatchNo: string; yarnItemId: string; code: string; lotId: string | null; lotNo: string | null; qtyKg: string; reversesId: string | null }>;
  warnings: string[];
}

function toBatch(rows: Row[]): WarpingTransferBatch {
  const f = rows[0]!;
  const rev = rows.find((r) => r.reversal)?.reversal ?? null;
  return {
    batchId: f.batchId, kind: f.kind as WarpingTransferBatch["kind"],
    fromWarpingOrderId: f.fromWarpingOrderId, fromOrderNo: f.fromWarpingOrder.orderNo,
    toWarpingOrderId: f.toWarpingOrderId, toOrderNo: f.toWarpingOrder.orderNo,
    createdAt: f.createdAt.toISOString(), note: f.note,
    totalKg: rows.reduce((s, r) => s.plus(r.qtyKg), D(0)).toFixed(3),
    cancelled: rev !== null, cancelBatchId: rev?.batchId ?? null,
    rows: rows.map((r) => ({
      transferId: r.id, kind: r.kind, dispatchItemId: r.dispatchItem.id, dispatchNo: r.dispatchItem.dispatch.dispatchNo,
      yarnItemId: r.dispatchItem.yarnItemId ?? "", code: r.dispatchItem.yarnItem?.code ?? "", lotId: r.dispatchItem.lotId, lotNo: r.dispatchItem.lot?.lotNo ?? null,
      qtyKg: D(r.qtyKg).toFixed(3), reversesId: r.reversesId,
    })),
    warnings: [],
  };
}

export async function loadTransferBatch(db: Db, batchId: string): Promise<WarpingTransferBatch> {
  const rows = await sequentialTx(db).warpingYarnTransfer.findMany({ where: { batchId }, select: ROW_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (rows.length === 0) throw AppError.notFound("Aktarma belgesi bulunamadı.", { code: "WARPING_TRANSFER_NOT_FOUND" });
  return toBatch(rows);
}

/** Siparişin giren/çıkan aktarma ve storno belgeleri — en yeni önce (eşitlikte batchId). */
export async function listWarpingTransfers(db: Db, warpingOrderId: string): Promise<WarpingTransferBatch[]> {
  const rows = await sequentialTx(db).warpingYarnTransfer.findMany({
    where: { OR: [{ fromWarpingOrderId: warpingOrderId }, { toWarpingOrderId: warpingOrderId }] },
    select: ROW_SELECT,
    orderBy: [{ createdAt: "desc" }, { batchId: "asc" }, { id: "asc" }],
    take: 500,
  });
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.batchId, [...(groups.get(r.batchId) ?? []), r]);
  return [...groups.values()].map(toBatch);
}
