// =============================================================================
// FASON DEVERE SİPARİŞİ — önizleme · oluştur · düzenle (D4a)
// =============================================================================
// Plan SUNUCUDA hesaplanır (`plan.ts`) ve `WarpingOrderYarn`e donar. Oluşturma: replay R kipi (TEK boğaz
// `tokenReplay`) → tx: kod kapsamı kilidi İLK ifade (8029) → numara doğuşta → başlık + satırlar. Düzenleme:
// başlık claim'i (`updateMany WHERE {id, durum}`) İLK ifade; plan alanları yalnız OPEN (sevksiz) iken.
// =============================================================================
import { Currency, OrderStatus, Prisma, WarpingFeeUnit, WarpingOrderStatus } from "@prisma/client";
import { v5 as uuidv5 } from "uuid";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { lockCodeScopeTx } from "../helpers/code-unique.helper";
import { nextSeriesNo, resolveSeriesFormat, seriesPrefix } from "../number-series.service";
import { readDevereFasonWasteTolerancePct, readDevereWarpFixedWasteM } from "../system-setting.service";
import { readYarnStock } from "../helpers/maliyet-bridge.helper";
import { computeWarpingPlan, isBeamCountOpen, planTargetSig, planYarnRows, suggestExtraSpecs, type BeamLineInput, type PlanTargetInput, type WarpingPlan } from "./plan";
import { loadWarpingOrderDto, type WarpingOrderDto } from "./read";
import { expandWarpSequence, type WarpEndsSequence } from "../helpers/warp-sequence.helper";
import { WARPING_ORDER_TABLE } from "./table";
import { auditWarpingDispatch, claimForDispatchTx, dispatchClaimedWarpingOrderTx, dispatchInputSig, dispatchItemsSig, validateLines, type WarpingDispatchLineInput, type WarpingDispatchTxOut } from "./dispatch";

type Tx = Prisma.TransactionClient;
export { WARPING_ORDER_TABLE };
const CODE_SCOPE = "warpingOrder";
export const WARPING_ORDER_MAX_SALES_ORDERS = 50;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface WarpingOrderFeeInput {
  feeUnit?: WarpingFeeUnit;
  feeUnitPrice?: number | string | null;
  feeCurrency?: Currency | null;
}

export interface WarpingOrderCreateInput extends WarpingOrderFeeInput {
  clientToken?: string;
  warpSpecId: string;
  subcontractorId: string;
  beamLines?: BeamLineInput[];
  /** Levent adedi belli değil: yalnız toplam metre (`beamLines` ile birlikte verilmez). */
  openTargetLengthM?: number;
  extraWarpSpecIds?: string[];
  salesOrderIds?: string[];
  fixedWasteM?: number;
  wasteTolerancePct?: number | null;
  expectedReturnAt?: string | null;
  notes?: string | null;
  /** D2: sipariş açılırken ilk iplik sevki (aynı tx, elle sevkin kapıları); yoksa sevk doğmaz. */
  initialDispatch?: { lines: WarpingDispatchLineInput[] };
}

/** İlk sevkin token'ı siparişin token'ından belirlenimli türer — replay onu bulup kimliğe katar. */
const INITIAL_DISPATCH_TOKEN_NS = "6f1d2b8e-3c4a-4e57-9b1a-7d2e5c8f0a13";
export const initialDispatchToken = (orderToken: string): string => uuidv5(`${orderToken}|ilk-sevk`, INITIAL_DISPATCH_TOKEN_NS);

export interface WarpingOrderPatchInput extends WarpingOrderFeeInput {
  beamLines?: BeamLineInput[];
  openTargetLengthM?: number;
  extraWarpSpecIds?: string[];
  salesOrderIds?: string[];
  fixedWasteM?: number;
  wasteTolerancePct?: number | null;
  expectedReturnAt?: string | null;
  notes?: string | null;
}

