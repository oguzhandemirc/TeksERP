// =============================================================================
// FASON DEVERE — devereciden İADE (+ isteğe bağlı FİRE) · önizleme · iade stornosu (fireyi de geri alır)
// =============================================================================
// Tek tx, kilit sırası mevcut iade ucuyla aynı: sipariş claim (İLK ifade) → kalem FOR UPDATE → iade hareketi → fire satırı
// (kapanışla AYNI yazar `writeWastesTx`, kaynak = iade hareketi) → kalan 0 ise otomatik kapanış (`auto-settle.ts`).
// Fire % ve tolerans kapanış planının TEK hesabından (`evaluateSettle`); tolerans yalnız uyarır (kapanışla aynı).
// İdempotency: `clientToken` iade hareketine yazılır (`YarnMovement.clientToken` + gövde özeti), boğaz `tokenReplay`.
// =============================================================================
import { createHash } from "node:crypto";
import { Prisma, WarpingOrderStatus, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { cancelledYarnReturnIds, cancelYarnReturnTx, yarnReturnOpen, type ReturnYarnInput } from "../subcontractor-yarn.service";
import { loadWarpingYarnItems, lockDispatchItemsTx, WARPING_WASTE } from "../helpers/warping-yarn-open.helper";
import { qtyText } from "../helpers/qty-text.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { claimReturnSourceTx, returnWarpingYarnTx } from "./yarn-return";
import { evaluateSettle, settleBlockers } from "./settle";
import { reverseWastesTx, writeWastesTx } from "./waste-write";
import { autoSettleIfDrainedTx, logAutoSettle } from "./auto-settle";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);
const kg3 = (v: number | string | null | undefined) => D(v ?? 0).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
const RETURN_KINDS = [YarnMovementKind.SUBCONTRACT_RETURN, YarnMovementKind.SUBCONTRACT_RETURN_CANCEL];
const LEDGER_SELECT = { id: true, kind: true, qtyKg: true, warehouseId: true, lotId: true, reasonCode: true } as const;

export interface WarpingYarnReturnInput extends ReturnYarnInput {
  /** Kullanılamaz (fire) kg — boş/0 = yalnız iade (bugünkü davranış). */
  wasteKg?: number | null;
  /** Fire gerekçesi — kapanış firesiyle aynı serbest metin, isteğe bağlı. */
  wasteReason?: string | null;
  clientToken?: string;
}

export interface WarpingYarnReturnResult {
  movementId: string;
  dispatchItemId: string;
  dispatchNo: string;
  itemCode: string;
  itemName: string;
  qtyKg: string;
  wasteKg: string;
  /** Bu siparişin bu kalemden iade + fire sonrası tuttuğu kg. */
  holdingKg: string;
  backTransferBatchId: string | null;
  /** Kalan sıfırlandı ve sipariş bu istekte kapandı (replay'de: sipariş şu an kapalı mı). */
  autoClosed: boolean;
  warnings: string[];
  replayed: boolean;
}

/** Gövde özeti — sipariş dahil (replay kimliği: aynı token farklı sipariş/gövde 409). */
export function returnRequestHash(id: string, b: WarpingYarnReturnInput): string {
  const norm = [id, b.dispatchItemId, kg(kg3(b.qtyKg)), kg(kg3(b.wasteKg)), b.reasonCode.trim(), b.warehouseId ?? "", b.lotId ?? "", b.wasteReason?.trim() || ""].join("|");
  return createHash("sha256").update(norm).digest("hex");
}

