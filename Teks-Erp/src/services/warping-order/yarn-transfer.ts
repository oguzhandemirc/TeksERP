// =============================================================================
// FASON DEVERE SİPARİŞİ — deverecideki ipliği BAŞKA devere siparişine AKTARMA (D4b-2)
// =============================================================================
// Stok hareketi DEĞİLDİR (iplik deverecide kalır): `WarpingYarnTransfer` defterine satır yazılır, kalemin hangi
// siparişçe tutulduğu değişir (holding, `warping-yarn-open.helper`). Kaynak IN_PROGRESS|COMPLETED (kapanmış siparişin
// kalanı = devreden bakiye), hedef OPEN|IN_PROGRESS → IN_PROGRESS; aynı devereci; iplik hedefin planında.
// Kilit sırası: iki sipariş claim'i `id` sırasıyla (tx'in İLK ifadeleri) → kalem satırları `FOR UPDATE` `id` sırasıyla.
// Satır seçimi: istekte kalem verilmezse kaynağın tuttuğu kalemlerden sevk sırasıyla (FIFO). Storno `yarn-transfer-cancel.ts`.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { singleOwner } from "../helpers/emanet-owner.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { readDevereFasonLotPolicy } from "../system-setting.service";
import { loadWarpingYarnItems, lockDispatchItemsTx, WARPING_TRANSFER, type WarpingYarnItem } from "../helpers/warping-yarn-open.helper";
import { lotPolicyVerdict, mixedLots, openItems } from "./dispatch";
import { WARPING_ORDER_TABLE } from "./create";
import { loadTransferBatch, type WarpingTransferBatch } from "./yarn-transfer-shared";
import { claimTransferOrdersTx } from "./yarn-transfer-cancel";
import { qtyText } from "../helpers/warping-message.helper";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);
export const WARPING_TRANSFER_MAX_LINES = 50;

export interface WarpingTransferLineInput {
  yarnItemId: string;
  qtyKg: number;
  /** undefined ⇒ her lot; null ⇒ yalnız lotsuz kalemler. */
  lotId?: string | null;
  /** Belirli bir sevk kalemi (verilirse yalnız ondan). */
  dispatchItemId?: string;
}
export interface WarpingTransferInput {
  clientToken?: string;
  toWarpingOrderId: string;
  lines: WarpingTransferLineInput[];
  note?: string | null;
}
export interface WarpingTransferAllocation {
  dispatchItemId: string;
  dispatchNo: string;
  yarnItemId: string;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  qtyKg: Prisma.Decimal;
}

const qtyOf = (v: number) => {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lte(0)) throw AppError.badRequest("Aktarılacak kg sıfırdan büyük olmalı.");
  return d;
};

/** Kaynağın tuttuğu kalemlerden satır başına FIFO seçimi; tutma yetmezse 400 (eksi bakiye kapısı). Saf. */
export function allocateTransfer(source: WarpingYarnItem[], lines: WarpingTransferLineInput[], codeOf: (y: string) => string): WarpingTransferAllocation[] {
  const left = new Map(source.map((i) => [i.dispatchItemId, i.openKg]));
  const out: WarpingTransferAllocation[] = [];
  for (const l of lines) {
    let need = qtyOf(l.qtyKg);
    const pool = source.filter((i) => i.yarnItemId === l.yarnItemId
      && (l.lotId === undefined || i.lotId === l.lotId)
      && (l.dispatchItemId === undefined || i.dispatchItemId === l.dispatchItemId));
    const avail = pool.reduce((a, i) => a.plus(Prisma.Decimal.max(0, left.get(i.dispatchItemId)!)), D(0));
    if (avail.lt(need)) {
      throw AppError.badRequest(`${codeOf(l.yarnItemId)}: kaynak siparişin deverecide tuttuğu ${qtyText(avail)} kg, aktarılmak istenen ${qtyText(need)} kg — aktarma tutmayı aşamaz.`, {
        code: "WARPING_TRANSFER_EXCEEDS", yarnItemId: l.yarnItemId, availableKg: kg(avail), requestedKg: kg(need),
      });
    }
    for (const i of pool) {
      if (need.lte(0)) break;
      const has = left.get(i.dispatchItemId)!;
      if (has.lte(0)) continue;
      const take = Prisma.Decimal.min(has, need);
      left.set(i.dispatchItemId, has.minus(take));
      need = need.minus(take);
      const prev = out.find((a) => a.dispatchItemId === i.dispatchItemId);
      if (prev) prev.qtyKg = prev.qtyKg.plus(take);
      else out.push({ dispatchItemId: i.dispatchItemId, dispatchNo: i.dispatchNo, yarnItemId: i.yarnItemId, lotId: i.lotId, lotNo: i.lotNo, ownerCustomerId: i.ownerCustomerId, qtyKg: take });
    }
  }
  return out;
}

