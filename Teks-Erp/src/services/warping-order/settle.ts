// =============================================================================
// FASON DEVERE SİPARİŞİ — KAPANIŞ (D5b): kalan iplik kalem kalem İADE / FİRE / DEVERECİDE KALIR
// =============================================================================
// Tek tx: sipariş CLAIM'i İLK ifade (`IN_PROGRESS → COMPLETED`; kabul/sevk/iade/aktarma aynı satırda sıraya girer) →
// tutulan kalemler `FOR UPDATE` `id` sırasıyla → kilitten sonra TAZE tutma → plan (`warping-settle-plan.helper`) →
// iadeler (`returnWarpingYarnTx`, lot korunur) → kapanış defteri satırı (SETTLE) → fire satırları (WASTE).
// "Deverecide kalır" için kayıt yazılmaz: tutma COMPLETED siparişte açık kalır ve sonraki siparişe DEVREDER.
// Tolerans aşımı yalnız UYARIR, gerekçe isteğe bağlı (kullanıcı kararı 2026-11-17). Stornosu `reopen.ts`.
// =============================================================================
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { loadWarpingYarnItems, lockDispatchItemsTx, WARPING_WASTE } from "../helpers/warping-yarn-open.helper";
import { loadWarpingSettlement } from "../helpers/warping-settlement.helper";
import { buildSettlePlan, settlePlanDto, settleRequestHash, type SettlePlan, type WarpingSettleBody } from "../helpers/warping-settle-plan.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { loadSettlementRecord, WARPING_SETTLE, type WarpingSettlementRecord } from "./settle-record";
import { returnWarpingYarnTx } from "./yarn-return";

type Tx = Prisma.TransactionClient;
const kg = (v: Prisma.Decimal) => v.toFixed(3);

export interface WarpingSettleInput extends WarpingSettleBody { clientToken?: string }

async function orderHead(db: Pick<Tx, "warpingOrder">, id: string) {
  const o = await db.warpingOrder.findUnique({ where: { id }, select: { id: true, orderNo: true, status: true, wasteTolerancePct: true } });
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  return o;
}

const notSettleable = (o: { orderNo: string; status: WarpingOrderStatus }) =>
  AppError.conflict(
    o.status === WarpingOrderStatus.COMPLETED ? `${o.orderNo} zaten kapanmış.` : `${o.orderNo} durumu ${o.status} — yalnız devam eden (IN_PROGRESS) sipariş kapatılır.`,
    { code: o.status === WarpingOrderStatus.COMPLETED ? "WARPING_ORDER_COMPLETED" : "WARPING_ORDER_NOT_SETTLEABLE", status: o.status },
  );

/** Planın girdileri — TAZE tutma + plan satırları + sarılan nominal (aynı tx ya da kök istemci). */
async function evaluate(db: Tx, id: string, body: WarpingSettleBody, tolerance: Prisma.Decimal | null) {
  const items = await loadWarpingYarnItems(db, { warpingOrderId: id });
  const st = await loadWarpingSettlement(db, id);
  const yarns = st.yarns.map((y) => ({ yarnItemId: y.yarnItemId, code: y.code, netKg: y.planNetKg, grossKg: y.planGrossKg, woundKg: y.woundKg, unallocatedKg: y.unallocatedKg }));
  const plan = buildSettlePlan(items, yarns, body, tolerance);
  return { items, settlement: st, plan, liveBeams: st.metre.receivedBeamCount };
}

const emptyBlocker = (liveBeams: number, plan: SettlePlan) =>
  liveBeams === 0 && plan.lines.length === 0 ? "Siparişte dönen levent de deverecide iplik de yok — kapatılamaz; sevk/dönüş yoksa siparişi iptal edin." : null;

export interface WarpingSettlePreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus };
  canSettle: boolean;
  blockers: string[];
  plan: ReturnType<typeof settlePlanDto>;
  settlement: Awaited<ReturnType<typeof loadWarpingSettlement>>;
  warnings: string[];
}

/** Kapanış önizlemesi — gövdesiz = varsayılan A1-a; gövdeli = kullanıcının bölüşümü. Yazmaz. */
export async function previewSettleWarpingOrder(id: string, body: WarpingSettleBody = {}): Promise<WarpingSettlePreview> {
  const o = await orderHead(prisma, id);
  const ev = await prisma.$transaction(async (tx) => evaluate(tx, id, body, o.wasteTolerancePct));
  const blockers: string[] = [];
  if (o.status !== WarpingOrderStatus.IN_PROGRESS) blockers.push(notSettleable(o).message);
  const empty = emptyBlocker(ev.liveBeams, ev.plan);
  if (empty) blockers.push(empty);
  return { order: { id: o.id, orderNo: o.orderNo, status: o.status }, canSettle: blockers.length === 0, blockers, plan: settlePlanDto(ev.plan), settlement: ev.settlement, warnings: ev.plan.warnings };
}

