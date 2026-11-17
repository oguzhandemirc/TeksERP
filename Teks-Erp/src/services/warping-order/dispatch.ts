// =============================================================================
// FASON DEVERE SİPARİŞİ — iplik sevki · sevk önizlemesi · talimat verisi (D4b)
// =============================================================================
// Sevk: replay R kipi (`tokenReplay`, `SubcontractorDispatch.clientToken`) → tx: sipariş CLAIM'i İLK ifade
// (`OPEN|IN_PROGRESS → IN_PROGRESS`; aynı satırı claim eden sevk/düzenleme/iptal sıraya girer) → plan dışı iplik 400 →
// `devere.lotRequired` → tek sahip (emanet lot; KATI: fabrika malı + emanet de karışım) → K4 lot kuralı → belge no
// doğuşta → mevcut `dispatchYarnItemsTx` (tek iplik yazarı `applyYarnMovementTx`; eksi bakiye + bekletme kapısı orada).
// Plandan FAZLA ve kısmi sevk meşrudur (fazlası `warnings`). Sevk iptali `dispatch-cancel.ts`te.
// =============================================================================
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { nextSubcontractorDocNoTx } from "../subcontractor.service";
import { emitSubcontractDispatchedTx } from "../notification-sources/depo";
import { dispatchYarnItemsTx } from "../subcontractor-yarn.service";
import { assertWarpingBound } from "../helpers/dispatch-header.helper";
import { singleOwner } from "../helpers/emanet-owner.helper";
import { readYarnStock } from "../helpers/maliyet-bridge.helper";
import { readDevereFasonLotPolicy, readDevereLotRequired, type DevereFasonLotPolicy } from "../system-setting.service";
import { loadWarpingYarnItems, lotKey, sumByYarn, type WarpingYarnItem } from "../helpers/warping-yarn-open.helper";
import { WARPING_ORDER_TABLE } from "./create";
import { loadWarpingOrderDto } from "./read";
import { buildWarpingInstruction, type WarpingInstruction } from "./instruction";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg = (v: Prisma.Decimal) => v.toFixed(3);
export const WARPING_DISPATCH_MAX_LINES = 50;
const DISPATCHABLE = [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS];

export interface WarpingDispatchLineInput {
  yarnItemId: string;
  warehouseId: string;
  lotId?: string | null;
  qtyKg: number;
}
export interface WarpingDispatchInput {
  clientToken?: string;
  lines: WarpingDispatchLineInput[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
  /** undefined ⇒ siparişin termini; null ⇒ termin yok. */
  expectedReturnAt?: string | null;
}

export interface WarpingDispatchResult {
  dispatch: { id: string; dispatchNo: string; warpingOrderId: string; subcontractorId: string; dispatchedAt: string; expectedReturnAt: string | null };
  orderStatus: WarpingOrderStatus;
  yarnItems: Array<{ dispatchItemId: string; yarnItemId: string; code: string; warehouseId: string; lotId: string | null; qtyKg: string }>;
  yarnTotalKg: string;
  ownerCustomerId: string | null;
  instruction: WarpingInstruction;
  warnings: string[];
  replayed: boolean;
}

// ── Kapılar (tek yer: sevk ve önizleme aynı yüklemleri okur) ─────────────────

/** Sipariş kapsamında iplik başına lot kümesi > 1 olan iplikler (canlı kalemlerin açık olanları + yeni satırlar). */
export function mixedLots(items: Array<{ yarnItemId: string; lotId: string | null }>): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const it of items) {
    const s = sets.get(it.yarnItemId) ?? new Set<string>();
    s.add(lotKey(it.lotId));
    sets.set(it.yarnItemId, s);
  }
  const out = new Map<string, string[]>();
  for (const [y, s] of sets) if (s.size > 1) out.set(y, [...s]);
  return out;
}

