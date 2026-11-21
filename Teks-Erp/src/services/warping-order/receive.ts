// =============================================================================
// FASON DEVERE SİPARİŞİ — devereciden DÖNEN LEVENT KABULÜ + önizlemesi (D5a)
// =============================================================================
// Tek tx, N levent: sipariş CLAIM'i İLK ifade (`OPEN|IN_PROGRESS → IN_PROGRESS`; sevk/iade/aktarma/storno aynı satırda
// sıraya girer) → dağıtım adayı kalemler `FOR UPDATE` `id` sırasıyla → kilitten sonra TAZE adaylar → satırlar SIRAYLA:
// levent doğar (SUBCONTRACT, `warpingOrderId`, kabul anahtarı) → WOUND (`kgSource = THEORETICAL`; tartı yalnız saklanır)
// → kırılım (siparişin DONMUŞ planından tel/denye; kg = tel × denye × metre / 9e6) → dağıtım (`wound-allocation.helper`).
// Kg HESAPTAN (kullanıcı kararı 2026-11-17); adet/boy plandan farklı olabilir, levent boyları satır satır farklı olabilir.
// Token ilk leventin WOUND'unda (raşel takımı kalıbı). Stornosu `receive-cancel.ts` (LIFO). Satır yazıcısı tx-içi
// çekirdek `receiveOrderLinesTx`; çok siparişli dönüş kabul belgesi (E1) `receive-doc.ts` aynı çekirdeği çağırır.
// =============================================================================
import { Prisma, WarpBeamStatus, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { tokenReplay } from "../helpers/token-replay.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { type AllocationCandidate } from "../helpers/wound-allocation.helper";
import { loadWarpingSettlement, type WarpingSettlement } from "../helpers/warping-settlement.helper";
import { loadWarpingReceipt, type WarpingReceiptDto } from "./receipts";
import { planReceiveReworks, reworkReplaySig, type ReceiveReworkRef } from "./receive-rework";
import { bodyTareWarnings, planReceiveBodies } from "./receive-body";
import { assertReceiveWeighing, deliveryNoteVerdict, lockDeliveryNoteTx, normalizeDeliveryNoteNo } from "./receive-note";
import { readDevereDuplicateDeliveryNote, readDevereReceiveWeighing } from "../system-setting/devere-receive";
import { claimForReceiveTx, auditReceiveOrder, bodyDto, evaluate, inputBeamSig, loadOrderForReceive, normalizeReceiveBeams, notReceivable, planBeams, receiveOrderLinesTx, RECEIVABLE, storedBeamSig, tareLines, weighWarnings, type NeedKey, type WarpingReceiveInput, type ReceiveBodyDto } from "./receive-core";
export { WARPING_RECEIVE_MAX_BEAMS, normalizeReceiveBeams, type WarpingReceiveBeamInput, type WarpingReceiveInput, type ReceiveBodyDto } from "./receive-core";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg3 = (v: Prisma.Decimal) => v.toFixed(3);

// ── Önizleme ─────────────────────────────────────────────────────────────────

export interface WarpingReceivePreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus; subcontractorId: string };
  beams: Array<{ index: number; lengthM: string; nominalKg: string; weighedNetKg: string | null; body: ReceiveBodyDto | null; reworkOf: ReceiveReworkRef | null; yarns: Array<{ yarnItemId: string; code: string; name: string; kg: string }> }>;
  allocations: Array<{ beamIndex: number; yarnItemId: string; dispatchItemId: string; dispatchNo: string; lotNo: string | null; holderWarpingOrderId: string; holderOrderNo: string | null; carryOver: boolean; kg: string }>;
  incoming: { beamCount: number; lengthM: string };
  /** Kabulden ÖNCEKİ mutabakat — panel gelenle yan yana koyar (istemci sayı türetmez: `incoming` + `after` hazır). */
  before: WarpingSettlement;
  after: { receivedM: string; diffM: string; yarns: Array<{ yarnItemId: string; woundKg: string; unallocatedKg: string }> };
  ownerCustomerId: string | null;
  warnings: string[];
}