/** Tek satırlık kapanış planı — fire %/tolerans kapanışla AYNI hesaptan; tavan aşımı iade cümlesiyle. */
async function returnPlanTx(db: Tx, id: string, b: { dispatchItemId: string; qtyKg: Prisma.Decimal; wasteKg: Prisma.Decimal; reasonCode: string }, tolerance: Prisma.Decimal | null) {
  const items = await loadWarpingYarnItems(db, { warpingOrderId: id });
  const it = items.find((i) => i.dispatchItemId === b.dispatchItemId);
  if (!it || it.openKg.lte(0)) throw AppError.notFound("Bu sipariş bu sevk kaleminden iplik tutmuyor.", { code: "WARPING_YARN_NOT_HELD" });
  if (b.qtyKg.plus(b.wasteKg).gt(it.openKg)) {
    const parts = b.wasteKg.gt(0) ? ["İade + fire", ` + fire ${qtyText(b.wasteKg)} kg`] : ["İade", ""];
    throw AppError.badRequest(`${parts[0]}, siparişin deverecide tuttuğu ipliği aşamaz (tutulan ${qtyText(it.openKg)} kg, iade ${qtyText(b.qtyKg)} kg${parts[1]}).`, { code: "YARN_RETURN_EXCEEDS", holdingKg: kg(it.openKg) });
  }
  const ev = await evaluateSettle(db, id, { lines: [{ dispatchItemId: b.dispatchItemId, returnKg: Number(b.qtyKg), wasteKg: Number(b.wasteKg), returnReasonCode: b.reasonCode }] }, tolerance);
  const yarn = ev.plan.yarns.find((y) => y.yarnItemId === it.yarnItemId);
  const others = ev.items.filter((i) => i.dispatchItemId !== it.dispatchItemId).some((i) => i.openKg.gt(0));
  const keep = it.openKg.minus(b.qtyKg).minus(b.wasteKg);
  return { it, ev, yarn, keep, drains: keep.isZero() && !others };
}

const tolWarnings = (w: Prisma.Decimal, warnings: string[]) => (w.gt(0) ? warnings.filter((x) => !x.endsWith("(bilgi).")) : []);

export interface WarpingYarnReturnPreview {
  holdingKg: string; returnKg: string; wasteKg: string; keepKg: string;
  wastePct: string | null; tolerancePct: string | null; overTolerance: boolean;
  /** Kaydedilince sipariş kapanır mı (kalan 0 + kapanış yüklemi). */
  willClose: boolean;
  warnings: string[];
}

// Önizleme yazmaz ve sebebi doğrulamaz; plan yalnız iade satırında sebebin VARLIĞINI ister (yazımda katalog denetlenir).
const PREVIEW_REASON = "PREVIEW";

/** İade(+fire) önizlemesi — yazmaz. */
export async function previewWarpingYarnReturn(id: string, b: { dispatchItemId: string; qtyKg: number; wasteKg?: number | null; reasonCode?: string }): Promise<WarpingYarnReturnPreview> {
  const o = await prisma.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true, wasteTolerancePct: true } });
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const waste = kg3(b.wasteKg);
  const p = await prisma.$transaction((tx) => returnPlanTx(tx, id, { dispatchItemId: b.dispatchItemId, qtyKg: kg3(b.qtyKg), wasteKg: waste, reasonCode: b.reasonCode?.trim() || PREVIEW_REASON }, o.wasteTolerancePct));
  const willClose = p.drains && settleBlockers(o, { liveBeams: p.ev.liveBeams, plan: { ...p.ev.plan, lines: [] } }).length === 0;
  return {
    holdingKg: kg(p.it.openKg), returnKg: kg(kg3(b.qtyKg)), wasteKg: kg(waste), keepKg: kg(p.keep),
    wastePct: p.yarn?.wastePct?.toFixed(2) ?? null, tolerancePct: p.ev.plan.tolerancePct?.toFixed(2) ?? null,
    overTolerance: waste.gt(0) && ((p.yarn?.overTolerance ?? false) || p.ev.plan.overTolerance), willClose, warnings: tolWarnings(waste, p.ev.plan.warnings),
  };
}

