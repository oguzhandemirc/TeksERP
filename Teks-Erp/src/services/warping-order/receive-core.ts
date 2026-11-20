// =============================================================================
// FASON DEVERE DÖNÜŞ KABULÜ — sipariş başı tx-içi ÇEKİRDEK (D5a; devere ek E1'de `receive.ts`ten ayrıldı)
// =============================================================================
// Satır normalizasyonu, donmuş plandan kırılım, dağıtım değerlendirmesi, claim ve satır yazıcısı. Tek sipariş
// `/receive` (`receive.ts`) ve çok siparişli dönüş kabul belgesi (`receive-doc.ts`) AYNI fonksiyonları çağırır.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { warpTheoreticalKg } from "../../constants/warp-beam";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { nextBeamNoTx } from "../helpers/warp-beam.helper";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { assertPhysicalBeamFreeTx } from "../helpers/warp-beam-set.helper";
import { lockDispatchItemsTx } from "../helpers/warping-yarn-open.helper";
import { writeWarpingWoundYarnsTx } from "../helpers/warping-receipt-guard.helper";
import { allocateWoundYarn, loadAllocationCandidates } from "../helpers/wound-allocation.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { qtyText } from "../helpers/qty-text.helper";
import { planReceiveReworks, type WarpingReceiveReworkLine } from "./receive-rework";
import { auditReceiveBodies, bodyTareWarnings, planReceiveBodies, receiveLinePhysicalSig, registerReceiveBodiesTx, type ReceiveBodyPlan, type WarpingReceiveBodyLine } from "./receive-body";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg3 = (v: Prisma.Decimal) => v.toFixed(3);
export const WARPING_RECEIVE_MAX_BEAMS = 50;
export const RECEIVABLE: WarpingOrderStatus[] = [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS];