function settleReplay(id: string, hash: string) {
  type Hit = { warpingOrderId: string; settlementId: string; requestHash: string; reopened: boolean };
  return tokenReplay<Hit, WarpingSettlementRecord & { warnings: string[]; replayed: boolean }>({
    find: async (db, clientToken) => {
      const s = await db.warpingOrderSettlement.findUnique({ where: { clientToken }, select: { id: true, warpingOrderId: true, requestHash: true, reversal: { select: { id: true } } } });
      return s ? { warpingOrderId: s.warpingOrderId, settlementId: s.id, requestHash: s.requestHash ?? "", reopened: s.reversal !== null } : null;
    },
    alive: (hit) => {
      if (!hit.reopened) return;
      throw AppError.conflict("Bu kapanış denemesi kaydedilmiş ama sipariş sonra YENİDEN AÇILMIŞ — yeniden deneme yerine yeni kapanış yapın.", { code: "WARPING_SETTLEMENT_REOPENED" });
    },
    identity: (hit) => [
      { ad: "warpingOrderId", mevcut: hit.warpingOrderId, gelen: id },
      { ad: "requestHash", mevcut: hit.requestHash, gelen: hash },
    ],
    collision: "Bu işlem kimliği başka içerikli bir kapanışa ait — kapanış formunu yeniden açıp gönderin.",
    respond: async (hit) => ({ ...(await loadSettlementRecord(prisma, hit.settlementId)), warnings: [], replayed: true }),
  });
}

async function claimForSettleTx(tx: Tx, id: string, userId: string): Promise<void> {
  const claim = await tx.warpingOrder.updateMany({
    where: { id, status: WarpingOrderStatus.IN_PROGRESS },
    data: { status: WarpingOrderStatus.COMPLETED, completedAt: new Date(), completedById: userId, updatedById: userId },
  });
  if (claim.count === 0) throw notSettleable(await orderHead(tx, id));
}

/** Kapanış: iade + fire + kalır; sipariş COMPLETED. */
export async function settleWarpingOrder(id: string, input: WarpingSettleInput, userId: string): Promise<WarpingSettlementRecord & { warnings: string[]; replayed: boolean }> {
  const { clientToken, ...body } = input;
  const reason = body.reason?.trim() || null;
  const hash = settleRequestHash(body);
  return settleReplay(id, hash).run(clientToken, async () => {
    const out = await prisma.$transaction(async (tx) => {
      await claimForSettleTx(tx, id, userId);
      const o = await orderHead(tx, id);
      const pre = await loadWarpingYarnItems(tx, { warpingOrderId: id });
      await lockDispatchItemsTx(tx, pre.map((i) => i.dispatchItemId));
      // Kilitten sonra TAZE: eşzamanlı kabul/iade/devir dağıtımı tutmayı değiştirmiş olabilir.
      const ev = await evaluate(tx, id, body, o.wasteTolerancePct);
      const empty = emptyBlocker(ev.liveBeams, ev.plan);
      if (empty) throw AppError.conflict(empty, { code: "WARPING_SETTLE_EMPTY" });
      const returnMovementIds: string[] = [];
      const backTransferIds: string[] = [];
      for (const l of ev.plan.lines.filter((x) => x.returnKg.gt(0))) {
        const r = await returnWarpingYarnTx(tx, id, { dispatchItemId: l.dispatchItemId, qtyKg: l.returnKg.toFixed(3), reasonCode: l.returnReasonCode!, warehouseId: l.warehouseId }, userId);
        returnMovementIds.push(r.r.movementId);
        if (r.backTransferId) backTransferIds.push(r.backTransferId);
      }
      const s = await tx.warpingOrderSettlement.create({
        data: {
          warpingOrderId: id, kind: WARPING_SETTLE, clientToken: clientToken ?? null, requestHash: hash, reason,
          wastePct: ev.plan.wastePct, tolerancePct: ev.plan.tolerancePct, overTolerance: ev.plan.overTolerance,
          returnMovementIds, backTransferIds, createdById: userId,
        },
        select: { id: true },
      });
      const overByYarn = new Map(ev.plan.yarns.map((y) => [y.yarnItemId, y.overTolerance]));
      const wastes = ev.plan.lines.filter((x) => x.wasteKg.gt(0));
      if (wastes.length > 0) {
        await tx.warpingYarnWaste.createMany({
          data: wastes.map((l) => ({
            settlementId: s.id, warpingOrderId: id, dispatchItemId: l.dispatchItemId, kind: WARPING_WASTE, qtyKg: l.wasteKg,
            overTolerance: (overByYarn.get(l.yarnItemId) ?? false) || ev.plan.overTolerance, reason, createdById: userId,
          })),
        });
      }
      return { settlementId: s.id, plan: ev.plan, beams: ev.settlement.metre.receivedBeamCount };
    });
    const p = out.plan;
    const sum = (f: (l: SettlePlan["lines"][number]) => Prisma.Decimal) => kg(p.lines.reduce((a, l) => a.plus(f(l)), new Prisma.Decimal(0)));
    await AuditService.log({
      userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id,
      oldData: { status: WarpingOrderStatus.IN_PROGRESS },
      newData: { status: WarpingOrderStatus.COMPLETED, settlementId: out.settlementId, returnKg: sum((l) => l.returnKg), wasteKg: sum((l) => l.wasteKg), keepKg: sum((l) => l.keepKg), wastePct: p.wastePct?.toFixed(2) ?? null, overTolerance: p.overTolerance, reason, defaultSplit: p.isDefault },
    });
    const rec = await loadSettlementRecord(prisma, out.settlementId);
    const dispatchOf = new Map(p.lines.map((l) => [l.dispatchItemId, l.dispatchId]));
    for (const r of rec.returns) {
      await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: dispatchOf.get(r.dispatchItemId ?? "") ?? id, newData: { yarnReturned: r.yarnItemId, movementId: r.movementId, qtyKg: r.qtyKg, warpingOrderId: id, settlementId: out.settlementId } });
    }
    return { ...rec, warnings: p.warnings, replayed: false };
  });
}