function lotPolicyVerdict(policy: DevereFasonLotPolicy, mixed: Map<string, string[]>, codeOf: (yarnItemId: string) => string): string[] {
  if (mixed.size === 0 || policy === "FREE") return [];
  const names = [...mixed.keys()].map(codeOf);
  if (policy === "SINGLE_LOT") {
    throw AppError.conflict(`Bu siparişte her iplik tek lottan gider (lot kuralı: tek lot zorunlu) — ${names.join(", ")} için ikinci lot seçildi.`, {
      code: "WARPING_LOT_MIXED", yarns: names,
    });
  }
  return names.map((n) => `${n}: siparişte birden çok lot (ya da lotlu + lotsuz) karışıyor — aynı levende renk/boy farkı çıkabilir.`);
}

function openItems(items: WarpingYarnItem[]): WarpingYarnItem[] {
  return items.filter((i) => i.openKg.gt(0));
}

// ── Sevk ─────────────────────────────────────────────────────────────────────

const lineSig = (lines: Array<{ yarnItemId: string; warehouseId: string; lotId: string | null; qty: Prisma.Decimal.Value }>) =>
  lines.map((l) => `${l.yarnItemId}|${l.warehouseId}|${l.lotId ?? ""}|${D(l.qty).toFixed(3)}`).sort().join(",");

