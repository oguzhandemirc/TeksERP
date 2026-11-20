// =============================================================================
// FASON DEVERE SİPARİŞİ — dönen levent KABULLERİ okuyucusu (D5a): kabul = aynı `warpingReceiptKey`li leventler
// =============================================================================
// Kabul yanıtı, replay yanıtı ve sipariş sayfasının "Dönen leventler" bölümü aynı DTO'yu okur; mutabakat sayıları
// `warping-settlement.helper`dan (istemci sayı türetmez).
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { loadOrderBeams, loadWarpingSettlement, weighedNetKg, type WarpingSettlement } from "../helpers/warping-settlement.helper";

type Db = Prisma.TransactionClient;
const kg = (v: Prisma.Decimal.Value | null) => (v === null ? null : new Prisma.Decimal(v).toFixed(3));

export interface WarpingReceiptBeamDto {
  id: string; beamNo: string; status: WarpBeamStatus; physicalBeamNo: string | null; ownerCustomerId: string | null;
  lengthM: string | null; nominalKg: string | null; grossKg: string | null; tareKg: string | null;
  /** Tartı net − hesap (yalnız bilgi). */
  weighedNetKg: string | null; weighDiffKg: string | null;
  cancelled: boolean;
  /** C1: reddedilen sarımın yeniden sarımıysa onun kimliği. */
  reworkOfBeamId: string | null;
  yarns: Array<{ yarnItemId: string; kg: string; allocations: Array<{ dispatchItemId: string; holderWarpingOrderId: string; carryOver: boolean; kg: string }> }>;
}
export interface WarpingReceiptSummaryDto {
  receiptKey: string; deliveryNoteNo: string | null; receivedAt: string; beamCount: number; liveBeamCount: number; lengthM: string;
  beams: WarpingReceiptBeamDto[];
}
export interface WarpingReceiptDto extends WarpingReceiptSummaryDto {
  warpingOrderId: string;
  settlement: WarpingSettlement;
  warnings: string[];
}

type BeamRow = Awaited<ReturnType<typeof loadOrderBeams>>[number];

function beamDto(b: BeamRow, orderId: string): WarpingReceiptBeamDto {
  const ev = b.events[0] ?? null;
  const net = ev ? weighedNetKg(ev) : null;
  return {
    id: b.id, beamNo: b.beamNo, status: b.status, physicalBeamNo: b.physicalBeamNo, ownerCustomerId: b.ownerCustomerId,
    lengthM: kg(ev?.lengthM ?? null), nominalKg: kg(ev?.theoreticalKg ?? null), grossKg: kg(ev?.grossKg ?? null), tareKg: kg(ev?.tareKg ?? null),
    weighedNetKg: kg(net), weighDiffKg: net && ev?.theoreticalKg ? kg(net.minus(ev.theoreticalKg)) : null,
    cancelled: !!ev?.reversal,
    reworkOfBeamId: b.reworkOfBeamId,
    yarns: (ev?.yarns ?? []).map((y) => ({
      yarnItemId: y.yarnItemId, kg: kg(y.theoreticalKg)!,
      allocations: y.allocations.map((a) => ({ dispatchItemId: a.dispatchItemId, holderWarpingOrderId: a.holderWarpingOrderId, carryOver: a.holderWarpingOrderId !== orderId, kg: kg(a.kg)! })),
    })),
  };
}

function groupReceipts(beams: BeamRow[], orderId: string): WarpingReceiptSummaryDto[] {
  const m = new Map<string, BeamRow[]>();
  for (const b of beams) {
    const k = b.warpingReceiptKey ?? "";
    m.set(k, [...(m.get(k) ?? []), b]);
  }
  return [...m.entries()].map(([receiptKey, rows]) => {
    const evs = rows.map((r) => r.events[0]).filter((e): e is NonNullable<typeof e> => !!e);
    const live = rows.filter((r) => r.events[0] && !r.events[0].reversal);
    const at = evs.reduce((min, e) => (e.createdAt < min ? e.createdAt : min), evs[0]?.createdAt ?? new Date(0));
    return {
      receiptKey, deliveryNoteNo: evs[0]?.deliveryNoteNo ?? null, receivedAt: at.toISOString(), beamCount: rows.length, liveBeamCount: live.length,
      lengthM: kg(live.reduce((s, r) => s.plus(r.events[0]!.lengthM ?? 0), new Prisma.Decimal(0)))!,
      beams: rows.map((r) => beamDto(r, orderId)),
    };
  }).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.receiptKey.localeCompare(b.receiptKey));
}

export async function loadWarpingReceipt(db: Db, warpingOrderId: string, receiptKey: string): Promise<WarpingReceiptDto> {
  const beams = (await loadOrderBeams(db, warpingOrderId)).filter((b) => b.warpingReceiptKey === receiptKey);
  const r = groupReceipts(beams, warpingOrderId)[0];
  if (!r) throw AppError.notFound("Bu siparişte böyle bir levent kabulü yok.", { code: "WARPING_RECEIPT_NOT_FOUND" });
  return { ...r, warpingOrderId, settlement: await loadWarpingSettlement(db, warpingOrderId), warnings: [] };
}

/** Siparişin bütün kabulleri (eski → yeni) + mutabakat. */
export async function listWarpingReceipts(warpingOrderId: string): Promise<{ receipts: WarpingReceiptSummaryDto[]; settlement: WarpingSettlement }> {
  const exists = await prisma.warpingOrder.findUnique({ where: { id: warpingOrderId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  return { receipts: groupReceipts(await loadOrderBeams(prisma, warpingOrderId), warpingOrderId), settlement: await loadWarpingSettlement(prisma, warpingOrderId) };
}