export interface WarpingReceiveBeamInput extends WarpingReceiveBodyLine, WarpingReceiveReworkLine {
  lengthM: number;
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
export function planBeams(lines: Array<Omit<BeamPlan, "yarns">>, yarns: PlanYarn[]): BeamPlan[] {
  return lines.map((l) => ({ ...l, yarns: yarns.map((y) => ({ yarnItemId: y.yarnItemId, endsCount: y.endsCount, denier: y.denier, kg: warpTheoreticalKg(y.endsCount, y.denier, l.lengthM) })) }));
}

export async function loadOrderForReceive(db: Tx | typeof prisma, id: string) {
  const o = await sequentialTx(db).warpingOrder.findUnique({
    where: { id },
    select: { id: true, orderNo: true, status: true, subcontractorId: true, warpSpecId: true, yarns: { select: { yarnItemId: true, endsCount: true, denier: true, yarnItem: { select: { code: true, name: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  return { ...o, planYarns: o.yarns.map((y): PlanYarn => ({ yarnItemId: y.yarnItemId, code: y.yarnItem.code, name: y.yarnItem.name, endsCount: y.endsCount, denier: D(y.denier) })) };
}

export type NeedKey = { beam: number; yarnItemId: string };

/** Adaylar + dağıtım (saf hesap; kabul ve önizleme aynı). */
export async function evaluate(db: Tx | typeof prisma, order: Awaited<ReturnType<typeof loadOrderForReceive>>, beams: BeamPlan[]) {
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

/** Önizlemede satırın gövdesi (B3): kayıtlı mı, yerinde mi tanımlanacak, sahibi. */
export interface ReceiveBodyDto { beamBodyId: string | null; bodyNo: string | null; isNew: boolean; ownerKind: ReceiveBodyPlan["ownerKind"] }
export const bodyDto = (p: ReceiveBodyPlan | null): ReceiveBodyDto | null => (p ? { beamBodyId: p.beamBodyId, bodyNo: p.bodyNo, isNew: p.register !== null, ownerKind: p.ownerKind } : null);
export const tareLines = (beams: BeamPlan[]) => beams.map((b) => ({ idx: b.idx, grossKg: b.grossKg, tareKg: b.tareKg, nominalKg: b.yarns.reduce((s, y) => s.plus(y.kg), D(0)) }));

export function weighWarnings(beams: BeamPlan[]): string[] {
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

export function notReceivable(o: { orderNo: string; status: WarpingOrderStatus }) {
  const hint = o.status === WarpingOrderStatus.COMPLETED ? " — kapanmış siparişe levent kabulü için önce siparişi yeniden açın." : ".";
  return AppError.conflict(`${o.orderNo} durumu ${o.status} — levent kabulü yapılamaz${hint}`, { code: "WARPING_ORDER_NOT_RECEIVABLE", status: o.status });
}

const beamSig = (rows: Array<{ lengthM: Prisma.Decimal.Value; physicalBeamNo: string | null; grossKg: Prisma.Decimal.Value | null; tareKg: Prisma.Decimal.Value | null }>) =>
  rows.map((r) => `${D(r.lengthM).toFixed(3)}|${r.physicalBeamNo ?? ""}|${r.grossKg === null ? "" : D(r.grossKg).toFixed(3)}|${r.tareKg === null ? "" : D(r.tareKg).toFixed(3)}`).join(",");

type ReceiptBeamRow = { status: WarpBeamStatus; physicalBeamNo: string | null; beamBodyId: string | null; events: Array<{ lengthM: Prisma.Decimal | null; grossKg: Prisma.Decimal | null; tareKg: Prisma.Decimal | null }> };
/** Kayıtlı kabulün satır imzası (replay kimliği) — tek sipariş ve belge replay'i aynı biçimi kıyaslar. */
export const storedBeamSig = (beams: ReceiptBeamRow[]) =>
  beamSig(beams.map((b) => ({ lengthM: b.events[0]?.lengthM ?? 0, physicalBeamNo: b.beamBodyId ? "#body" : b.physicalBeamNo, grossKg: b.events[0]?.grossKg ?? null, tareKg: b.events[0]?.tareKg ?? null })));
/** Gelen satırların imzası (aynı biçim). */
export const inputBeamSig = (beams: WarpingReceiveBeamInput[]) =>
  beamSig(normalizeReceiveBeams(beams).map((l) => ({ ...l, physicalBeamNo: receiveLinePhysicalSig(beams[l.idx]!) || null })));

export async function claimForReceiveTx(tx: Tx, id: string, userId: string) {
  const opened = await tx.warpingOrder.updateMany({ where: { id, status: WarpingOrderStatus.OPEN }, data: { status: WarpingOrderStatus.IN_PROGRESS, updatedById: userId } });
  const claim = opened.count === 1 ? opened : await tx.warpingOrder.updateMany({ where: { id, status: { in: RECEIVABLE } }, data: { status: WarpingOrderStatus.IN_PROGRESS, updatedById: userId } });
  const order = await loadOrderForReceive(tx, id);
  if (claim.count === 0) throw notReceivable(order);
  return { order, wasOpen: opened.count === 1 };
}

export type ReceiveOrder = Awaited<ReturnType<typeof loadOrderForReceive>>;
/** Kilit öncesi dağıtım adayı kalemler (belge kabulü N siparişin birleşimini TEK seferde `id` sırasıyla kilitler). */
export async function receiveCandidateItemIds(tx: Tx, order: ReceiveOrder, beams: WarpingReceiveBeamInput[]): Promise<string[]> {
  return (await evaluate(tx, order, planBeams(normalizeReceiveBeams(beams), order.planYarns))).candidates.map((c) => c.dispatchItemId);
}

export interface ReceiveOrderLinesOut {
  orderId: string; receiptKey: string; wasOpen: boolean; subcontractorId: string; ownerCustomerId: string | null; warnings: string[];
  created: Array<{ id: string; beamNo: string; eventId: string; beamBodyId: string | null }>;
  registered: Awaited<ReturnType<typeof registerReceiveBodiesTx>>;
  carry: Array<{ kg: Prisma.Decimal }>;
}

/**
 * TEK SİPARİŞİN satırlarını yazan tx-içi çekirdek (claim'den SONRA; tek sipariş `/receive` ve kabul belgesi aynı yol).
 * Kalem kilidi → TAZE dağıtım → gövde (B3) → yeniden sarım (C1) → sarım + WOUND + kırılım. `clientToken` yalnız ilk
 * WOUND'a (tek sipariş replay kaynağı); belge kabulünde token belgede, `warpingReceiveDocId` her sarımda.
 */
export async function receiveOrderLinesTx(tx: Tx, p: { order: ReceiveOrder; wasOpen: boolean; beams: WarpingReceiveBeamInput[]; deliveryNoteNo: string | null; clientToken: string | null; receiveDocId: string | null; userId: string }): Promise<ReceiveOrderLinesOut> {
  const { order, userId } = p;
  const beams = planBeams(normalizeReceiveBeams(p.beams), order.planYarns);
  const pre = await evaluate(tx, order, beams);
  await lockDispatchItemsTx(tx, pre.candidates.map((c) => c.dispatchItemId));
  // Kilitten sonra TAZE: eşzamanlı iade/aktarma/başka siparişin devir dağıtımı aynı kalemi tüketmiş olabilir.
  const ev = await evaluate(tx, order, beams);
  // B3: gövde satırları (doğrulama + yerinde tanım); gövdenin dolu dönüşünü WOUND kancası yazar.
  const bodies = await planReceiveBodies(tx, { lines: p.beams, subcontractorId: order.subcontractorId, lotOwnerCustomerId: ev.ownerCustomerId });
  const registered = await registerReceiveBodiesTx(tx, bodies, order.subcontractorId, userId);
  // C1: yeniden sarım bağı — reddedilen sarımlar kalem kilitlerinden sonra kilitlenir.
  const reworks = await planReceiveReworks(tx, { warpingOrderId: order.id, lines: p.beams, lock: true });
  const receiptKey = randomUUID();
  const created: ReceiveOrderLinesOut["created"] = [];
  for (const b of beams) {
    const label = `${order.orderNo} ${b.idx + 1}. levent`;
    const body = bodies[b.idx] ?? null;
    const physicalBeamNo = body?.bodyNo ?? b.physicalBeamNo;
    await assertPhysicalBeamFreeTx(tx, null, physicalBeamNo, label);
    const beam = await tx.warpBeam.create({
      data: {
        beamNo: await nextBeamNoTx(tx, new Date()), warpSpecId: order.warpSpecId, status: WarpBeamStatus.PLANNED, plannedLengthM: b.lengthM,
        physicalBeamNo, beamBodyId: body?.beamBodyId ?? null, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: order.subcontractorId,
        ownerCustomerId: body ? body.warpOwnerCustomerId : ev.ownerCustomerId, warpingOrderId: order.id, warpingReceiptKey: receiptKey, warpingReceiveDocId: p.receiveDocId,
        reworkOfBeamId: reworks[b.idx]?.beamId ?? null, createdById: userId, updatedById: userId,
      },
      select: { id: true, beamNo: true },
    });
    const ends = b.yarns.reduce((s, y) => s + y.endsCount, 0);
    const denier = b.yarns.reduce((s, y) => s.plus(D(y.endsCount).mul(y.denier)), D(0)).div(ends).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    const wound = await applyWarpBeamEventTx(tx, {
      beamId: beam.id, kind: "WOUND", from: WarpBeamStatus.PLANNED, to: WarpBeamStatus.READY,
      data: {
        clientToken: b.idx === 0 ? p.clientToken : null, lengthM: b.lengthM, endsCount: ends, denier,
        theoreticalKg: b.yarns.reduce((s, y) => s.plus(y.kg), D(0)), kgSource: WarpKgSource.THEORETICAL,
        grossKg: b.grossKg, tareKg: b.tareKg, deliveryNoteNo: p.deliveryNoteNo, createdById: userId,
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
    created.push({ id: beam.id, beamNo: beam.beamNo, eventId: wound.id, beamBodyId: body?.beamBodyId ?? null });
  }
  return {
    orderId: order.id, receiptKey, created, wasOpen: p.wasOpen, registered, subcontractorId: order.subcontractorId, ownerCustomerId: ev.ownerCustomerId,
    warnings: [...ev.warnings, ...weighWarnings(beams), ...bodyTareWarnings(tareLines(beams), bodies)], carry: ev.alloc.rows.filter((r) => r.candidate.carryOver),
  };
}

/** Tx DIŞINDA ayak izi (tek sipariş ve belge aynı). */
export async function auditReceiveOrder(userId: string, out: ReceiveOrderLinesOut, deliveryNoteNo: string | null, receiveDocId: string | null): Promise<void> {
  const id = out.orderId;
  await auditReceiveBodies(userId, out.subcontractorId, out.registered);
  for (const c of out.created) {
    await AuditService.log({ userId, action: "CREATE", tableName: "WARP_BEAM", recordId: c.id, newData: { beamNo: c.beamNo, originKind: WarpBeamOrigin.SUBCONTRACT, warpingOrderId: id, receiptKey: out.receiptKey, ...(c.beamBodyId ? { beamBodyId: c.beamBodyId } : {}), ...(receiveDocId ? { warpingReceiveDocId: receiveDocId } : {}) } });
    await logWarpBeamEventAudit({ userId, eventId: c.eventId, kind: "WOUND", data: { beamId: c.id, warpingOrderId: id, kgSource: WarpKgSource.THEORETICAL } });
  }
  await AuditService.log({
    userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id,
    newData: { beamsReceived: out.created.length, receiptKey: out.receiptKey, deliveryNoteNo, ownerCustomerId: out.ownerCustomerId, carryOverKg: kg3(out.carry.reduce((s, r) => s.plus(r.kg), D(0))), ...(receiveDocId ? { warpingReceiveDocId: receiveDocId } : {}), ...(out.wasOpen ? { status: WarpingOrderStatus.IN_PROGRESS } : {}) },
  });
}