async function loadDispatchResult(dispatchId: string, warnings: string[], replayed: boolean): Promise<WarpingDispatchResult> {
  const d = await prisma.subcontractorDispatch.findUnique({
    where: { id: dispatchId },
    select: {
      id: true, dispatchNo: true, warpingOrderId: true, subcontractorId: true, dispatchedAt: true, expectedReturnAt: true,
      items: { select: { id: true, yarnItemId: true, warehouseId: true, lotId: true, dispatchedQty: true, yarnItem: { select: { code: true } }, lot: { select: { ownerCustomerId: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!d || !d.warpingOrderId) throw AppError.notFound("Sevk belgesi bulunamadı.");
  const order = await loadWarpingOrderDto(prisma, d.warpingOrderId);
  let total = D(0);
  for (const i of d.items) total = total.plus(i.dispatchedQty);
  return {
    dispatch: { id: d.id, dispatchNo: d.dispatchNo, warpingOrderId: d.warpingOrderId, subcontractorId: d.subcontractorId, dispatchedAt: d.dispatchedAt.toISOString(), expectedReturnAt: d.expectedReturnAt?.toISOString() ?? null },
    orderStatus: order.status,
    yarnItems: d.items.map((i) => ({ dispatchItemId: i.id, yarnItemId: i.yarnItemId!, code: i.yarnItem?.code ?? "", warehouseId: i.warehouseId!, lotId: i.lotId, qtyKg: kg(D(i.dispatchedQty)) })),
    yarnTotalKg: kg(total),
    ownerCustomerId: d.items.find((i) => i.lot?.ownerCustomerId)?.lot?.ownerCustomerId ?? null,
    instruction: buildWarpingInstruction(order),
    warnings,
    replayed,
  };
}

function dispatchReplay(warpingOrderId: string, input: WarpingDispatchInput) {
  const select = { id: true, dispatchNo: true, warpingOrderId: true, cancelledAt: true, items: { select: { yarnItemId: true, warehouseId: true, lotId: true, dispatchedQty: true } } } as const;
  type Hit = Prisma.SubcontractorDispatchGetPayload<{ select: typeof select }>;
  return tokenReplay<Hit, WarpingDispatchResult>({
    find: (db, clientToken) => db.subcontractorDispatch.findUnique({ where: { clientToken }, select }),
    alive: (hit) => {
      if (!hit.cancelledAt) return;
      throw AppError.conflict(`Bu sevk denemesi daha önce kaydedilmiş ve İPTAL edilmiş (${hit.dispatchNo}) — yeniden deneme yerine yeni sevk açın.`, { code: "DISPATCH_CANCELLED", dispatchId: hit.id });
    },
    identity: (hit) => [
      { ad: "warpingOrderId", mevcut: hit.warpingOrderId ?? "", gelen: warpingOrderId },
      { ad: "lines", mevcut: lineSig(hit.items.map((i) => ({ yarnItemId: i.yarnItemId ?? "", warehouseId: i.warehouseId ?? "", lotId: i.lotId, qty: i.dispatchedQty }))), gelen: lineSig(input.lines.map((l) => ({ yarnItemId: l.yarnItemId, warehouseId: l.warehouseId, lotId: l.lotId ?? null, qty: D(l.qtyKg).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP) }))) },
    ],
    collision: (hit) => `Bu işlem kimliği başka içerikli bir sevke (${hit.dispatchNo}) ait — formu yeniden açıp gönderin.`,
    respond: async (hit) => loadDispatchResult(hit.id, [], true),
  });
}

function validateLines(lines: WarpingDispatchLineInput[]): void {
  if (lines.length === 0) throw AppError.badRequest("Sevkte en az bir iplik satırı olmalı.", { code: "WARPING_DISPATCH_EMPTY" });
  if (lines.length > WARPING_DISPATCH_MAX_LINES) throw AppError.badRequest(`Bir sevkte en çok ${WARPING_DISPATCH_MAX_LINES} iplik satırı olabilir.`);
  const seen = new Set<string>();
  for (const l of lines) {
    const k = `${l.yarnItemId}|${l.warehouseId}|${l.lotId ?? ""}`;
    if (seen.has(k)) throw AppError.badRequest("Aynı iplik aynı depo ve lottan iki satır olamaz — miktarı tek satırda toplayın.", { code: "WARPING_DISPATCH_DUPLICATE_LINE" });
    seen.add(k);
  }
}

/** Sipariş claim'i (tx'in İLK ifadesi) + taze okuma; claim düşerse tanılı 409. */
async function claimForDispatchTx(tx: Tx, id: string, userId: string) {
  // İki yüklemli claim: önce OPEN → IN_PROGRESS (geçişi audit'e taşımak için ayrı), olmazsa IN_PROGRESS satırı kilitlenir.
  const opened = await tx.warpingOrder.updateMany({ where: { id, status: WarpingOrderStatus.OPEN }, data: { status: WarpingOrderStatus.IN_PROGRESS, updatedById: userId } });
  const claim = opened.count === 1 ? opened : await tx.warpingOrder.updateMany({ where: { id, status: { in: DISPATCHABLE } }, data: { status: WarpingOrderStatus.IN_PROGRESS, updatedById: userId } });
  const order = await sequentialTx(tx).warpingOrder.findUnique({
    where: { id },
    select: { id: true, orderNo: true, status: true, subcontractorId: true, expectedReturnAt: true, yarns: { select: { yarnItemId: true, grossKg: true, yarnItem: { select: { code: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!order) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  if (claim.count === 0) {
    throw AppError.conflict(`${order.orderNo} durumu ${order.status} — iplik sevki yapılamaz.`, { code: "WARPING_ORDER_NOT_DISPATCHABLE", status: order.status });
  }
  return { ...order, wasOpen: opened.count === 1 };
}

export async function dispatchWarpingOrder(id: string, input: WarpingDispatchInput, userId: string): Promise<WarpingDispatchResult> {
  validateLines(input.lines);
  return dispatchReplay(id, input).run(input.clientToken, async () => {
    const out = await prisma.$transaction(async (tx) => {
      const order = await claimForDispatchTx(tx, id, userId);
      const codeOf = (yarnItemId: string) => order.yarns.find((y) => y.yarnItemId === yarnItemId)?.yarnItem.code ?? yarnItemId;
      const offPlan = input.lines.find((l) => !order.yarns.some((y) => y.yarnItemId === l.yarnItemId));
      if (offPlan) throw AppError.badRequest("Plan dışı iplik sevk edilemez — yalnız siparişin iplik planındaki iplikler gider.", { code: "WARPING_YARN_NOT_IN_PLAN", yarnItemId: offPlan.yarnItemId });
      if (await readDevereLotRequired(tx)) {
        const lotless = input.lines.find((l) => !l.lotId);
        if (lotless) throw AppError.badRequest(`İplik lotu zorunlu — ${codeOf(lotless.yarnItemId)} satırında lot seçin.`, { code: "YARN_LOT_REQUIRED" });
      }
      const existing = openItems(await loadWarpingYarnItems(tx, { warpingOrderId: id }));
      const lotIds = [...new Set(input.lines.map((l) => l.lotId).filter((x): x is string => !!x))];
      const lots = lotIds.length > 0 ? await tx.yarnLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, ownerCustomerId: true } }) : [];
      const ownerOfLot = new Map(lots.map((l) => [l.id, l.ownerCustomerId]));
      // Tek sahip (S28): doğacak leventin sahibi bu siparişin ipliğinden kalıtılır — iki sahip ya da fabrika + emanet 409.
      const ownerCustomerId = singleOwner(
        [...existing.map((i) => i.ownerCustomerId), ...input.lines.map((l) => (l.lotId ? ownerOfLot.get(l.lotId) ?? null : null))],
        "Fason devere siparişi", { strict: true },
      );
      const warnings = lotPolicyVerdict(await readDevereFasonLotPolicy(tx), mixedLots([...existing, ...input.lines.map((l) => ({ yarnItemId: l.yarnItemId, lotId: l.lotId ?? null }))]), codeOf);
      const now = new Date();
      const dispatchNo = await nextSubcontractorDocNoTx(tx, "subcontractorDispatch", now);
      const expectedReturnAt = input.expectedReturnAt === undefined ? order.expectedReturnAt : input.expectedReturnAt === null ? null : new Date(input.expectedReturnAt);
      const dispatch = await tx.subcontractorDispatch.create({
        data: {
          dispatchNo, warpingOrderId: order.id, subcontractorId: order.subcontractorId, clientToken: input.clientToken ?? null,
          plateNumber: input.plateNumber ?? null, driverName: input.driverName ?? null, notes: input.notes ?? null,
          dispatchedById: userId, dispatchedAt: now, totalQty: 0, expectedReturnAt,
        },
        select: { id: true, dispatchNo: true },
      });
      const yarn = await dispatchYarnItemsTx(tx, {
        dispatchId: dispatch.id, userId,
        lines: input.lines.map((l) => ({ itemId: l.yarnItemId, warehouseId: l.warehouseId, lotId: l.lotId ?? null, qtyKg: l.qtyKg })),
      });
      // S10: plandan fazla gönderim meşru — bilgi uyarısı (fazlası deverecide kalır / iade edilir).
      const sums = sumByYarn(await loadWarpingYarnItems(tx, { warpingOrderId: id }));
      for (const y of order.yarns) {
        const s = sums.get(y.yarnItemId);
        const net = s ? s.outKg.minus(s.returnedKg) : D(0);
        if (net.gt(y.grossKg)) warnings.push(`${y.yarnItem.code}: plan ${kg(D(y.grossKg))} kg, gönderilen ${kg(net)} kg — fazla ${kg(net.minus(y.grossKg))} kg deverecide kalır ya da iade edilir.`);
      }
      await emitSubcontractDispatchedTx(tx, dispatch.id, userId);
      return { dispatch, yarn, ownerCustomerId, warnings, wasOpen: order.wasOpen, orderNo: order.orderNo };
    });
    await AuditService.log({
      userId, action: "CREATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: out.dispatch.id,
      newData: { dispatchNo: out.dispatch.dispatchNo, kind: "WARPING", warpingOrderId: id, yarnItemCount: out.yarn.lines.length, yarnTotalKg: out.yarn.totalKg.toString(), ownerCustomerId: out.ownerCustomerId },
    });
    if (out.wasOpen) {
      await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, oldData: { status: WarpingOrderStatus.OPEN }, newData: { status: WarpingOrderStatus.IN_PROGRESS, dispatchNo: out.dispatch.dispatchNo } });
    }
    return loadDispatchResult(out.dispatch.id, out.warnings, false);
  });
}

// ── Sevk önizlemesi ──────────────────────────────────────────────────────────

export interface WarpingDispatchPreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus; subcontractorId: string };
  lotPolicy: DevereFasonLotPolicy;
  lotRequired: boolean;
  ownerCustomerId: string | null;
  stock: { known: boolean };
  yarns: Array<{
    yarnItemId: string; code: string; name: string; letter: string; endsCount: number;
    planNetKg: string; planGrossKg: string;
    /** Bu siparişe gönderilen (BRÜT, iptaller hariç). */
    dispatchedKg: string;
    returnedKg: string;
    /** Bu siparişin deverecide duran ipliği. */
    atSubcontractorKg: string;
    /** Önerilen = plan brüt − (gönderilen − iade); eksiye inmez, yuvarlamasız. */
    suggestedKg: string;
    /** Depo serbest stoğu (iplik kapalıysa null = bilinmiyor). */
    depoKg: string | null;
    shortageKg: string | null;
    lots: Array<{ lotId: string | null; lotNo: string | null; openKg: string }>;
  }>;
  warnings: string[];
}

export async function previewWarpingDispatch(id: string): Promise<WarpingDispatchPreview> {
  const o = await loadWarpingOrderDto(prisma, id);
  const items = await loadWarpingYarnItems(prisma, { warpingOrderId: id });
  const sums = sumByYarn(items);
  const stock = await readYarnStock(o.yarns.map((y) => y.yarnItemId), { excludeHeld: true });
  const open = openItems(items);
  const warnings: string[] = [];
  let owner: string | null = null;
  try {
    owner = singleOwner(open.map((i) => i.ownerCustomerId), "Fason devere siparişi", { strict: true });
  } catch {
    warnings.push("Siparişin ipliğinde birden çok sahip var — sonraki sevk reddedilir; iade ile ayırın.");
  }
  const policy = await readDevereFasonLotPolicy();
  const mixed = mixedLots(open);
  if (mixed.size > 0 && policy !== "FREE") warnings.push(...[...mixed.keys()].map((y) => `${o.yarns.find((x) => x.yarnItemId === y)?.code ?? y}: siparişte birden çok lot var.`));
  return {
    order: { id: o.id, orderNo: o.orderNo, status: o.status, subcontractorId: o.subcontractor.id },
    lotPolicy: policy,
    lotRequired: await readDevereLotRequired(),
    ownerCustomerId: owner,
    stock: { known: stock !== null },
    yarns: o.yarns.map((y) => {
      const s = sums.get(y.yarnItemId) ?? { outKg: D(0), returnedKg: D(0), openKg: D(0) };
      const suggested = Prisma.Decimal.max(D(0), D(y.grossKg).minus(s.outKg.minus(s.returnedKg)));
      const depo = stock ? (stock.byItem.get(y.yarnItemId)?.serbestKg ?? D(0)) : null;
      const lotMap = new Map<string, { lotId: string | null; lotNo: string | null; openKg: Prisma.Decimal }>();
      for (const it of open.filter((i) => i.yarnItemId === y.yarnItemId)) {
        const cur = lotMap.get(lotKey(it.lotId)) ?? { lotId: it.lotId, lotNo: it.lotNo, openKg: D(0) };
        cur.openKg = cur.openKg.plus(it.openKg);
        lotMap.set(lotKey(it.lotId), cur);
      }
      return {
        yarnItemId: y.yarnItemId, code: y.code, name: y.name, letter: y.letter, endsCount: y.endsCount,
        planNetKg: y.netKg, planGrossKg: y.grossKg,
        dispatchedKg: kg(s.outKg), returnedKg: kg(s.returnedKg), atSubcontractorKg: kg(s.openKg), suggestedKg: kg(suggested),
        depoKg: depo ? kg(depo) : null,
        shortageKg: depo ? kg(Prisma.Decimal.max(D(0), suggested.minus(depo))) : null,
        lots: [...lotMap.values()].map((l) => ({ lotId: l.lotId, lotNo: l.lotNo, openKg: kg(l.openKg) })),
      };
    }),
    warnings,
  };
}
export async function getWarpingInstruction(id: string): Promise<WarpingInstruction> {
  return buildWarpingInstruction(await loadWarpingOrderDto(prisma, id));
}