const allocDto = (rows: Array<{ key: NeedKey; candidate: AllocationCandidate; kg: Prisma.Decimal }>) => rows.map((r) => ({
  beamIndex: r.key.beam, yarnItemId: r.key.yarnItemId, dispatchItemId: r.candidate.dispatchItemId, dispatchNo: r.candidate.dispatchNo, lotNo: r.candidate.lotNo,
  holderWarpingOrderId: r.candidate.holderWarpingOrderId, holderOrderNo: r.candidate.holderOrderNo, carryOver: r.candidate.carryOver, kg: kg3(r.kg),
}));

/** `noteCheck:false` → belge önizlemesi irsaliye tekrarını bir kez kendisi ölçer (sipariş başına tekrarlamaz). */
export async function previewWarpingReceive(id: string, input: Omit<WarpingReceiveInput, "clientToken">, opts: { noteCheck: boolean } = { noteCheck: true }): Promise<WarpingReceivePreview> {
  const lines = normalizeReceiveBeams(input.beams);
  assertReceiveWeighing(input.beams, await readDevereReceiveWeighing());
  const order = await loadOrderForReceive(prisma, id);
  if (!RECEIVABLE.includes(order.status)) throw notReceivable(order);
  const note = opts.noteCheck
    ? await deliveryNoteVerdict(prisma, { subcontractorId: order.subcontractorId, deliveryNoteNo: normalizeDeliveryNoteNo(input.deliveryNoteNo), mode: await readDevereDuplicateDeliveryNote(), enforce: false })
    : { warnings: [] };
  const beams = planBeams(lines, order.planYarns);
  const ev = await evaluate(prisma, order, beams);
  const bodies = await planReceiveBodies(prisma, { lines: input.beams, subcontractorId: order.subcontractorId, lotOwnerCustomerId: ev.ownerCustomerId });
  const reworks = await planReceiveReworks(prisma, { warpingOrderId: id, lines: input.beams, lock: false });
  const before = await loadWarpingSettlement(prisma, id);
  const incomingM = beams.reduce((s, b) => s.plus(b.lengthM), D(0));
  const receivedAfter = D(before.metre.receivedM).plus(incomingM);
  return {
    order: { id: order.id, orderNo: order.orderNo, status: order.status, subcontractorId: order.subcontractorId },
    beams: beams.map((b) => ({
      index: b.idx, lengthM: kg3(b.lengthM), nominalKg: kg3(b.yarns.reduce((s, y) => s.plus(y.kg), D(0))),
      weighedNetKg: b.grossKg && b.tareKg ? kg3(b.grossKg.minus(b.tareKg)) : null,
      body: bodyDto(bodies[b.idx] ?? null),
      reworkOf: reworks[b.idx] ?? null,
      yarns: b.yarns.map((y) => {
        const p = order.planYarns.find((x) => x.yarnItemId === y.yarnItemId)!;
        return { yarnItemId: y.yarnItemId, code: p.code, name: p.name, kg: kg3(y.kg) };
      }),
    })),
    allocations: allocDto(ev.alloc.rows),
    incoming: { beamCount: beams.length, lengthM: kg3(incomingM) },
    before,
    after: {
      receivedM: kg3(receivedAfter), diffM: kg3(receivedAfter.minus(before.metre.targetM)),
      yarns: before.yarns.map((y) => {
        const add = beams.reduce((s, b) => s.plus(b.yarns.find((x) => x.yarnItemId === y.yarnItemId)?.kg ?? 0), D(0));
        return { yarnItemId: y.yarnItemId, woundKg: kg3(D(y.woundKg).plus(add)), unallocatedKg: kg3(D(y.unallocatedKg).plus(ev.alloc.unallocated.get(y.yarnItemId) ?? 0)) };
      }),
    },
    ownerCustomerId: ev.ownerCustomerId,
    warnings: [...note.warnings, ...ev.warnings, ...weighWarnings(beams), ...bodyTareWarnings(tareLines(beams), bodies)],
  };
}

// ── Kabul ────────────────────────────────────────────────────────────────────