function validate(id: string, input: WarpingTransferInput): void {
  if (input.toWarpingOrderId === id) throw AppError.badRequest("Kaynak ve hedef sipariş aynı olamaz.", { code: "WARPING_TRANSFER_SAME_ORDER" });
  if (input.lines.length === 0) throw AppError.badRequest("Aktarmada en az bir iplik satırı olmalı.", { code: "WARPING_TRANSFER_EMPTY" });
  if (input.lines.length > WARPING_TRANSFER_MAX_LINES) throw AppError.badRequest(`Bir aktarmada en çok ${WARPING_TRANSFER_MAX_LINES} satır olabilir.`);
}

interface Evaluated { allocations: WarpingTransferAllocation[]; warnings: string[]; ownerCustomerId: string | null }

/** Sevk ile aynı kapılar (hedefin gözünden): plan dışı iplik 400 · tek sahip KATI · K4 lot kuralı. */
async function evaluate(db: Tx | typeof prisma, sourceId: string, input: WarpingTransferInput, target: { yarns: Array<{ yarnItemId: string; code: string }> }): Promise<Evaluated> {
  const codeOf = (y: string) => target.yarns.find((t) => t.yarnItemId === y)?.code ?? y;
  const offPlan = input.lines.find((l) => !target.yarns.some((y) => y.yarnItemId === l.yarnItemId));
  if (offPlan) throw AppError.badRequest("Hedef siparişin iplik planında olmayan iplik aktarılamaz.", { code: "WARPING_YARN_NOT_IN_PLAN", yarnItemId: offPlan.yarnItemId });
  const source = openItems(await loadWarpingYarnItems(db, { warpingOrderId: sourceId }));
  const allocations = allocateTransfer(source, input.lines, codeOf);
  const targetOpen = openItems(await loadWarpingYarnItems(db, { warpingOrderId: input.toWarpingOrderId }));
  const ownerCustomerId = singleOwner([...targetOpen.map((i) => i.ownerCustomerId), ...allocations.map((a) => a.ownerCustomerId)], "Fason devere siparişi", { strict: true });
  const warnings = lotPolicyVerdict(await readDevereFasonLotPolicy(db), mixedLots([...targetOpen, ...allocations]), codeOf);
  return { allocations, warnings, ownerCustomerId };
}

async function loadTarget(db: Tx | typeof prisma, sourceId: string, targetId: string) {
  const orders = await sequentialTx(db).warpingOrder.findMany({
    where: { id: { in: [sourceId, targetId] } },
    select: { id: true, orderNo: true, status: true, subcontractorId: true, yarns: { select: { yarnItemId: true, yarnItem: { select: { code: true } } } } },
  });
  const source = orders.find((o) => o.id === sourceId);
  const target = orders.find((o) => o.id === targetId);
  if (!source) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  if (!target) throw AppError.badRequest("Hedef devere siparişi bulunamadı.", { code: "WARPING_TRANSFER_TARGET_NOT_FOUND" });
  if (source.subcontractorId !== target.subcontractorId) {
    throw AppError.badRequest("Aktarma yalnız AYNI devereciye ait siparişler arasında olur — iplik başka fasoncuya iade + sevkle gider.", { code: "WARPING_TRANSFER_OTHER_SUBCONTRACTOR" });
  }
  return { source, target: { ...target, yarns: target.yarns.map((y) => ({ yarnItemId: y.yarnItemId, code: y.yarnItem.code })) } };
}

const sig = (rows: Array<{ yarnItemId: string; qty: Prisma.Decimal.Value }>) => {
  const m = new Map<string, Prisma.Decimal>();
  for (const r of rows) m.set(r.yarnItemId, (m.get(r.yarnItemId) ?? D(0)).plus(r.qty));
  return [...m].map(([y, q]) => `${y}|${q.toFixed(3)}`).sort().join(",");
};