async function resolveFixedWaste(v: number | undefined): Promise<Prisma.Decimal> {
  return D(v ?? (await readDevereWarpFixedWasteM())).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Tolerans: gövde verdiyse o (null = denetim yok); vermediyse ayar (0 = denetim yok → null). */
async function resolveTolerance(v: number | null | undefined): Promise<Prisma.Decimal | null> {
  if (v === null) return null;
  const n = v ?? (await readDevereFasonWasteTolerancePct());
  return n > 0 ? D(n).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
}

/** Ücret: fiyat varsa döviz zorunlu — verilmezse USD (müşteri belgesi $/m). Birim verilmezse fasoncunun son siparişindeki birim, yoksa METRE. */
async function resolveFee(db: Pick<Tx, "warpingOrder">, subcontractorId: string, input: WarpingOrderFeeInput): Promise<{ feeUnit: WarpingFeeUnit; feeUnitPrice: Prisma.Decimal | null; feeCurrency: Currency | null }> {
  let feeUnit = input.feeUnit;
  if (!feeUnit) {
    const last = await db.warpingOrder.findFirst({ where: { subcontractorId, status: { not: WarpingOrderStatus.CANCELLED } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { feeUnit: true } });
    feeUnit = last?.feeUnit ?? WarpingFeeUnit.METRE;
  }
  const price = input.feeUnitPrice == null ? null : D(input.feeUnitPrice);
  if (price && (!price.isFinite() || price.isNegative())) throw AppError.badRequest("Devere ücreti negatif olamaz.");
  return { feeUnit, feeUnitPrice: price, feeCurrency: price ? (input.feeCurrency ?? Currency.USD) : null };
}

async function assertSubcontractor(db: Pick<Tx, "subcontractor">, id: string): Promise<void> {
  const sub = await db.subcontractor.findUnique({ where: { id }, select: { isActive: true } });
  if (!sub) throw AppError.badRequest("Devereci (fason firma) bulunamadı.", { code: "SUBCONTRACTOR_NOT_FOUND" });
  if (!sub.isActive) throw AppError.badRequest("Devereci (fason firma) pasif — sipariş açılamaz.", { code: "SUBCONTRACTOR_INACTIVE" });
}

/** K3: bağlanacak müşteri siparişleri — var olmalı ve iptal edilmemiş olmalı. Boş liste = stoğa çözgü. */
async function resolveSalesOrders(db: Pick<Tx, "order">, ids: string[] | undefined): Promise<string[]> {
  const list = [...new Set(ids ?? [])];
  if (list.length > WARPING_ORDER_MAX_SALES_ORDERS) throw AppError.badRequest(`En çok ${WARPING_ORDER_MAX_SALES_ORDERS} müşteri siparişi bağlanabilir.`);
  if (list.length === 0) return list;
  const rows = await db.order.findMany({ where: { id: { in: list } }, select: { id: true, orderNumber: true, status: true } });
  if (rows.length !== list.length) throw AppError.badRequest("Bağlanacak müşteri siparişlerinden biri bulunamadı.", { code: "SALES_ORDER_NOT_FOUND" });
  const dead = rows.find((r) => r.status === OrderStatus.CANCELLED);
  if (dead) throw AppError.badRequest(`${dead.orderNumber} iptal edilmiş — devere siparişine bağlanamaz.`, { code: "SALES_ORDER_CANCELLED" });
  return list.sort();
}

function parseReturnAt(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest("Termin tarihi geçersiz.");
  return d;
}

export interface WarpingOrderPreview {
  warpSpec: WarpingPlan["spec"];
  /** Dizilim notunun tel tel açılımı (talimatla aynı fonksiyon); not yok/okunamaz → null. */
  endsSequence: WarpEndsSequence | null;
  extras: WarpingPlan["extras"];
  suggestedExtraSpecs: Array<{ id: string; code: string; name: string }>;
  beamLines: Array<{ beamCount: number; beamLengthM: string }>;
  beamCount: number | null;
  beamCountOpen: boolean;
  targetLengthM: string;
  fixedWasteM: string;
  hasWaste: boolean;
  wasteSources: WarpingPlan["wasteSources"];
  stock: { known: boolean; emanetAcik: boolean };
  yarns: Array<{ yarnItemId: string; code: string; name: string; sourceWarpSpecId: string; endsCount: number; denier: string; wastePct: string; wasteSource: WarpingPlan["yarns"][number]["wasteSource"]; specWastePct: string | null; netKg: string; grossKg: string; depoKg: string | null; emanetKg: string | null }>;
  totals: { netKg: string; grossKg: string };
}

/** Önizleme: yazmaz; aynı plan fonksiyonu + depo stoğu (iplik kapalıysa `null` = bilinmiyor) + SHARED_BEAM ek grup önerisi. */
export async function previewWarpingOrder(input: Pick<WarpingOrderCreateInput, "warpSpecId" | "beamLines" | "openTargetLengthM" | "extraWarpSpecIds" | "fixedWasteM">): Promise<WarpingOrderPreview> {
  const fixed = await resolveFixedWaste(input.fixedWasteM);
  const plan = await computeWarpingPlan(prisma, { warpSpecId: input.warpSpecId, extraWarpSpecIds: input.extraWarpSpecIds ?? [], beamLines: input.beamLines, openTargetLengthM: input.openTargetLengthM, fixedWasteM: fixed });
  const suggested = (await suggestExtraSpecs(prisma, input.warpSpecId)).filter((s) => !plan.extras.some((e) => e.id === s.id));
  const stock = await readYarnStock(plan.yarns.map((y) => y.yarnItemId), { excludeHeld: true });
  let net = D(0);
  let gross = D(0);
  return {
    warpSpec: plan.spec,
    endsSequence: expandWarpSequence(plan.spec.sequenceNote, plan.yarns.map((y) => y.endsCount)),
    extras: plan.extras,
    suggestedExtraSpecs: suggested,
    beamLines: plan.beamLines.map((l) => ({ beamCount: l.beamCount, beamLengthM: l.beamLengthM.toFixed(3) })),
    beamCount: plan.beamCount,
    beamCountOpen: isBeamCountOpen(plan.beamCount),
    targetLengthM: plan.targetLengthM.toFixed(3),
    fixedWasteM: fixed.toFixed(2),
    hasWaste: plan.hasWaste,
    wasteSources: plan.wasteSources,
    stock: { known: stock !== null, emanetAcik: stock?.emanetAcik ?? false },
    yarns: plan.yarns.map((y) => {
      net = net.plus(y.netKg);
      gross = gross.plus(y.grossKg);
      const s = stock?.byItem.get(y.yarnItemId);
      return {
        yarnItemId: y.yarnItemId, code: y.code, name: y.name, sourceWarpSpecId: y.sourceWarpSpecId, endsCount: y.endsCount,
        denier: y.denier.toString(), wastePct: y.wastePct.toFixed(2), wasteSource: y.wasteSource, specWastePct: y.specWastePct?.toFixed(2) ?? null, netKg: y.netKg.toFixed(3), grossKg: y.grossKg.toFixed(3),
        depoKg: stock ? (s?.serbestKg ?? D(0)).toFixed(3) : null,
        emanetKg: s?.emanetKg == null ? null : s.emanetKg.toFixed(3),
      };
    }),
    totals: { netKg: net.toFixed(3), grossKg: gross.toFixed(3) },
  };
}

export interface CreateWarpingOrderResult {
  data: WarpingOrderDto;
  /** D2: siparişle doğan ilk sevk (yoksa null). */
  initialDispatch: { id: string; dispatchNo: string; yarnTotalKg: string } | null;
  warnings: string[];
  replayed: boolean;
}

const INITIAL_DISPATCH_SELECT = {
  id: true, dispatchNo: true, cancelledAt: true,
  items: { select: { yarnItemId: true, warehouseId: true, lotId: true, dispatchedQty: true, packageCount: true, bobbinCount: true } },
} as const;
type InitialDispatchHit = Prisma.SubcontractorDispatchGetPayload<{ select: typeof INITIAL_DISPATCH_SELECT }>;

function findInitialDispatch(db: Pick<Tx, "subcontractorDispatch">, orderToken: string | null | undefined): Promise<InitialDispatchHit | null> {
  if (!orderToken) return Promise.resolve(null);
  return db.subcontractorDispatch.findUnique({ where: { clientToken: initialDispatchToken(orderToken) }, select: INITIAL_DISPATCH_SELECT });
}

const initialDispatchRef = (d: InitialDispatchHit | null) => {
  if (!d) return null;
  let total = D(0);
  for (const i of d.items) total = total.plus(i.dispatchedQty);
  return { id: d.id, dispatchNo: d.dispatchNo, yarnTotalKg: total.toFixed(3) };
};

interface PriorOrder {
  id: string;
  orderNo: string;
  status: WarpingOrderStatus;
  warpSpecId: string;
  subcontractorId: string;
  beamCount: number | null;
  targetLengthM: Prisma.Decimal;
  beamLines: Array<{ beamCount: number; beamLengthM: Prisma.Decimal }>;
  extraSpecs: Array<{ warpSpecId: string }>;
  salesOrders: Array<{ orderId: string }>;
  initial: InitialDispatchHit | null;
}

/** Saklı siparişin hedef girdisi (açık adet ↔ satırlar) — düzenleme ve replay imzası aynı yerden. */
const storedTarget = (p: { beamCount: number | null; targetLengthM: Prisma.Decimal; beamLines: Array<{ beamCount: number; beamLengthM: Prisma.Decimal }> }): PlanTargetInput =>
  isBeamCountOpen(p.beamCount) ? { openTargetLengthM: p.targetLengthM.toString() } : { beamLines: p.beamLines.map((l) => ({ beamCount: l.beamCount, beamLengthM: l.beamLengthM.toString() })) };
/** Gelen gövdenin imzası; geçersiz gövde imzası boş (asıl 400'ü plan hesabı verir). */
const inputSig = (input: PlanTargetInput): string => {
  try { return planTargetSig(input); } catch { return ""; }
};

function replayFor(input: WarpingOrderCreateInput) {
  return tokenReplay<PriorOrder, CreateWarpingOrderResult>({
    find: async (db, clientToken) => {
      const order = await db.warpingOrder.findUnique({
        where: { clientToken },
        select: {
          id: true, orderNo: true, status: true, warpSpecId: true, subcontractorId: true, beamCount: true, targetLengthM: true,
          beamLines: { select: { beamCount: true, beamLengthM: true }, orderBy: { sortOrder: "asc" } },
          extraSpecs: { select: { warpSpecId: true }, orderBy: { sortOrder: "asc" } },
          salesOrders: { select: { orderId: true } },
        },
      });
      return order ? { ...order, initial: await findInitialDispatch(db, clientToken) } : null;
    },
    alive: (p) => {
      if (p.status === WarpingOrderStatus.CANCELLED) {
        throw AppError.conflict(`Bu form daha önce kaydedilmiş ve sipariş İPTAL edilmiş (${p.orderNo}) — yeni sipariş için formu kapatıp yeniden açın.`, { code: "WARPING_ORDER_CANCELLED", warpingOrderId: p.id, orderNo: p.orderNo });
      }
      // 4. durum: siparişle doğan ilk sevk sonradan iptal edildiyse "zaten kayıtlı" demek yanlış cevaptır.
      if (p.initial?.cancelledAt) {
        throw AppError.conflict(`Bu form daha önce kaydedilmiş (${p.orderNo}) ama ilk iplik sevki ${p.initial.dispatchNo} İPTAL edilmiş — sevki sipariş sayfasından yeniden açın.`, { code: "DISPATCH_CANCELLED", warpingOrderId: p.id, dispatchId: p.initial.id });
      }
    },
    identity: (p) => [
      { ad: "warpSpecId", mevcut: p.warpSpecId, gelen: input.warpSpecId },
      { ad: "subcontractorId", mevcut: p.subcontractorId, gelen: input.subcontractorId },
      { ad: "beamLines", mevcut: planTargetSig(storedTarget(p)), gelen: inputSig(input) },
      { ad: "extraWarpSpecIds", mevcut: p.extraSpecs.map((e) => e.warpSpecId).join(","), gelen: (input.extraWarpSpecIds ?? []).join(",") },
      { ad: "salesOrderIds", mevcut: p.salesOrders.map((s) => s.orderId).sort().join(","), gelen: [...new Set(input.salesOrderIds ?? [])].sort().join(",") },
      // D2: ilk sevk satırları kimliğe girer (sevksiz ↔ sevksiz boş imza; eski istemci etkilenmez).
      { ad: "initialDispatch", mevcut: p.initial ? dispatchItemsSig(p.initial.items) : "", gelen: input.initialDispatch ? dispatchInputSig(input.initialDispatch.lines) : "" },
    ],
    collision: (p) => `Bu işlem kimliği başka içerikli bir devere siparişine (${p.orderNo}) ait — formu yeniden açıp gönderin.`,
    respond: async (p) => ({ data: await loadWarpingOrderDto(prisma, p.id), initialDispatch: initialDispatchRef(p.initial), warnings: [], replayed: true }),
  });
}

export async function createWarpingOrder(input: WarpingOrderCreateInput, userId: string): Promise<CreateWarpingOrderResult> {
  if (input.initialDispatch) validateLines(input.initialDispatch.lines);
  return replayFor(input).run(input.clientToken, async () => {
    await assertSubcontractor(prisma, input.subcontractorId);
    const salesOrderIds = await resolveSalesOrders(prisma, input.salesOrderIds);
    const fixed = await resolveFixedWaste(input.fixedWasteM);
    const tolerance = await resolveTolerance(input.wasteTolerancePct);
    const fee = await resolveFee(prisma, input.subcontractorId, input);
    const out = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const fmt = resolveSeriesFormat(CODE_SCOPE);
      await lockCodeScopeTx(tx, CODE_SCOPE, seriesPrefix(fmt, now));
      const plan = await computeWarpingPlan(tx, { warpSpecId: input.warpSpecId, extraWarpSpecIds: input.extraWarpSpecIds ?? [], beamLines: input.beamLines, openTargetLengthM: input.openTargetLengthM, fixedWasteM: fixed });
      const orderNo = await nextSeriesNo(CODE_SCOPE, async (prefix) =>
        tx.warpingOrder
          .findMany({ where: { orderNo: { gte: prefix, startsWith: prefix } }, select: { orderNo: true, createdAt: true } })
          .then((rows) => rows.map((x) => ({ code: x.orderNo, createdAt: x.createdAt }))), now, fmt);
      const header = await tx.warpingOrder.create({
        data: {
          orderNo, clientToken: input.clientToken ?? null, warpSpecId: plan.spec.id, subcontractorId: input.subcontractorId,
          beamCount: plan.beamCount, targetLengthM: plan.targetLengthM, fixedWasteM: fixed, wasteTolerancePct: tolerance,
          ...fee, expectedReturnAt: parseReturnAt(input.expectedReturnAt) ?? null, notes: input.notes ?? null,
          createdById: userId, updatedById: userId,
        },
        select: { id: true },
      });
      await writePlanChildrenTx(tx, header.id, plan);
      if (salesOrderIds.length > 0) await tx.warpingOrderToOrder.createMany({ data: salesOrderIds.map((orderId) => ({ warpingOrderId: header.id, orderId })) });
      // D2: ilk sevk AYNI tx'te, elle sevkin yolu (claim → plan dışı 400 → lot kuralı → tek sahip); düşerse sipariş de doğmaz.
      let dispatch: WarpingDispatchTxOut | null = null;
      if (input.initialDispatch) {
        dispatch = await dispatchClaimedWarpingOrderTx(tx, await claimForDispatchTx(tx, header.id, userId), {
          clientToken: input.clientToken ? initialDispatchToken(input.clientToken) : undefined,
          lines: input.initialDispatch.lines,
        }, { userId });
      }
      return { id: header.id, orderNo, plan, salesOrderIds, dispatch };
    });
    await AuditService.log({
      userId, action: "CREATE", tableName: WARPING_ORDER_TABLE, recordId: out.id,
      newData: { orderNo: out.orderNo, warpSpecId: input.warpSpecId, subcontractorId: input.subcontractorId, ...auditPlan(out.plan), salesOrderIds: out.salesOrderIds, fixedWasteM: fixed.toString(), wasteTolerancePct: tolerance?.toString() ?? null, ...auditFee(fee), initialDispatchNo: out.dispatch?.dispatch.dispatchNo ?? null },
    });
    if (out.dispatch) await auditWarpingDispatch(out.id, out.dispatch, userId);
    return {
      data: await loadWarpingOrderDto(prisma, out.id),
      initialDispatch: out.dispatch ? { id: out.dispatch.dispatch.id, dispatchNo: out.dispatch.dispatch.dispatchNo, yarnTotalKg: out.dispatch.yarn.totalKg.toFixed(3) } : null,
      warnings: out.dispatch?.warnings ?? [],
      replayed: false,
    };
  });
}

