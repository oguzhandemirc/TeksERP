// =============================================================================
// FASON DEVERE — DÖNÜŞ KABUL BELGESİ okuyucusu (devere ek E1): belge DTO'su, liste, irsaliye no ile kabul grubu
// =============================================================================
// Belge yalnız başlıktır; sipariş başı kabul (`warpingReceiptKey`) DTO'su `receipts.ts`ten aynen gelir (A1 fatura bağı,
// C1 ret, LIFO storno o birimi okur). İrsaliye no okuması belgeli VE eski tek-sipariş kabulleri birlikte döner.
// =============================================================================
import { Prisma, WarpBeamOrigin } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { loadWarpingReceipt, type WarpingReceiptDto } from "./receipts";

type Db = Prisma.TransactionClient | typeof prisma;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const DOC_SELECT = {
  id: true, docNo: true, deliveryNoteNo: true, createdAt: true, createdById: true,
  subcontractor: { select: { id: true, code: true, name: true } },
} satisfies Prisma.WarpingReceiveDocSelect;

export interface WarpingReceiveDocOrderDto { warpingOrderId: string; orderNo: string; receipt: WarpingReceiptDto }
export interface WarpingReceiveDocDto {
  id: string; docNo: string; deliveryNoteNo: string | null; createdAt: string; createdById: string | null;
  subcontractor: { id: string; code: string; name: string };
  orders: WarpingReceiveDocOrderDto[];
  totals: { orderCount: number; beamCount: number; liveBeamCount: number; lengthM: string };
}

/** Belge + sipariş başı kabuller (sipariş `id` sırası = yazım sırası). */
export async function loadWarpingReceiveDoc(db: Db, id: string): Promise<WarpingReceiveDocDto> {
  const doc = await sequentialTx(db).warpingReceiveDoc.findUnique({ where: { id }, select: { ...DOC_SELECT, beams: { select: { warpingOrderId: true, warpingReceiptKey: true, warpingOrder: { select: { orderNo: true } } } } } });
  if (!doc) throw AppError.notFound("Dönüş kabul belgesi bulunamadı.", { code: "WARPING_RECEIVE_DOC_NOT_FOUND" });
  const keys = new Map<string, { orderId: string; orderNo: string; key: string }>();
  for (const b of doc.beams) if (b.warpingOrderId && b.warpingReceiptKey) keys.set(b.warpingReceiptKey, { orderId: b.warpingOrderId, orderNo: b.warpingOrder?.orderNo ?? "", key: b.warpingReceiptKey });
  const orders: WarpingReceiveDocOrderDto[] = [];
  for (const k of [...keys.values()].sort((a, b) => a.orderId.localeCompare(b.orderId))) {
    orders.push({ warpingOrderId: k.orderId, orderNo: k.orderNo, receipt: await loadWarpingReceipt(db, k.orderId, k.key) });
  }
  return {
    id: doc.id, docNo: doc.docNo, deliveryNoteNo: doc.deliveryNoteNo, createdAt: doc.createdAt.toISOString(), createdById: doc.createdById, subcontractor: doc.subcontractor, orders,
    totals: {
      orderCount: orders.length, beamCount: orders.reduce((s, o) => s + o.receipt.beamCount, 0), liveBeamCount: orders.reduce((s, o) => s + o.receipt.liveBeamCount, 0),
      lengthM: orders.reduce((s, o) => s.plus(o.receipt.lengthM), D(0)).toFixed(3),
    },
  };
}

export const getWarpingReceiveDoc = (id: string) => loadWarpingReceiveDoc(prisma, id);

export interface WarpingReceiveDocListParams { subcontractorId?: string | { in: string[] } | null; deliveryNoteNo?: string; search?: string; cursor?: string; limit: number }