function transferReplay(id: string, input: WarpingTransferInput) {
  type Hit = { batchId: string; fromWarpingOrderId: string; toWarpingOrderId: string; lines: string };
  return tokenReplay<Hit, WarpingTransferBatch & { replayed: boolean }>({
    find: async (db, clientToken) => {
      const first = await db.warpingYarnTransfer.findUnique({ where: { clientToken }, select: { batchId: true, fromWarpingOrderId: true, toWarpingOrderId: true } });
      if (!first) return null;
      const rows = await db.warpingYarnTransfer.findMany({ where: { batchId: first.batchId }, select: { qtyKg: true, dispatchItem: { select: { yarnItemId: true } } } });
      return { ...first, lines: sig(rows.map((r) => ({ yarnItemId: r.dispatchItem.yarnItemId ?? "", qty: r.qtyKg }))) };
    },
    alive: { neverDies: "aktarma satırı silinmez; stornosu ayrı satırdır — replay ilk yanıtı (storno bilgisiyle) döndürür" },
    identity: (hit) => [
      { ad: "fromWarpingOrderId", mevcut: hit.fromWarpingOrderId, gelen: id },
      { ad: "toWarpingOrderId", mevcut: hit.toWarpingOrderId, gelen: input.toWarpingOrderId },
      { ad: "lines", mevcut: hit.lines, gelen: sig(input.lines.map((l) => ({ yarnItemId: l.yarnItemId, qty: qtyOf(l.qtyKg) }))) },
    ],
    collision: "Bu işlem kimliği başka içerikli bir aktarmaya ait — formu yeniden açıp gönderin.",
    respond: async (hit) => ({ ...(await loadTransferBatch(prisma, hit.batchId)), replayed: true }),
  });
}

export async function previewWarpingTransfer(id: string, input: Omit<WarpingTransferInput, "clientToken">) {
  validate(id, input);
  const { target } = await loadTarget(prisma, id, input.toWarpingOrderId);
  const ev = await evaluate(prisma, id, input, target);
  return {
    allocations: ev.allocations.map((a) => ({ ...a, qtyKg: kg(a.qtyKg) })),
    totalKg: kg(ev.allocations.reduce((s, a) => s.plus(a.qtyKg), D(0))),
    ownerCustomerId: ev.ownerCustomerId,
    warnings: ev.warnings,
  };
}

export async function transferWarpingYarn(id: string, input: WarpingTransferInput, userId: string): Promise<WarpingTransferBatch & { replayed: boolean }> {
  validate(id, input);
  const replay = transferReplay(id, input);
  return replay.run(input.clientToken, async () => {
    const out = await prisma.$transaction(async (tx) => {
      const claim = await claimTransferOrdersTx(tx, { sourceId: id, targetId: input.toWarpingOrderId, userId });
      const { target } = await loadTarget(tx, id, input.toWarpingOrderId);
      const pre = await evaluate(tx, id, input, target);
      await lockDispatchItemsTx(tx, pre.allocations.map((a) => a.dispatchItemId));
      // Kilitten sonra TAZE değerlendirme: eşzamanlı aktarma/iade aynı kalemi tüketmiş olabilir.
      const ev = await evaluate(tx, id, input, target);
      const batchId = randomUUID();
      const note = input.note?.trim() || null;
      for (const [n, a] of ev.allocations.entries()) {
        await tx.warpingYarnTransfer.create({
          data: {
            dispatchItemId: a.dispatchItemId, fromWarpingOrderId: id, toWarpingOrderId: input.toWarpingOrderId, kind: WARPING_TRANSFER,
            qtyKg: a.qtyKg, batchId, clientToken: n === 0 ? input.clientToken ?? null : null, note, createdById: userId,
          },
        });
      }
      return { batchId, warnings: ev.warnings, targetWasOpen: claim.targetWasOpen, total: ev.allocations.reduce((s, a) => s.plus(a.qtyKg), D(0)) };
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, newData: { yarnTransferOut: out.batchId, toWarpingOrderId: input.toWarpingOrderId, totalKg: kg(out.total) } });
    await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: input.toWarpingOrderId, newData: { yarnTransferIn: out.batchId, fromWarpingOrderId: id, totalKg: kg(out.total), ...(out.targetWasOpen ? { status: WarpingOrderStatus.IN_PROGRESS } : {}) } });
    const batch = await loadTransferBatch(prisma, out.batchId);
    return { ...batch, warnings: [...batch.warnings, ...out.warnings], replayed: false };
  });
}
