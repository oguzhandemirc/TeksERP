// =============================================================================
// DEVERE A1 — BEKLENEN DEVERE ÜCRETİ (tek kaynak) + "kabul edilen sarım" yüklemi
// =============================================================================
// K2: beklenen = siparişin DONUK `feeUnitPrice` × ölçü (METRE Σ lengthM · KG Σ nominal kg · ENDS_METRE Σ tel × metre);
// fiyatsız sipariş → tutar `null` (ücretsiz ≠ 0 uydurulmaz). K3: "kabul edilen sarım" = WOUND'u geri alınmamış devere
// leventi, reddedilmemiş (C1, `warping-beam-rejection.helper`); bellek-içi `isAcceptedWarpingBeam` ↔ Prisma
// `ACCEPTED_WARPING_BEAM_WHERE` BOĞAZ-İKİZ (bekçi `test_fason_devere_fatura` ikizin eşitliğini ölçer). Yeniden sarım
// (`reworkOfBeamId` dolu) `devere.reworkBillable=false` iken beklenen dışında kalır. YALNIZ OKUR.
// =============================================================================
import { InvoiceStatus, Prisma, WarpBeamOrigin, WarpingFeeUnit, type Currency, type WarpBeamStatus, type WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { sequentialTx } from "./tx-sequential-relations.helper";
import { isRejectedBeam, NOT_REJECTED_BEAM_WHERE } from "./warping-beam-rejection.helper";

type Db = Prisma.TransactionClient | typeof prisma;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

/** K3 Prisma parçası — devere doğumlu, WOUND'u geri alınmamış ve reddedilmemiş levent. */
export const ACCEPTED_WARPING_BEAM_WHERE = {
  warpingOrderId: { not: null },
  events: { some: { kind: "WOUND", reversal: { is: null } } },
  ...NOT_REJECTED_BEAM_WHERE,
} satisfies Prisma.WarpBeamWhereInput;

/**
 * Levent dışarıdan hazır mı geldi (satın alınan / emanet) → sarımı bizde yazılmadı, devere ve iplik maliyeti bilinmez.
 * Köken YALNIZ `originKind`ten: `ownerCustomerId` mülkiyet eksenidir, devere kabulü onu müşteri ipliği lotundan kalıtır.
 */
export function isBoughtOrConsignedBeam(originKind: WarpBeamOrigin): boolean {
  return originKind === WarpBeamOrigin.PURCHASED || originKind === WarpBeamOrigin.CONSIGNED;
}

/** K3 bellek-içi ikiz —`ACCEPTED_WARPING_BEAM_WHERE` ile aynı soruyu cevaplar. */
export function isAcceptedWarpingBeam(b: { warpingOrderId: string | null; status: WarpBeamStatus; events: ReadonlyArray<{ kind: string; reversal: { id: string } | null }> }): boolean {
  return b.warpingOrderId !== null && b.events.some((e) => e.kind === "WOUND" && e.reversal === null) && !isRejectedBeam(b);
}

export interface WarpingWoundMeasure { lengthM: Prisma.Decimal | null; theoreticalKg: Prisma.Decimal | null; endsCount: number | null }

/** K2 ölçü — ücret biriminin bir sarımdaki miktarı. */
export function warpingFeeQty(unit: WarpingFeeUnit, w: WarpingWoundMeasure): Prisma.Decimal {
  const m = D(w.lengthM ?? 0);
  if (unit === WarpingFeeUnit.KG) return D(w.theoreticalKg ?? 0);
  if (unit === WarpingFeeUnit.ENDS_METRE) return m.mul(w.endsCount ?? 0);
  return m;
}

/** Ücret birimi → fatura satırı birimi. */
export const WARPING_FEE_LINE_UNIT: Record<WarpingFeeUnit, string> = { METRE: "m", KG: "kg", ENDS_METRE: "tel×m" };

const BEAM_SELECT = {
  id: true, beamNo: true, status: true, warpingOrderId: true, warpingReceiptKey: true, reworkOfBeamId: true,
  events: { where: { kind: "WOUND" }, select: { kind: true, lengthM: true, theoreticalKg: true, endsCount: true, deliveryNoteNo: true, createdAt: true, reversal: { select: { id: true } } } },
} satisfies Prisma.WarpBeamSelect;

const ORDER_SELECT = {
  id: true, orderNo: true, status: true, feeUnit: true, feeUnitPrice: true, feeCurrency: true,
  warpSpec: { select: { name: true } },
  subcontractor: { select: { id: true, name: true, customerId: true } },
} satisfies Prisma.WarpingOrderSelect;

export interface WarpingReceiptInvoiceRef { id: string; docNo: string; status: InvoiceStatus; clientToken: string | null }

export interface WarpingReceiptFee {
  receiptKey: string;
  warpingOrderId: string;
  deliveryNoteNo: string | null;
  receivedAt: Date;
  /** Kabul edilen (K3) sarım adedi; 0 = kabul tamamen geri alınmış. */
  beamCount: number;
  lengthM: Prisma.Decimal;
  qty: Prisma.Decimal;
  /** null = siparişte ücret yok. */
  expectedAmount: Prisma.Decimal | null;
  /** İptal edilmemiş bağlı fatura (kabul başına en çok bir). */
  invoice: WarpingReceiptInvoiceRef | null;
  /** Kabul edilen sarımlar: levent başı sarım metresi + ücret ölçüsü (bedelsiz yeniden sarımda 0) — gerçek maliyet paylaştırması. */
  beams: Array<{ beamId: string; lengthM: Prisma.Decimal; qty: Prisma.Decimal }>;
}

export interface WarpingOrderFee {
  id: string;
  orderNo: string;
  status: WarpingOrderStatus;
  warpSpecName: string;
  subcontractor: { id: string; name: string; customerId: string | null };
  feeUnit: WarpingFeeUnit;
  feeUnitPrice: Prisma.Decimal | null;
  feeCurrency: Currency | null;
  /** Kabul edilen sarımı olan kabuller (eski → yeni). */
  receipts: WarpingReceiptFee[];
}

/**
 * Siparişlerin (ya da kabul anahtarlarının) beklenen ücret dökümü. `reworkBillable` çağıranın okuduğu ayardır
 * (`readDevereReworkBillable`); yeniden sarım = `reworkOfBeamId` dolu sarım (C1).
 */
export async function loadWarpingOrderFeesTx(
  db: Db,
  scope: { orderIds?: string[]; receiptKeys?: string[] },
  opts: { reworkBillable: boolean },
): Promise<WarpingOrderFee[]> {
  const beamWhere: Prisma.WarpBeamWhereInput = scope.receiptKeys
    ? { warpingReceiptKey: { in: scope.receiptKeys }, warpingOrderId: { not: null } }
    : { warpingOrderId: { in: scope.orderIds ?? [] } };
  const beams = await sequentialTx(db).warpBeam.findMany({ where: beamWhere, select: BEAM_SELECT, orderBy: { beamNo: "asc" } });
  const orderIds = [...new Set([...(scope.orderIds ?? []), ...beams.map((b) => b.warpingOrderId!)])];
  const orders = await db.warpingOrder.findMany({ where: { id: { in: orderIds } }, select: ORDER_SELECT, orderBy: { orderNo: "asc" } });
  const keys = [...new Set(beams.map((b) => b.warpingReceiptKey).filter((k): k is string => !!k))];
  const links = keys.length === 0 ? [] : await db.invoiceToWarpingReceipt.findMany({
    where: { warpingReceiptKey: { in: keys }, invoice: { status: { not: InvoiceStatus.CANCELLED } } },
    select: { warpingReceiptKey: true, invoice: { select: { id: true, docNo: true, status: true, clientToken: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invByKey = new Map(links.map((l) => [l.warpingReceiptKey, l.invoice]));
  return orders.map((o) => {
    const byKey = new Map<string, WarpingReceiptFee>();
    for (const b of beams) {
      if (b.warpingOrderId !== o.id || !b.warpingReceiptKey || !isAcceptedWarpingBeam(b)) continue;
      const w = b.events.find((e) => e.reversal === null)!;
      const isRework = b.reworkOfBeamId !== null;
      const r = byKey.get(b.warpingReceiptKey) ?? {
        receiptKey: b.warpingReceiptKey, warpingOrderId: o.id, deliveryNoteNo: w.deliveryNoteNo, receivedAt: w.createdAt,
        beamCount: 0, lengthM: ZERO, qty: ZERO, expectedAmount: null, invoice: invByKey.get(b.warpingReceiptKey) ?? null, beams: [],
      };
      const beamQty = !isRework || opts.reworkBillable ? warpingFeeQty(o.feeUnit, w) : ZERO;
      r.beamCount += 1;
      r.lengthM = r.lengthM.plus(w.lengthM ?? 0);
      r.qty = r.qty.plus(beamQty);
      r.beams.push({ beamId: b.id, lengthM: D(w.lengthM ?? 0), qty: beamQty });
      if (w.createdAt < r.receivedAt) r.receivedAt = w.createdAt;
      byKey.set(b.warpingReceiptKey, r);
    }
    const receipts = [...byKey.values()]
      .map((r) => ({ ...r, expectedAmount: o.feeUnitPrice ? r.qty.mul(o.feeUnitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null }))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.receiptKey.localeCompare(b.receiptKey));
    return {
      id: o.id, orderNo: o.orderNo, status: o.status, warpSpecName: o.warpSpec.name, subcontractor: o.subcontractor,
      feeUnit: o.feeUnit, feeUnitPrice: o.feeUnitPrice, feeCurrency: o.feeCurrency, receipts,
    };
  });
}

export type WarpingFeeInvoiceState = "NONE" | "PARTIAL" | "FULL";

/** Siparişin fatura durumu — yalnız kabul edilen sarımı olan kabuller sayılır; kabulsüz sipariş null. */
export function warpingFeeInvoiceState(receipts: ReadonlyArray<{ invoice: unknown }>): WarpingFeeInvoiceState | null {
  if (receipts.length === 0) return null;
  const billed = receipts.filter((r) => r.invoice !== null).length;
  return billed === 0 ? "NONE" : billed === receipts.length ? "FULL" : "PARTIAL";
}

/** Liste süzgeci `filter[feeInvoiced]` — durumları verilen sipariş kimlikleri (aynı K3 yüklemi; süzme sunucuda). */
export async function warpingOrderIdsByFeeState(db: Db, states: WarpingFeeInvoiceState[]): Promise<string[]> {
  const beams = await db.warpBeam.findMany({ where: ACCEPTED_WARPING_BEAM_WHERE, select: { warpingOrderId: true, warpingReceiptKey: true }, distinct: ["warpingReceiptKey"] });
  const keys = beams.map((b) => b.warpingReceiptKey).filter((k): k is string => !!k);
  const billed = new Set((await db.invoiceToWarpingReceipt.findMany({
    where: { warpingReceiptKey: { in: keys }, invoice: { status: { not: InvoiceStatus.CANCELLED } } },
    select: { warpingReceiptKey: true },
  })).map((l) => l.warpingReceiptKey));
  const per = new Map<string, Array<{ invoice: unknown }>>();
  for (const b of beams) {
    if (!b.warpingOrderId || !b.warpingReceiptKey) continue;
    per.set(b.warpingOrderId, [...(per.get(b.warpingOrderId) ?? []), { invoice: billed.has(b.warpingReceiptKey) ? true : null }]);
  }
  return [...per.entries()].filter(([, rs]) => states.includes(warpingFeeInvoiceState(rs)!)).map(([id]) => id);
}
