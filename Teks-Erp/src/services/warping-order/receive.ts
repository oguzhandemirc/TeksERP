// =============================================================================
// FASON DEVERE SİPARİŞİ — devereciden DÖNEN LEVENT KABULÜ + önizlemesi (D5a)
// =============================================================================
// Tek tx, N levent: sipariş CLAIM'i İLK ifade (`OPEN|IN_PROGRESS → IN_PROGRESS`; sevk/iade/aktarma/storno aynı satırda
// sıraya girer) → dağıtım adayı kalemler `FOR UPDATE` `id` sırasıyla → kilitten sonra TAZE adaylar → satırlar SIRAYLA:
// levent doğar (SUBCONTRACT, `warpingOrderId`, kabul anahtarı) → WOUND (`kgSource = THEORETICAL`; tartı yalnız saklanır)
// → kırılım (siparişin DONMUŞ planından tel/denye; kg = tel × denye × metre / 9e6) → dağıtım (`wound-allocation.helper`).
// Kg HESAPTAN (kullanıcı kararı 2026-11-17); adet/boy plandan farklı olabilir, levent boyları satır satır farklı olabilir.
// Token ilk leventin WOUND'unda (raşel takımı kalıbı). Stornosu `receive-cancel.ts` (LIFO).
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { warpTheoreticalKg } from "../../constants/warp-beam";
import { tokenReplay } from "../helpers/token-replay.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { nextBeamNoTx } from "../helpers/warp-beam.helper";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { assertPhysicalBeamFreeTx } from "../helpers/warp-beam-set.helper";
import { lockDispatchItemsTx } from "../helpers/warping-yarn-open.helper";
import { writeWarpingWoundYarnsTx } from "../helpers/warping-receipt-guard.helper";
import { allocateWoundYarn, loadAllocationCandidates, type AllocationCandidate } from "../helpers/wound-allocation.helper";
import { loadWarpingSettlement, type WarpingSettlement } from "../helpers/warping-settlement.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { loadWarpingReceipt, type WarpingReceiptDto } from "./receipts";
import { qtyText } from "../helpers/qty-text.helper";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg3 = (v: Prisma.Decimal) => v.toFixed(3);
export const WARPING_RECEIVE_MAX_BEAMS = 50;
const RECEIVABLE: WarpingOrderStatus[] = [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS];

export interface WarpingReceiveBeamInput {
  lengthM: number;
  physicalBeamNo?: string | null;
  /** İsteğe bağlı tartı — saklanır, tüketimi/bakiyeyi DEĞİŞTİRMEZ (fark raporlanır). */
  grossKg?: number | null;
  tareKg?: number | null;
}
export interface WarpingReceiveInput {
  clientToken?: string;
  deliveryNoteNo?: string | null;
  beams: WarpingReceiveBeamInput[];
}

interface PlanYarn { yarnItemId: string; code: string; name: string; endsCount: number; denier: Prisma.Decimal }
interface BeamPlan { idx: number; lengthM: Prisma.Decimal; physicalBeamNo: string | null; grossKg: Prisma.Decimal | null; tareKg: Prisma.Decimal | null; yarns: Array<{ yarnItemId: string; endsCount: number; denier: Prisma.Decimal; kg: Prisma.Decimal }> }

const dec3 = (v: number, ad: string, min: "pos" | "nonneg") => {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || (min === "pos" ? d.lte(0) : d.lt(0))) throw AppError.badRequest(`${ad} ${min === "pos" ? "sıfırdan büyük" : "negatif olmayan"} olmalı`);
  return d;
};

/** Gövde kapıları (DB'siz): satır sayısı, metre, tartı tutarlılığı, aynı kabulde tekrar eden gövde no. */
export function normalizeReceiveBeams(beams: WarpingReceiveBeamInput[]): Array<Omit<BeamPlan, "yarns">> {
  if (beams.length === 0) throw AppError.badRequest("Kabulde en az bir levent satırı olmalı.", { code: "WARPING_RECEIVE_EMPTY" });
  if (beams.length > WARPING_RECEIVE_MAX_BEAMS) throw AppError.badRequest(`Bir kabulde en çok ${WARPING_RECEIVE_MAX_BEAMS} levent olabilir.`);
  const seen = new Set<string>();
  return beams.map((b, idx) => {
    const physicalBeamNo = b.physicalBeamNo?.trim() || null;
    if (physicalBeamNo) {
      if (seen.has(physicalBeamNo)) throw AppError.badRequest(`"${physicalBeamNo}" gövde numarası bu kabulde iki kez yazılmış.`, { code: "WARPING_RECEIVE_DUPLICATE_PHYSICAL" });
      seen.add(physicalBeamNo);
    }
    const grossKg = b.grossKg == null ? null : dec3(b.grossKg, "Brüt kg", "pos");
    const tareKg = b.tareKg == null ? null : dec3(b.tareKg, "Dara kg", "nonneg");
    if (tareKg && !grossKg) throw AppError.badRequest(`${idx + 1}. satır: dara yazıldıysa brüt kg da yazılmalı.`, { code: "WARPING_RECEIVE_TARE_WITHOUT_GROSS" });
    if (tareKg && grossKg && tareKg.gte(grossKg)) throw AppError.badRequest(`${idx + 1}. satır: dara (${qtyText(tareKg)} kg) brütten (${qtyText(grossKg)} kg) küçük olmalı.`, { code: "WARPING_RECEIVE_TARE_EXCEEDS" });
    return { idx, lengthM: dec3(b.lengthM, `${idx + 1}. satır metre`, "pos"), physicalBeamNo, grossKg, tareKg };
  });
}