function returnReplay(id: string, input: WarpingYarnReturnInput, hash: string) {
  type Hit = { movementId: string; dispatchItemId: string; requestHash: string; open: boolean };
  return tokenReplay<Hit, WarpingYarnReturnResult>({
    find: async (db, clientToken) => {
      const m = await db.yarnMovement.findUnique({
        where: { clientToken },
        select: { ...LEDGER_SELECT, dispatchItemId: true, requestHash: true, dispatchItem: { select: { yarnMovements: { where: { kind: { in: RETURN_KINDS } }, select: LEDGER_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } } },
      });
      if (!m || !m.dispatchItemId || !m.dispatchItem) return null;
      return { movementId: m.id, dispatchItemId: m.dispatchItemId, requestHash: m.requestHash ?? "", open: yarnReturnOpen(m.dispatchItem.yarnMovements, m) };
    },
    alive: (hit) => {
      if (hit.open) return;
      throw AppError.conflict("Bu iade denemesi kaydedilmiş ama sonra İPTAL EDİLMİŞ — yeniden deneme yerine yeni iade yapın.", { code: "YARN_RETURN_CANCELLED" });
    },
    identity: (hit) => [
      { ad: "dispatchItemId", mevcut: hit.dispatchItemId, gelen: input.dispatchItemId },
      { ad: "requestHash", mevcut: hit.requestHash, gelen: hash },
    ],
    collision: "Bu işlem kimliği başka içerikli bir iadeye ait — iade penceresini yeniden açıp gönderin.",
    respond: async (hit) => loadReturnResult(id, hit.movementId, { backTransferBatchId: null, warnings: [], replayed: true }),
  });
}

type ReturnResultExtra = { backTransferBatchId: string | null; warnings: string[]; replayed: boolean; autoClosed?: boolean };

async function loadReturnResult(id: string, movementId: string, extra: ReturnResultExtra): Promise<WarpingYarnReturnResult> {
  const { backTransferBatchId, warnings, replayed, autoClosed } = extra;
  const m = await prisma.yarnMovement.findUniqueOrThrow({
    where: { id: movementId },
    select: { qtyKg: true, dispatchItemId: true, item: { select: { code: true, name: true } }, dispatchItem: { select: { dispatch: { select: { dispatchNo: true } } } }, warpingWastes: { where: { kind: WARPING_WASTE }, select: { qtyKg: true } } },
  });
  const held = (await loadWarpingYarnItems(prisma, { warpingOrderId: id })).find((i) => i.dispatchItemId === m.dispatchItemId)?.openKg ?? D(0);
  const closed = autoClosed ?? (await prisma.warpingOrder.findUnique({ where: { id }, select: { status: true } }))?.status === WarpingOrderStatus.COMPLETED;
  return {
    movementId, dispatchItemId: m.dispatchItemId ?? "", dispatchNo: m.dispatchItem?.dispatch.dispatchNo ?? "", itemCode: m.item.code, itemName: m.item.name,
    qtyKg: kg(D(m.qtyKg)), wasteKg: kg(m.warpingWastes.reduce((s, w) => s.plus(w.qtyKg), D(0))), holdingKg: kg(held),
    backTransferBatchId, autoClosed: closed, warnings, replayed,
  };
}

/** Elle iade (+ fire). Kalan sıfırlanır ve kapanış yüklemi izin verirse sipariş aynı tx'te kapanır. */
export async function returnWarpingYarn(id: string, input: WarpingYarnReturnInput, userId: string): Promise<WarpingYarnReturnResult> {
  const { clientToken } = input;
  const waste = kg3(input.wasteKg);
  if (waste.lt(0)) throw AppError.badRequest("Fire kg negatif olamaz.", { code: "VALIDATION_ERROR" });
  const reason = input.wasteReason?.trim() || null;
  const hash = returnRequestHash(id, input);
  const ret: ReturnYarnInput = {
    dispatchItemId: input.dispatchItemId, qtyKg: input.qtyKg, reasonCode: input.reasonCode, warehouseId: input.warehouseId, lotId: input.lotId,
    token: clientToken ? { clientToken, requestHash: hash } : null,
  };
  return returnReplay(id, input, hash).run(clientToken, async () => {
    const out = await prisma.$transaction(async (tx) => {
      await claimReturnSourceTx(tx, id, userId);
      const o = await tx.warpingOrder.findUniqueOrThrow({ where: { id }, select: { wasteTolerancePct: true } });
      await lockDispatchItemsTx(tx, [ret.dispatchItemId]);
      const p = await returnPlanTx(tx, id, { dispatchItemId: ret.dispatchItemId, qtyKg: kg3(ret.qtyKg), wasteKg: waste, reasonCode: ret.reasonCode }, o.wasteTolerancePct);
      const r = await returnWarpingYarnTx(tx, id, ret, userId);
      const over = (p.yarn?.overTolerance ?? false) || p.ev.plan.overTolerance;
      await writeWastesTx(tx, { src: { returnMovementId: r.r.movementId }, warpingOrderId: id, lines: [{ dispatchItemId: ret.dispatchItemId, qtyKg: waste, overTolerance: over }], reason, userId });
      const auto = await autoSettleIfDrainedTx(tx, id, userId, "YARN_RETURN");
      return { r, auto, over, warnings: tolWarnings(waste, p.ev.plan.warnings) };
    });
    const itemCode = out.r.r.item.yarnItem?.code ?? "";
    const qty = kg(out.r.r.qty);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: out.r.it.dispatchId, newData: { yarnReturned: itemCode, dispatchItemId: ret.dispatchItemId, qtyKg: qty, wasteKg: kg(waste), reasonCode: ret.reasonCode, movementId: out.r.r.movementId, warpingOrderId: id } });
    await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, newData: { yarnReturned: itemCode, movementId: out.r.r.movementId, qtyKg: qty, wasteKg: kg(waste), wasteReason: reason, overTolerance: waste.gt(0) && out.over, backTransferBatchId: out.r.backTransferBatchId } });
    await logAutoSettle(out.auto, userId);
    return loadReturnResult(id, out.r.r.movementId, { backTransferBatchId: out.r.backTransferBatchId, warnings: out.warnings, replayed: false, autoClosed: out.auto !== null });
  });
}