async function writePlanChildrenTx(tx: Tx, warpingOrderId: string, plan: WarpingPlan): Promise<void> {
  await tx.warpingOrderBeamLine.createMany({ data: plan.beamLines.map((l) => ({ warpingOrderId, beamCount: l.beamCount, beamLengthM: l.beamLengthM, sortOrder: l.sortOrder })) });
  await tx.warpingOrderYarn.createMany({ data: planYarnRows(warpingOrderId, plan) });
  if (plan.extras.length > 0) await tx.warpingOrderExtraSpec.createMany({ data: plan.extras.map((e, i) => ({ warpingOrderId, warpSpecId: e.id, sortOrder: i })) });
}

function auditPlan(plan: WarpingPlan) {
  return {
    beamLines: plan.beamLines.map((l) => ({ beamCount: l.beamCount, beamLengthM: l.beamLengthM.toString() })),
    beamCount: plan.beamCount,
    targetLengthM: plan.targetLengthM.toString(),
    extraWarpSpecIds: plan.extras.map((e) => e.id),
    yarns: plan.yarns.map((y) => ({ yarnItemId: y.yarnItemId, endsCount: y.endsCount, netKg: y.netKg.toString(), grossKg: y.grossKg.toString() })),
  };
}
const auditFee = (fee: { feeUnit: WarpingFeeUnit; feeUnitPrice: Prisma.Decimal | null; feeCurrency: Currency | null }) => ({ feeUnit: fee.feeUnit, feeUnitPrice: fee.feeUnitPrice?.toString() ?? null, feeCurrency: fee.feeCurrency });

