// =============================================================================
// EMANET ÇIKIŞ BELGESİ — önizleme + oluştur (genel fason F5)
// =============================================================================
// Tek tx: kod kapsamı kilidi (İLK ifade) → satırlar kilitli çözülür (sahip · durum · lot bakiyesi) → numara doğuşta →
// başlık → levent kalemi + `SHIP_TO_OWNER` (READY→SHIPPED_TO_OWNER atomik claim, tek yazar `applyWarpBeamEventTx`) →
// iplik kalemi + `CONSIGNMENT_OUT` (tek yazar `applyYarnMovementTx`). Replay R kipi, TEK boğaz `tokenReplay`.
// =============================================================================
import { Prisma, WarpBeamStatus, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { lockCodeScopeTx } from "../helpers/code-unique.helper";
import { nextSeriesNo, resolveSeriesFormat, seriesPrefix } from "../number-series.service";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { applyYarnMovementTx } from "../yarn.service";
import {
  assertLineModules, assertNoBlockedLines, dispatchLineSignature, normalizeDispatchInput, previewDb, resolveDispatchLines,
  D, type NormalizedDispatch,
} from "./lines";
import { loadConsignmentDispatchDto, type ConsignmentDispatchDetail } from "./read";
import type { ConsignmentDispatchCreateInput, ConsignmentDispatchPreview } from "./types";

export const CONSIGNMENT_DISPATCH_TABLE = "CONSIGNMENT_DISPATCH";
const CODE_SCOPE = "consignmentDispatch";

/** Önizleme: yazmaz, kilitsiz; engelli satır `blockedReason` (oluştur aynı yüklemle 409). Token yok sayılır. */
export async function previewConsignmentDispatch(input: ConsignmentDispatchCreateInput): Promise<ConsignmentDispatchPreview> {
  const n = normalizeDispatchInput(input);
  await assertLineModules(prisma, n);
  const r = await resolveDispatchLines(previewDb, n, { lock: false });
  let beamLengthM = D(0);
  let yarnKg = D(0);
  const lines: ConsignmentDispatchPreview["lines"] = [];
  for (const b of r.beams) {
    beamLengthM = beamLengthM.plus(b.remainingM);
    lines.push({ kind: "WARP_BEAM", refId: b.warpBeamId, label: b.warpSpecName ? `${b.beamNo} · ${b.warpSpecName}` : b.beamNo, qty: b.remainingM.toFixed(3), unit: "METER", ownerCustomerId: b.ownerCustomerId, blockedReason: b.blockedReason });
  }
  for (const y of r.yarns) {
    yarnKg = yarnKg.plus(y.qtyKg);
    lines.push({ kind: "YARN", refId: y.lotId, label: `${y.itemCode} · lot ${y.lotNo} · ${y.warehouseName}`, qty: y.qtyKg.toFixed(3), unit: "KG", ownerCustomerId: y.ownerCustomerId, blockedReason: y.blockedReason });
  }
  const blocked = lines.filter((l) => l.blockedReason !== null);
  return {
    ownerCustomer: { id: r.owner.id, name: r.owner.name },
    lines,
    totals: { beamCount: r.beams.length, beamLengthM: beamLengthM.toFixed(3), yarnKg: yarnKg.toFixed(3) },
    canCreate: blocked.length === 0,
    warnings: blocked.map((l) => `[${l.blockedReason}] ${l.label}`),
  };
}

export interface CreateConsignmentDispatchResult {
  data: ConsignmentDispatchDetail;
  /** Aynı denemenin tekrarı (yeni belge açılmadı) — route 201 yerine 200 döner. */
  replayed: boolean;
}

interface PriorDispatch {
  id: string;
  dispatchNo: string;
  ownerCustomerId: string;
  cancelledAt: Date | null;
  items: Array<{ kind: string; warpBeamId: string | null; yarnItemId: string | null; warehouseId: string | null; lotId: string | null; qtyKg: Prisma.Decimal | null }>;
}

function priorSignature(p: PriorDispatch): string {
  const beamIds: string[] = [];
  const yarns: NormalizedDispatch["yarns"] = [];
  for (const i of p.items) {
    if (i.kind === "WARP_BEAM" && i.warpBeamId) beamIds.push(i.warpBeamId);
    else if (i.yarnItemId && i.warehouseId && i.lotId && i.qtyKg) yarns.push({ yarnItemId: i.yarnItemId, warehouseId: i.warehouseId, lotId: i.lotId, qtyKg: i.qtyKg });
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  yarns.sort((a, b) => cmp(a.yarnItemId, b.yarnItemId) || cmp(a.warehouseId, b.warehouseId) || cmp(a.lotId, b.lotId));
  return dispatchLineSignature({ beamIds: beamIds.sort(cmp), yarns });
}

function replayFor(n: NormalizedDispatch) {
  return tokenReplay<PriorDispatch, CreateConsignmentDispatchResult>({
    find: (db, clientToken) => db.consignmentDispatch.findUnique({
      where: { clientToken },
      select: { id: true, dispatchNo: true, ownerCustomerId: true, cancelledAt: true, items: { select: { kind: true, warpBeamId: true, yarnItemId: true, warehouseId: true, lotId: true, qtyKg: true } } },
    }),
    alive: (p) => {
      if (p.cancelledAt) {
        throw AppError.conflict(`Bu form daha önce kaydedilmiş ve çıkış belgesi İPTAL edilmiş (${p.dispatchNo}) — aynı gönderim tekrar edilemez. Yeni belge için formu kapatıp yeniden açın.`, { code: "CONSIGNMENT_DISPATCH_CANCELLED", dispatchId: p.id, dispatchNo: p.dispatchNo });
      }
    },
    identity: (p) => [
      { ad: "ownerCustomerId", mevcut: p.ownerCustomerId, gelen: n.ownerCustomerId },
      { ad: "items", mevcut: priorSignature(p), gelen: dispatchLineSignature(n) },
    ],
    collision: (p) => `Bu işlem kimliği başka içerikli bir çıkış belgesine (${p.dispatchNo}) ait — formu yeniden açıp gönderin.`,
    respond: async (p) => ({ data: await loadConsignmentDispatchDto(prisma, p.id), replayed: true }),
  });
}

export async function createConsignmentDispatch(input: ConsignmentDispatchCreateInput, userId: string): Promise<CreateConsignmentDispatchResult> {
  const n = normalizeDispatchInput(input);
  return replayFor(n).run(input.clientToken, async () => {
    await assertLineModules(prisma, n);
    const out = await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Biçim BİR KEZ okunur; kapsam kilidi tx'in İLK ifadesi (`nextBeamNoTx` emsali, 8029).
      const fmt = resolveSeriesFormat(CODE_SCOPE);
      await lockCodeScopeTx(tx, CODE_SCOPE, seriesPrefix(fmt, now));
      const r = await resolveDispatchLines(tx, n, { lock: true });
      assertNoBlockedLines(r);
      const dispatchNo = await nextSeriesNo(CODE_SCOPE, async (prefix) =>
        tx.consignmentDispatch
          .findMany({ where: { dispatchNo: { gte: prefix, startsWith: prefix } }, select: { dispatchNo: true, createdAt: true } })
          .then((rows) => rows.map((x) => ({ code: x.dispatchNo, createdAt: x.createdAt }))), now, fmt);
      const header = await tx.consignmentDispatch.create({
        data: {
          dispatchNo, clientToken: input.clientToken ?? null, ownerCustomerId: n.ownerCustomerId, dispatchedAt: now, dispatchedById: userId,
          plateNumber: n.plateNumber, driverName: n.driverName, notes: n.notes, createdById: userId, updatedById: userId,
        },
        select: { id: true },
      });
      const beamEvents: Array<{ eventId: string; beamId: string; beamNo: string; lengthM: string; itemId: string }> = [];
      for (const b of r.beams) {
        const item = await tx.consignmentDispatchItem.create({ data: { dispatchId: header.id, kind: "WARP_BEAM", warpBeamId: b.warpBeamId, lengthM: b.remainingM }, select: { id: true } });
        const ev = await applyWarpBeamEventTx(tx, {
          beamId: b.warpBeamId, kind: "SHIP_TO_OWNER", from: WarpBeamStatus.READY, to: WarpBeamStatus.SHIPPED_TO_OWNER,
          data: { consignmentItemId: item.id, lengthM: b.remainingM, reason: `Emanet çıkış ${dispatchNo}`, createdById: userId },
        });
        beamEvents.push({ eventId: ev.id, beamId: b.warpBeamId, beamNo: b.beamNo, lengthM: b.remainingM.toFixed(3), itemId: item.id });
      }
      const yarnLines: Array<{ itemId: string; lotId: string; warehouseId: string; qtyKg: string }> = [];
      for (const y of r.yarns) {
        const item = await tx.consignmentDispatchItem.create({ data: { dispatchId: header.id, kind: "YARN", yarnItemId: y.yarnItemId, warehouseId: y.warehouseId, lotId: y.lotId, qtyKg: y.qtyKg }, select: { id: true } });
        await applyYarnMovementTx(tx, {
          itemId: y.yarnItemId, warehouseId: y.warehouseId, kind: YarnMovementKind.CONSIGNMENT_OUT, qtyKg: y.qtyKg, lotId: y.lotId,
          consignmentItemId: item.id, reason: `Emanet çıkış ${dispatchNo}`, userId,
        });
        yarnLines.push({ itemId: item.id, lotId: y.lotId, warehouseId: y.warehouseId, qtyKg: y.qtyKg.toFixed(3) });
      }
      return { id: header.id, dispatchNo, beamEvents, yarnLines };
    });
    await AuditService.log({
      userId, action: "CREATE", tableName: CONSIGNMENT_DISPATCH_TABLE, recordId: out.id,
      newData: { dispatchNo: out.dispatchNo, ownerCustomerId: n.ownerCustomerId, beams: out.beamEvents.map((e) => ({ warpBeamId: e.beamId, beamNo: e.beamNo, lengthM: e.lengthM })), yarns: out.yarnLines },
    });
    for (const e of out.beamEvents) {
      await logWarpBeamEventAudit({ userId, eventId: e.eventId, kind: "SHIP_TO_OWNER", data: { beamId: e.beamId, beamNo: e.beamNo, lengthM: e.lengthM, consignmentItemId: e.itemId, dispatchNo: out.dispatchNo } });
    }
    return { data: await loadConsignmentDispatchDto(prisma, out.id), replayed: false };
  });
}