/**
 * İade stornosunun tx gövdesi — iade stornosu + stornoyla kapanan iadelerin canlı FİRESİNE ters satır (aynı tx).
 * Elle storno ve kapanış stornosu (`reopen.ts`) bunu çağırır; eşleme kapının TEK tanımından (`cancelledYarnReturnIds`).
 */
export async function cancelReturnWithWasteTx(tx: Tx, dispatchId: string, input: { dispatchItemId: string; movementId: string; reason: string }, userId: string) {
  const res = await cancelYarnReturnTx(tx, dispatchId, input, userId);
  const ms = await tx.yarnMovement.findMany({ where: { dispatchItemId: input.dispatchItemId, kind: { in: RETURN_KINDS } }, select: LEDGER_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const wastes = await tx.warpingYarnWaste.findMany({
    where: { returnMovementId: { in: [...cancelledYarnReturnIds(ms)] }, kind: WARPING_WASTE, reversal: null },
    select: { id: true, dispatchItemId: true, qtyKg: true, warpingOrderId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  await reverseWastesTx(tx, { src: { returnMovementId: res.movementId }, wastes, reason: input.reason, userId });
  return { ...res, wasteCancelledKg: wastes.reduce((s, w) => s.plus(w.qtyKg), D(0)) };
}

/** İade stornosu — dönen iplik kalemin KENDİ siparişinin tutmasına döner; iadeyle yazılan fire de geri alınır. */
export async function cancelWarpingYarnReturn(id: string, movementId: string, reason: string, userId: string) {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
  const m = await prisma.yarnMovement.findUnique({
    where: { id: movementId },
    select: { id: true, dispatchItemId: true, dispatchItem: { select: { dispatchId: true, dispatch: { select: { warpingOrderId: true } }, warpingYarnTransfers: { where: { OR: [{ fromWarpingOrderId: id }, { toWarpingOrderId: id }] }, select: { id: true }, take: 1 } } } },
  });
  const item = m?.dispatchItem;
  const related = item && item.dispatch.warpingOrderId !== null && (item.dispatch.warpingOrderId === id || item.warpingYarnTransfers.length > 0);
  if (!m || !item || !related) throw AppError.notFound("Bu siparişte böyle bir iade satırı yok.", { code: "YARN_RETURN_NOT_FOUND" });
  const input = { dispatchItemId: m.dispatchItemId!, movementId, reason: why };
  const res = await prisma.$transaction((tx) => cancelReturnWithWasteTx(tx, item.dispatchId, input, userId));
  const itemCode = res.item.yarnItem?.code ?? "";
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: item.dispatchId, newData: { yarnReturnCancelled: itemCode, dispatchItemId: input.dispatchItemId, reversesMovementId: movementId, qtyKg: kg(res.qty), wasteCancelledKg: kg(res.wasteCancelledKg), reason: why, movementId: res.movementId, warpingOrderId: id } });
  return {
    movementId: res.movementId, dispatchItemId: input.dispatchItemId, dispatchNo: res.item.dispatch.dispatchNo, itemCode,
    qtyKg: Number(res.qty), remainingKg: Number(res.remainingKg), wasteCancelledKg: kg(res.wasteCancelledKg),
  };
}
