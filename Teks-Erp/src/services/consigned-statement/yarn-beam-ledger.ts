// =============================================================================
// EMANET EKSTRESİ — İPLİK LOTU (kg) ve LEVENT (m) defterleri
// =============================================================================
// Kalan her bölümde kendi modülünün tek-kaynak bakiyesidir: lot bakiyesi `yarnMovementSign`, levent kalan
// metresi `warpBeamLengthSign`. Bu dosya yalnız KOLONU seçer; işaret o tablolardan gelir (ikinci tanım yok).
// =============================================================================
import { Prisma, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { yarnMovementSign } from "../helpers/yarn-sign.helper";
import { warpBeamLengthSign, type WarpBeamEventKind } from "../../constants/warp-beam";
import type { LedgerEvent, StatementColumn, StatementDocument } from "./types";

/** İplik türü → kolon. ADJUST_* belge bağına göre çözülür (fiş/fatura iptalinin net tersi giriş/çıkış stornosudur). */
const YARN_COLUMN: Record<YarnMovementKind, StatementColumn | "ADJUST"> = {
  IN: "IN",
  OUT: "OUT",
  WARP_ISSUE: "OUT",
  WARP_ISSUE_REVERSAL: "OUT",
  WARP_RETURN: "OUT",
  WARP_RETURN_REVERSAL: "OUT",
  SUBCONTRACT_OUT: "OUT",
  SUBCONTRACT_OUT_CANCEL: "OUT",
  SUBCONTRACT_RETURN: "OUT",
  SUBCONTRACT_RETURN_CANCEL: "OUT",
  ADJUST_IN: "ADJUST",
  ADJUST_OUT: "ADJUST",
};
const YARN_REVERSAL = new Set<YarnMovementKind>([
  YarnMovementKind.WARP_ISSUE_REVERSAL,
  YarnMovementKind.WARP_RETURN_REVERSAL,
  YarnMovementKind.SUBCONTRACT_OUT_CANCEL,
  YarnMovementKind.SUBCONTRACT_RETURN_CANCEL,
]);

export async function readYarnLotEvents(customerId: string, toAt: Date): Promise<LedgerEvent[]> {
  const rows = await prisma.yarnMovement.findMany({
    where: { lot: { ownerCustomerId: customerId }, createdAt: { lte: toAt } },
    select: {
      id: true, kind: true, qtyKg: true, createdAt: true, lotId: true, goodsReceiptId: true, invoiceId: true,
      lot: { select: { lotNo: true, item: { select: { name: true } } } },
      goodsReceipt: { select: { id: true, receiptNo: true } },
      invoice: { select: { id: true, docNo: true } },
      stockCount: { select: { id: true, countNo: true } },
      warpBeam: { select: { id: true, beamNo: true } },
      dispatchItem: { select: { dispatch: { select: { id: true, dispatchNo: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => {
    const mapped = YARN_COLUMN[r.kind];
    const column: StatementColumn = mapped !== "ADJUST" ? mapped : r.goodsReceiptId ? "IN" : r.invoiceId ? "OUT" : "SCRAP";
    const reversal = YARN_REVERSAL.has(r.kind) || (mapped === "ADJUST" && (r.goodsReceiptId !== null || r.invoiceId !== null));
    const document: StatementDocument | null = r.goodsReceipt
      ? { type: "GOODS_RECEIPT", id: r.goodsReceipt.id, no: r.goodsReceipt.receiptNo }
      : r.invoice
        ? { type: "INVOICE", id: r.invoice.id, no: r.invoice.docNo }
        : r.stockCount
          ? { type: "STOCK_COUNT", id: r.stockCount.id, no: r.stockCount.countNo }
          : r.dispatchItem
            ? { type: "SUBCONTRACTOR_DISPATCH", id: r.dispatchItem.dispatch.id, no: r.dispatchItem.dispatch.dispatchNo }
            : r.warpBeam
              ? { type: "WARP_BEAM", id: r.warpBeam.id, no: r.warpBeam.beamNo }
              : null;
    return {
      id: r.id,
      at: r.createdAt,
      subjectId: r.lotId!,
      subjectLabel: r.lot!.lotNo,
      itemName: r.lot!.item.name,
      column,
      effect: r.qtyKg.mul(yarnMovementSign(r.kind)),
      reversal,
      code: r.kind,
      document,
    };
  });
}

/** Levent türü → kolon; bağlama/söküm metre taşımaz (işaret 0) ve okunmaz. */
const BEAM_COLUMN: Record<WarpBeamEventKind, StatementColumn> = {
  WOUND: "IN", WOUND_CANCEL: "IN",
  CONSUMED: "OUT", CONSUMED_CANCEL: "OUT", SHIP_OUT: "OUT", SHIP_OUT_CANCEL: "OUT", RETURNED_IN: "OUT", RETURNED_IN_CANCEL: "OUT",
  EXHAUSTED: "SCRAP", EXHAUST_CANCEL: "SCRAP", SCRAPPED: "SCRAP", SCRAP_CANCEL: "SCRAP", ADJUST_IN: "SCRAP", ADJUST_OUT: "SCRAP",
  MOUNTED: "OUT", MOUNT_CANCEL: "OUT", DISMOUNTED: "OUT", DISMOUNT_CANCEL: "OUT",
};

export async function readWarpBeamEvents(customerId: string, toAt: Date): Promise<LedgerEvent[]> {
  const rows = await prisma.warpBeamEvent.findMany({
    where: { beam: { ownerCustomerId: customerId }, createdAt: { lte: toAt }, lengthM: { not: null } },
    select: {
      id: true, kind: true, lengthM: true, createdAt: true, beamId: true, reversesEventId: true,
      beam: { select: { beamNo: true, warpSpec: { select: { name: true } } } },
      dispatchItem: { select: { dispatch: { select: { id: true, dispatchNo: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const out: LedgerEvent[] = [];
  for (const r of rows) {
    const kind = r.kind as WarpBeamEventKind;
    const sign = warpBeamLengthSign(kind);
    if (sign === 0) continue;
    out.push({
      id: r.id,
      at: r.createdAt,
      subjectId: r.beamId,
      subjectLabel: r.beam.beamNo,
      itemName: r.beam.warpSpec.name,
      column: BEAM_COLUMN[kind],
      effect: new Prisma.Decimal(r.lengthM!).mul(sign),
      reversal: r.reversesEventId !== null || kind.endsWith("_CANCEL"),
      code: kind,
      document: r.dispatchItem ? { type: "SUBCONTRACTOR_DISPATCH", id: r.dispatchItem.dispatch.id, no: r.dispatchItem.dispatch.dispatchNo } : null,
    });
  }
  return out;
}