const PLAN_FIELDS = ["beamLines", "openTargetLengthM", "extraWarpSpecIds", "fixedWasteM"] as const;

/**
 * Düzenleme. Plan alanları (levent satırları · ek tel grubu · sabit fire) YALNIZ OPEN (sevksiz) iken — plan ilk sevkte
 * donar. Not, termin, ücret, tolerans ve müşteri siparişi bağı OPEN/IN_PROGRESS'te değişir. Kart ve devereci değişmez
 * (iptal edip yeni sipariş açılır). Claim İLK ifade: sevk aynı satırı claim ettiği için yarışta biri bekler.
 */
export async function patchWarpingOrder(id: string, input: WarpingOrderPatchInput, userId: string): Promise<WarpingOrderDto> {
  const touchesPlan = PLAN_FIELDS.some((k) => input[k] !== undefined);
  const allowed = touchesPlan ? [WarpingOrderStatus.OPEN] : [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS];
  const salesOrderIds = input.salesOrderIds === undefined ? undefined : await resolveSalesOrders(prisma, input.salesOrderIds);
  const fixed = input.fixedWasteM === undefined ? undefined : await resolveFixedWaste(input.fixedWasteM);
  const tolerance = input.wasteTolerancePct === undefined ? undefined : await resolveTolerance(input.wasteTolerancePct);
  const before = await loadWarpingOrderDto(prisma, id);
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.warpingOrder.updateMany({ where: { id, status: { in: allowed } }, data: { updatedById: userId } });
    const fresh = await sequentialTx(tx).warpingOrder.findUnique({
      where: { id },
      select: { id: true, orderNo: true, status: true, warpSpecId: true, subcontractorId: true, fixedWasteM: true, feeUnit: true, feeUnitPrice: true, feeCurrency: true, beamCount: true, targetLengthM: true, beamLines: { select: { beamCount: true, beamLengthM: true }, orderBy: { sortOrder: "asc" } }, extraSpecs: { select: { warpSpecId: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!fresh) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
    if (claim.count === 0) {
      const why = touchesPlan && fresh.status === WarpingOrderStatus.IN_PROGRESS
        ? "iplik sevki yapılmış — plan (levent satırları, ek tel grubu, sabit fire) donmuştur; değiştirmek için sevki iptal edin"
        : `durumu ${fresh.status} — düzenlenemez`;
      throw AppError.conflict(`${fresh.orderNo} ${why}.`, { code: "WARPING_ORDER_NOT_EDITABLE", status: fresh.status });
    }
    const data: Prisma.WarpingOrderUpdateInput = {};
    let plan: WarpingPlan | null = null;
    if (touchesPlan) {
      // Hedef girdisi gövdede yoksa saklı mod korunur (açık adet → eski toplam; satırlı → eski satırlar).
      const target: PlanTargetInput = input.beamLines !== undefined || input.openTargetLengthM !== undefined
        ? { beamLines: input.beamLines, openTargetLengthM: input.openTargetLengthM }
        : storedTarget(fresh);
      plan = await computeWarpingPlan(tx, {
        warpSpecId: fresh.warpSpecId,
        extraWarpSpecIds: input.extraWarpSpecIds ?? fresh.extraSpecs.map((e) => e.warpSpecId),
        ...target,
        fixedWasteM: fixed ?? fresh.fixedWasteM,
      });
      // ③b saf yapılandırma pivotları: plan satırları REPLACE (audit eski/yeni küme).
      await tx.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: id } });
      await tx.warpingOrderYarn.deleteMany({ where: { warpingOrderId: id } });
      await tx.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: id } });
      await writePlanChildrenTx(tx, id, plan);
      data.beamCount = plan.beamCount;
      data.targetLengthM = plan.targetLengthM;
      if (fixed !== undefined) data.fixedWasteM = fixed;
    }
    if (tolerance !== undefined) data.wasteTolerancePct = tolerance;
    if (input.feeUnit !== undefined || input.feeUnitPrice !== undefined || input.feeCurrency !== undefined) {
      const fee = await resolveFee(tx, fresh.subcontractorId, {
        feeUnit: input.feeUnit ?? fresh.feeUnit,
        feeUnitPrice: input.feeUnitPrice !== undefined ? input.feeUnitPrice : fresh.feeUnitPrice?.toString() ?? null,
        feeCurrency: input.feeCurrency !== undefined ? input.feeCurrency : fresh.feeCurrency,
      });
      Object.assign(data, fee);
    }
    const ret = parseReturnAt(input.expectedReturnAt);
    if (ret !== undefined) data.expectedReturnAt = ret;
    if (input.notes !== undefined) data.notes = input.notes;
    if (Object.keys(data).length > 0) await tx.warpingOrder.update({ where: { id }, data });
    if (salesOrderIds !== undefined) {
      await tx.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: id } });
      if (salesOrderIds.length > 0) await tx.warpingOrderToOrder.createMany({ data: salesOrderIds.map((orderId) => ({ warpingOrderId: id, orderId })) });
    }
    return { plan };
  });
  const after = await loadWarpingOrderDto(prisma, id);
  await AuditService.log({
    userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id,
    oldData: { beamLines: before.beamLines, beamCount: before.beamCount, targetLengthM: before.targetLengthM, extraSpecs: before.extraSpecs.map((e) => e.id), salesOrders: before.salesOrders.map((s) => s.id), yarns: before.yarns.map((y) => ({ yarnItemId: y.yarnItemId, endsCount: y.endsCount, netKg: y.netKg, grossKg: y.grossKg })), fixedWasteM: before.fixedWasteM, wasteTolerancePct: before.wasteTolerancePct, fee: before.fee, expectedReturnAt: before.expectedReturnAt, notes: before.notes },
    newData: { ...(result.plan ? auditPlan(result.plan) : {}), salesOrders: after.salesOrders.map((s) => s.id), fixedWasteM: after.fixedWasteM, wasteTolerancePct: after.wasteTolerancePct, fee: after.fee, expectedReturnAt: after.expectedReturnAt, notes: after.notes },
  });
  return after;
}