function receiveReplay(id: string, input: WarpingReceiveInput) {
  type Hit = { warpingOrderId: string; receiptKey: string; deliveryNoteNo: string; beams: string; reworks: string; dead: string | null };
  return tokenReplay<Hit, WarpingReceiptDto & { replayed: boolean }>({
    find: async (db, clientToken) => {
      const ev = await db.warpBeamEvent.findUnique({ where: { clientToken }, select: { beam: { select: { warpingOrderId: true, warpingReceiptKey: true } } } });
      if (!ev) return null;
      const key = ev.beam.warpingReceiptKey ?? "";
      const beams = await sequentialTx(db).warpBeam.findMany({
        where: { warpingReceiptKey: key },
        select: { beamNo: true, status: true, physicalBeamNo: true, beamBodyId: true, reworkOfBeamId: true, events: { where: { kind: "WOUND" }, select: { lengthM: true, grossKg: true, tareKg: true, deliveryNoteNo: true } } },
        orderBy: { beamNo: "asc" },
      });
      const dead = beams.find((b) => b.status === WarpBeamStatus.CANCELLED)?.beamNo ?? null;
      return {
        warpingOrderId: ev.beam.warpingOrderId ?? "", receiptKey: key, deliveryNoteNo: beams[0]?.events[0]?.deliveryNoteNo ?? "", dead, reworks: reworkReplaySig(beams.map((b) => b.reworkOfBeamId)),
        beams: storedBeamSig(beams),
      };
    },
    alive: (hit) => {
      if (!hit.dead) return;
      throw AppError.conflict(`Bu kabul denemesi kaydedilmiş ama sonra levent dönüşü İPTAL edilmiş (${hit.dead}) — yeniden deneme yerine yeni kabul açın.`, { code: "WARP_BEAM_CANCELLED" });
    },
    identity: (hit) => [
      { ad: "warpingOrderId", mevcut: hit.warpingOrderId, gelen: id },
      { ad: "deliveryNoteNo", mevcut: hit.deliveryNoteNo, gelen: input.deliveryNoteNo?.trim() ?? "" },
      { ad: "beams", mevcut: hit.beams, gelen: inputBeamSig(input.beams) },
      { ad: "reworkOfBeamIds", mevcut: hit.reworks, gelen: reworkReplaySig(input.beams.map((b) => b.reworkOfBeamId)) },
    ],
    collision: "Bu işlem kimliği başka içerikli bir levent kabulüne ait — formu yeniden açıp gönderin.",
    respond: async (hit) => ({ ...(await loadWarpingReceipt(prisma, id, hit.receiptKey)), replayed: true }),
  });
}

export async function receiveWarpingOrder(id: string, input: WarpingReceiveInput, userId: string): Promise<WarpingReceiptDto & { replayed: boolean }> {
  normalizeReceiveBeams(input.beams);
  const deliveryNoteNo = normalizeDeliveryNoteNo(input.deliveryNoteNo);
  return receiveReplay(id, input).run(input.clientToken, async () => {
    // E1: tartı kipi ve irsaliye tekrarı (varsayılan OPTIONAL/WARN = eski davranış + bilgi uyarısı).
    assertReceiveWeighing(input.beams, await readDevereReceiveWeighing());
    const noteMode = await readDevereDuplicateDeliveryNote();
    const out = await prisma.$transaction(async (tx) => {
      await lockDeliveryNoteTx(tx, deliveryNoteNo);
      const { order, wasOpen } = await claimForReceiveTx(tx, id, userId);
      const note = await deliveryNoteVerdict(tx, { subcontractorId: order.subcontractorId, deliveryNoteNo, mode: noteMode, enforce: true });
      const lines = await receiveOrderLinesTx(tx, { order, wasOpen, beams: input.beams, deliveryNoteNo, clientToken: input.clientToken ?? null, receiveDocId: null, userId });
      return { ...lines, warnings: [...note.warnings, ...lines.warnings] };
    });
    await auditReceiveOrder(userId, out, deliveryNoteNo, null);
    const dto = await loadWarpingReceipt(prisma, id, out.receiptKey);
    return { ...dto, warnings: [...dto.warnings, ...out.warnings], replayed: false };
  });
}