/** Levent başına kırılım — siparişin DONMUŞ planından (kart sonradan değişse de dönüş planla hesaplanır, S23). */
function planBeams(lines: Array<Omit<BeamPlan, "yarns">>, yarns: PlanYarn[]): BeamPlan[] {
  return lines.map((l) => ({ ...l, yarns: yarns.map((y) => ({ yarnItemId: y.yarnItemId, endsCount: y.endsCount, denier: y.denier, kg: warpTheoreticalKg(y.endsCount, y.denier, l.lengthM) })) }));
}

async function loadOrderForReceive(db: Tx | typeof prisma, id: string) {
  const o = await sequentialTx(db).warpingOrder.findUnique({
    where: { id },
    select: { id: true, orderNo: true, status: true, subcontractorId: true, warpSpecId: true, yarns: { select: { yarnItemId: true, endsCount: true, denier: true, yarnItem: { select: { code: true, name: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  return { ...o, planYarns: o.yarns.map((y): PlanYarn => ({ yarnItemId: y.yarnItemId, code: y.yarnItem.code, name: y.yarnItem.name, endsCount: y.endsCount, denier: D(y.denier) })) };
}

type NeedKey = { beam: number; yarnItemId: string };

/** Adaylar + dağıtım (saf hesap; kabul ve önizleme aynı). */
async function evaluate(db: Tx | typeof prisma, order: Awaited<ReturnType<typeof loadOrderForReceive>>, beams: BeamPlan[]) {
  const { candidates, ownerCustomerId } = await loadAllocationCandidates(db, { id: order.id, subcontractorId: order.subcontractorId, yarnItemIds: order.planYarns.map((y) => y.yarnItemId) });
  const needs = beams.flatMap((b) => b.yarns.map((y) => ({ key: { beam: b.idx, yarnItemId: y.yarnItemId } as NeedKey, yarnItemId: y.yarnItemId, kg: y.kg })));
  const alloc = allocateWoundYarn(needs, candidates);
  const codeOf = (y: string) => { const p = order.planYarns.find((x) => x.yarnItemId === y); return p?.name || p?.code || y; };
  const warnings: string[] = [];
  for (const [y, rest] of alloc.unallocated) {
    warnings.push(`${codeOf(y)}: nominal tüketim deverecideki iplikten ${qtyText(rest)} kg fazla — tel/denye/metre ya da eksik sevk kaydını kontrol edin (fazlası dağıtılmadı, bakiye eksiye inmez).`);
  }
  return { candidates, ownerCustomerId, alloc, warnings };
}

function weighWarnings(beams: BeamPlan[]): string[] {
  const out: string[] = [];
  for (const b of beams) {
    if (!b.grossKg || !b.tareKg) continue;
    const net = b.grossKg.minus(b.tareKg);
    const nominal = b.yarns.reduce((s, y) => s.plus(y.kg), D(0));
    const diff = net.minus(nominal);
    if (!diff.isZero()) out.push(`${b.idx + 1}. levent: tartı net ${qtyText(net)} kg, hesap ${qtyText(nominal)} kg — fark ${diff.gt(0) ? "+" : ""}${qtyText(diff)} kg (bilgi; tüketim hesaptan).`);
  }
  return out;
}

// ── Önizleme ─────────────────────────────────────────────────────────────────

export interface WarpingReceivePreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus };
  beams: Array<{ index: number; lengthM: string; nominalKg: string; weighedNetKg: string | null; yarns: Array<{ yarnItemId: string; code: string; name: string; kg: string }> }>;
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

export async function previewWarpingReceive(id: string, input: Omit<WarpingReceiveInput, "clientToken">): Promise<WarpingReceivePreview> {
  const lines = normalizeReceiveBeams(input.beams);
  const order = await loadOrderForReceive(prisma, id);
  if (!RECEIVABLE.includes(order.status)) throw notReceivable(order);
  const beams = planBeams(lines, order.planYarns);
  const ev = await evaluate(prisma, order, beams);
  const before = await loadWarpingSettlement(prisma, id);
  const incomingM = beams.reduce((s, b) => s.plus(b.lengthM), D(0));
  const receivedAfter = D(before.metre.receivedM).plus(incomingM);
  return {
    order: { id: order.id, orderNo: order.orderNo, status: order.status },
    beams: beams.map((b) => ({
      index: b.idx, lengthM: kg3(b.lengthM), nominalKg: kg3(b.yarns.reduce((s, y) => s.plus(y.kg), D(0))),
      weighedNetKg: b.grossKg && b.tareKg ? kg3(b.grossKg.minus(b.tareKg)) : null,
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
    warnings: [...ev.warnings, ...weighWarnings(beams)],
  };
}

function notReceivable(o: { orderNo: string; status: WarpingOrderStatus }) {
  const hint = o.status === WarpingOrderStatus.COMPLETED ? " — kapanmış siparişe levent kabulü için önce siparişi yeniden açın." : ".";
  return AppError.conflict(`${o.orderNo} durumu ${o.status} — levent kabulü yapılamaz${hint}`, { code: "WARPING_ORDER_NOT_RECEIVABLE", status: o.status });
}

// ── Kabul ────────────────────────────────────────────────────────────────────

const beamSig = (rows: Array<{ lengthM: Prisma.Decimal.Value; physicalBeamNo: string | null; grossKg: Prisma.Decimal.Value | null; tareKg: Prisma.Decimal.Value | null }>) =>
  rows.map((r) => `${D(r.lengthM).toFixed(3)}|${r.physicalBeamNo ?? ""}|${r.grossKg === null ? "" : D(r.grossKg).toFixed(3)}|${r.tareKg === null ? "" : D(r.tareKg).toFixed(3)}`).join(",");

function receiveReplay(id: string, input: WarpingReceiveInput) {
  type Hit = { warpingOrderId: string; receiptKey: string; deliveryNoteNo: string; beams: string; dead: string | null };
  return tokenReplay<Hit, WarpingReceiptDto & { replayed: boolean }>({
    find: async (db, clientToken) => {
      const ev = await db.warpBeamEvent.findUnique({ where: { clientToken }, select: { beam: { select: { warpingOrderId: true, warpingReceiptKey: true } } } });
      if (!ev) return null;
      const key = ev.beam.warpingReceiptKey ?? "";
      const beams = await sequentialTx(db).warpBeam.findMany({
        where: { warpingReceiptKey: key },
        select: { beamNo: true, status: true, physicalBeamNo: true, events: { where: { kind: "WOUND" }, select: { lengthM: true, grossKg: true, tareKg: true, deliveryNoteNo: true } } },
        orderBy: { beamNo: "asc" },
      });
      const dead = beams.find((b) => b.status === WarpBeamStatus.CANCELLED)?.beamNo ?? null;
      return {
        warpingOrderId: ev.beam.warpingOrderId ?? "", receiptKey: key, deliveryNoteNo: beams[0]?.events[0]?.deliveryNoteNo ?? "", dead,
        beams: beamSig(beams.map((b) => ({ lengthM: b.events[0]?.lengthM ?? 0, physicalBeamNo: b.physicalBeamNo, grossKg: b.events[0]?.grossKg ?? null, tareKg: b.events[0]?.tareKg ?? null }))),
      };
    },
    alive: (hit) => {
      if (!hit.dead) return;
      throw AppError.conflict(`Bu kabul denemesi kaydedilmiş ama sonra levent dönüşü İPTAL edilmiş (${hit.dead}) — yeniden deneme yerine yeni kabul açın.`, { code: "WARP_BEAM_CANCELLED" });
    },
    identity: (hit) => [
      { ad: "warpingOrderId", mevcut: hit.warpingOrderId, gelen: id },
      { ad: "deliveryNoteNo", mevcut: hit.deliveryNoteNo, gelen: input.deliveryNoteNo?.trim() ?? "" },
      { ad: "beams", mevcut: hit.beams, gelen: beamSig(normalizeReceiveBeams(input.beams)) },
    ],
    collision: "Bu işlem kimliği başka içerikli bir levent kabulüne ait — formu yeniden açıp gönderin.",
    respond: async (hit) => ({ ...(await loadWarpingReceipt(prisma, id, hit.receiptKey)), replayed: true }),
  });
}

async function claimForReceiveTx(tx: Tx, id: string, userId: string) {
  const opened = await tx.warpingOrder.updateMany({ where: { id, status: WarpingOrderStatus.OPEN }, data: { status: WarpingOrderStatus.IN_PROGRESS, updatedById: userId } });
  const claim = opened.count === 1 ? opened : await tx.warpingOrder.updateMany({ where: { id, status: { in: RECEIVABLE } }, data: { status: WarpingOrderStatus.IN_PROGRESS, updatedById: userId } });
  const order = await loadOrderForReceive(tx, id);
  if (claim.count === 0) throw notReceivable(order);
  return { order, wasOpen: opened.count === 1 };
}

export async function receiveWarpingOrder(id: string, input: WarpingReceiveInput, userId: string): Promise<WarpingReceiptDto & { replayed: boolean }> {
  const lines = normalizeReceiveBeams(input.beams);
  const deliveryNoteNo = input.deliveryNoteNo?.trim() || null;
  return receiveReplay(id, input).run(input.clientToken, async () => {
    const out = await prisma.$transaction(async (tx) => {
      const { order, wasOpen } = await claimForReceiveTx(tx, id, userId);
      const beams = planBeams(lines, order.planYarns);
      const pre = await evaluate(tx, order, beams);
      await lockDispatchItemsTx(tx, pre.candidates.map((c) => c.dispatchItemId));
      // Kilitten sonra TAZE: eşzamanlı iade/aktarma/başka siparişin devir dağıtımı aynı kalemi tüketmiş olabilir.
      const ev = await evaluate(tx, order, beams);
      const receiptKey = randomUUID();
      const created: Array<{ id: string; beamNo: string; eventId: string }> = [];
      for (const b of beams) {
        const label = `${order.orderNo} ${b.idx + 1}. levent`;
        await assertPhysicalBeamFreeTx(tx, null, b.physicalBeamNo, label);
        const beam = await tx.warpBeam.create({
          data: {
            beamNo: await nextBeamNoTx(tx, new Date()), warpSpecId: order.warpSpecId, status: WarpBeamStatus.PLANNED, plannedLengthM: b.lengthM,
            physicalBeamNo: b.physicalBeamNo, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: order.subcontractorId,
            ownerCustomerId: ev.ownerCustomerId, warpingOrderId: order.id, warpingReceiptKey: receiptKey, createdById: userId, updatedById: userId,
          },
          select: { id: true, beamNo: true },
        });
        const ends = b.yarns.reduce((s, y) => s + y.endsCount, 0);
        const denier = b.yarns.reduce((s, y) => s.plus(D(y.endsCount).mul(y.denier)), D(0)).div(ends).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
        const wound = await applyWarpBeamEventTx(tx, {
          beamId: beam.id, kind: "WOUND", from: WarpBeamStatus.PLANNED, to: WarpBeamStatus.READY,
          data: {
            clientToken: b.idx === 0 ? input.clientToken ?? null : null, lengthM: b.lengthM, endsCount: ends, denier,
            theoreticalKg: b.yarns.reduce((s, y) => s.plus(y.kg), D(0)), kgSource: WarpKgSource.THEORETICAL,
            grossKg: b.grossKg, tareKg: b.tareKg, deliveryNoteNo, createdById: userId,
          },
        });
        await writeWarpingWoundYarnsTx(tx, {
          eventId: wound.id, warpingOrderId: order.id,
          lines: b.yarns.map((y) => ({
            ...y,
            allocations: ev.alloc.rows.filter((r) => r.key.beam === b.idx && r.key.yarnItemId === y.yarnItemId)
              .map((r) => ({ dispatchItemId: r.candidate.dispatchItemId, holderWarpingOrderId: r.candidate.holderWarpingOrderId, kg: r.kg })),
          })),
        });
        created.push({ id: beam.id, beamNo: beam.beamNo, eventId: wound.id });
      }
      return { receiptKey, created, wasOpen, warnings: [...ev.warnings, ...weighWarnings(beams)], ownerCustomerId: ev.ownerCustomerId, carry: ev.alloc.rows.filter((r) => r.candidate.carryOver) };
    });
    for (const c of out.created) {
      await AuditService.log({ userId, action: "CREATE", tableName: "WARP_BEAM", recordId: c.id, newData: { beamNo: c.beamNo, originKind: WarpBeamOrigin.SUBCONTRACT, warpingOrderId: id, receiptKey: out.receiptKey } });
      await logWarpBeamEventAudit({ userId, eventId: c.eventId, kind: "WOUND", data: { beamId: c.id, warpingOrderId: id, kgSource: WarpKgSource.THEORETICAL } });
    }
    await AuditService.log({
      userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id,
      newData: { beamsReceived: out.created.length, receiptKey: out.receiptKey, deliveryNoteNo, ownerCustomerId: out.ownerCustomerId, carryOverKg: kg3(out.carry.reduce((s, r) => s.plus(r.kg), D(0))), ...(out.wasOpen ? { status: WarpingOrderStatus.IN_PROGRESS } : {}) },
    });
    const dto = await loadWarpingReceipt(prisma, id, out.receiptKey);
    return { ...dto, warnings: [...dto.warnings, ...out.warnings], replayed: false };
  });
}