/** Liste + cursor + özet TEK where'den (süzme sunucuda). */
export async function listWarpingReceiveDocs(p: WarpingReceiveDocListParams) {
  const and: Prisma.WarpingReceiveDocWhereInput[] = [];
  if (p.subcontractorId) and.push({ subcontractorId: p.subcontractorId });
  const note = p.deliveryNoteNo?.trim();
  if (note) and.push({ deliveryNoteNo: { equals: note, mode: "insensitive" } });
  const q = p.search?.trim();
  if (q) and.push({ OR: [{ docNo: { contains: q, mode: "insensitive" } }, { deliveryNoteNo: { contains: q, mode: "insensitive" } }, { beams: { some: { warpingOrder: { orderNo: { contains: q, mode: "insensitive" } } } } }] });
  const where: Prisma.WarpingReceiveDocWhereInput = and.length > 0 ? { AND: and } : {};
  const cursor = p.cursor ? decodeCursor(p.cursor) : null;
  if (p.cursor && !cursor) throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "CURSOR_INVALID" });
  const rows = await prisma.warpingReceiveDoc.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: p.limit + 1,
    select: { ...DOC_SELECT, beams: { select: { warpingOrderId: true, warpingOrder: { select: { orderNo: true } } } } },
  });
  const hasMore = rows.length > p.limit;
  const page = hasMore ? rows.slice(0, p.limit) : rows;
  const count = await prisma.warpingReceiveDoc.count({ where });
  const beamCount = await prisma.warpBeam.count({ where: { warpingReceiveDoc: where } });
  return {
    data: page.map(({ beams, createdAt, ...d }) => ({
      ...d, createdAt: createdAt.toISOString(), beamCount: beams.length,
      orders: [...new Map(beams.filter((b) => b.warpingOrderId).map((b) => [b.warpingOrderId!, { warpingOrderId: b.warpingOrderId!, orderNo: b.warpingOrder?.orderNo ?? "" }])).values()],
    })),
    nextCursor: hasMore ? buildNextCursor(page[page.length - 1]!) : null,
    summary: { count, beamCount },
  };
}

export interface DeliveryNoteGroupDto {
  subcontractorId: string; deliveryNoteNo: string;
  docs: WarpingReceiveDocDto[];
  /** Belgesiz (eski tek-sipariş `/receive`) kabuller — aynı irsaliye no. */
  receipts: Array<{ warpingOrderId: string; orderNo: string; receipt: WarpingReceiptDto }>;
}

/** İrsaliye no ile kabul grubu: deverecinin bu no'lu bütün kabulleri (belgeli + eski), iptal edilmişler dahil (durum DTO'da). */
export async function getDeliveryNoteGroup(subcontractorId: string, deliveryNoteNo: string): Promise<DeliveryNoteGroupDto> {
  const note = deliveryNoteNo.trim();
  if (!note) throw AppError.badRequest("İrsaliye no boş olamaz.", { code: "WARPING_DELIVERY_NOTE_REQUIRED" });
  const beams = await prisma.warpBeam.findMany({
    where: { subcontractorId, originKind: WarpBeamOrigin.SUBCONTRACT, warpingOrderId: { not: null }, events: { some: { kind: "WOUND", deliveryNoteNo: { equals: note, mode: "insensitive" } } } },
    select: { warpingOrderId: true, warpingReceiptKey: true, warpingReceiveDocId: true, createdAt: true, warpingOrder: { select: { orderNo: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  const docIds = [...new Set(beams.map((b) => b.warpingReceiveDocId).filter((x): x is string => !!x))];
  const legacy = new Map<string, { orderId: string; orderNo: string }>();
  for (const b of beams) if (!b.warpingReceiveDocId && b.warpingReceiptKey && b.warpingOrderId) legacy.set(b.warpingReceiptKey, { orderId: b.warpingOrderId, orderNo: b.warpingOrder?.orderNo ?? "" });
  const docs: WarpingReceiveDocDto[] = [];
  for (const id of docIds) docs.push(await loadWarpingReceiveDoc(prisma, id));
  const receipts: DeliveryNoteGroupDto["receipts"] = [];
  for (const [key, o] of legacy) receipts.push({ warpingOrderId: o.orderId, orderNo: o.orderNo, receipt: await loadWarpingReceipt(prisma, o.orderId, key) });
  return { subcontractorId, deliveryNoteNo: note, docs, receipts };
}
