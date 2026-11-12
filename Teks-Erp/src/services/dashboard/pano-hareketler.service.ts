// =============================================================================
// AÇILIŞ PANOSU — son hareketler (`GET /api/dashboard/pano/hareketler`)
// =============================================================================
// Karışık akış, DEFTER/ana tablolardan (SystemLog'dan TÜRETİLMEZ — audit yalnız ayak izidir).
// Her tür kendi liste ucunun izni + modülüyle kapılı; kapalı tür akışa hiç girmez.
// Miktar tek kaynaklardan: sevk BRÜT `_shipped.shippedPartsSql` (belge kimliği `sid`), fason
// dönüş kabul defteri ifadesi (Fason Karnesi), sipariş metresi ölçülen satırlar (`MEASURED_LINE`).
// =============================================================================
import { DeliveryNoteStatus, GoodsReceiptStatus, OrderStatus, Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { isModuleOpen, loadAccessContext, type AccessContext } from "../reports/semantik/izin";
import { shippedPartsSql } from "../reports/_shipped";
import { round1 } from "../reports/_breakdown";
import { ACTIVE_LINE, MEASURED_LINE } from "../helpers/order-line-scope.helper";
import type { PanoKullanici } from "./pano-kaynak";

export const PANO_HAREKET_LIMIT = 8;

export const HAREKET_TURLERI = ["SIPARIS", "SEVK", "DOGRUDAN_SEVK", "FASON_GIDEN", "FASON_DONEN", "MAL_KABUL", "GELEN_BELGE"] as const;
export type HareketTuru = (typeof HAREKET_TURLERI)[number];

/** Panelin tıklayınca gideceği kayıt türü. */
export type MovementTargetType = "order" | "shipment" | "directShipment" | "subcontractorDispatch" | "subcontractorReceipt" | "goodsReceipt" | "deliveryNote";

export interface PanoHareket {
  tur: HareketTuru;
  belgeNo: string;
  /** Müşteri / fasoncu / tedarikçi adı; kayıtta yoksa null. */
  cari: string | null;
  /** Ölçülemiyorsa null (0 değil). */
  miktar: number | null;
  birim: "m" | "top" | null;
  zaman: string;
  /** Fason sevk/kabulün kendi ekranı yok: panel `isEmriId` varsa iş emri detayına gider (dokuma işinde null). */
  hedef: { tur: MovementTargetType; id: string; isEmriId?: string | null };
}

export interface PanoHareketler {
  hareketler: PanoHareket[];
  /** Kullanıcının görebildiği türler — kapalı/izinsiz tür burada yoksa akışta da yoktur. */
  turler: HareketTuru[];
}

function gate(ctx: AccessContext, permission: string, ...modules: string[]): boolean {
  return matchesPermission(ctx.permissions, permission) && modules.every((m) => isModuleOpen(m, ctx));
}

/** ISO zaman / kod / uuid karşılaştırması — ASCII, yerel ayardan bağımsız. */
const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
const none = (): Promise<PanoHareket[]> => Promise.resolve([]);
const N = PANO_HAREKET_LIMIT;

async function orders(): Promise<PanoHareket[]> {
  const rows = await prisma.order.findMany({
    where: { status: { not: OrderStatus.CANCELLED } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: N,
    select: {
      id: true, orderNumber: true, createdAt: true,
      customer: { select: { name: true } },
      lines: { where: { ...ACTIVE_LINE, ...MEASURED_LINE }, select: { quantity: true } },
    },
  });
  return rows.map((o) => ({
    tur: "SIPARIS",
    belgeNo: o.orderNumber,
    cari: o.customer.name,
    // Metre dışı (KG/ADET) satırlar metreye düşmez; ölçülen satır yoksa miktar ölçülemedi.
    miktar: o.lines.length > 0 ? round1(o.lines.reduce((a, l) => a + Number(l.quantity), 0)) : null,
    birim: o.lines.length > 0 ? "m" : null,
    zaman: o.createdAt.toISOString(),
    hedef: { tur: "order", id: o.id },
  }));
}

/** Son sevkler (sevkiyat + doğrudan sevk), metre brüt tanımdan belge başına. */
async function shipments(now: Date): Promise<PanoHareket[]> {
  const [ships, directs] = await Promise.all([
    prisma.shipment.findMany({
      where: { status: ShipmentStatus.DISPATCHED, dispatchedAt: { not: null } },
      orderBy: [{ dispatchedAt: "desc" }, { id: "desc" }],
      take: N,
      select: { id: true, shipmentNo: true, dispatchedAt: true, customer: { select: { name: true } } },
    }),
    prisma.directShipment.findMany({
      orderBy: [{ shippedAt: "desc" }, { id: "desc" }],
      take: N,
      select: { id: true, shipmentNo: true, shippedAt: true, customer: { select: { name: true } } },
    }),
  ]);
  const times = [...ships.map((s) => s.dispatchedAt!.getTime()), ...directs.map((d) => d.shippedAt.getTime())];
  if (times.length === 0) return [];
  const from = new Date(Math.min(...times));
  const to = new Date(Math.max(now.getTime(), ...times));
  const ids = [...ships.map((s) => s.id), ...directs.map((d) => d.id)];
  const qtyRows = await prisma.$queryRaw<Array<{ sid: string; qty: number | null }>>(Prisma.sql`
    WITH parts AS (${shippedPartsSql({ from, to })})
    SELECT sid, SUM(qty)::float AS qty FROM parts WHERE sid = ANY(${ids}::uuid[]) GROUP BY sid`);
  const qty = new Map(qtyRows.map((r) => [r.sid, round1(Number(r.qty ?? 0))]));
  return [
    ...ships.map((s): PanoHareket => ({
      tur: "SEVK", belgeNo: s.shipmentNo, cari: s.customer.name, miktar: qty.get(s.id) ?? 0, birim: "m",
      zaman: s.dispatchedAt!.toISOString(), hedef: { tur: "shipment", id: s.id },
    })),
    ...directs.map((d): PanoHareket => ({
      tur: "DOGRUDAN_SEVK", belgeNo: d.shipmentNo, cari: d.customer.name, miktar: qty.get(d.id) ?? 0, birim: "m",
      zaman: d.shippedAt.toISOString(), hedef: { tur: "directShipment", id: d.id },
    })),
  ];
}

async function subcontractDispatches(): Promise<PanoHareket[]> {
  const rows = await prisma.subcontractorDispatch.findMany({
    where: { cancelledAt: null },
    orderBy: [{ dispatchedAt: "desc" }, { id: "desc" }],
    take: N,
    select: { id: true, dispatchNo: true, dispatchedAt: true, totalQty: true, workOrderId: true, subcontractor: { select: { name: true } } },
  });
  return rows.map((d) => ({
    tur: "FASON_GIDEN", belgeNo: d.dispatchNo, cari: d.subcontractor.name, miktar: round1(Number(d.totalQty)), birim: "m",
    zaman: d.dispatchedAt.toISOString(), hedef: { tur: "subcontractorDispatch", id: d.id, isEmriId: d.workOrderId },
  }));
}

async function subcontractReceipts(): Promise<PanoHareket[]> {
  // Dönen metre = kabul defteri: `receivedQty`, eski (NULL) satırda yeni topun metresi (Fason Karnesi ifadesi).
  const rows = await prisma.$queryRaw<Array<{ id: string; receiptNo: string; receivedAt: Date; workOrderId: string | null; name: string; qty: number | null }>>(Prisma.sql`
    WITH last AS (
      SELECT sr.id, sr."receiptNo", sr."receivedAt", sr."workOrderId", sr."subcontractorId"
      FROM subcontractor_receipts sr
      WHERE sr."cancelledAt" IS NULL
      ORDER BY sr."receivedAt" DESC, sr.id DESC
      LIMIT ${N}
    )
    SELECT l.id, l."receiptNo" AS "receiptNo", l."receivedAt" AS "receivedAt", l."workOrderId" AS "workOrderId", s.name,
           (SELECT SUM(COALESCE(sri."receivedQty", nr."currentQty"))::float
              FROM subcontractor_receipt_items sri JOIN rolls nr ON nr.id = sri."newRollId"
             WHERE sri."receiptId" = l.id) AS qty
    FROM last l JOIN subcontractors s ON s.id = l."subcontractorId"`);
  return rows.map((r) => ({
    tur: "FASON_DONEN", belgeNo: r.receiptNo, cari: r.name, miktar: r.qty === null ? null : round1(Number(r.qty)), birim: r.qty === null ? null : "m",
    zaman: r.receivedAt.toISOString(), hedef: { tur: "subcontractorReceipt", id: r.id, isEmriId: r.workOrderId },
  }));
}

async function goodsReceipts(): Promise<PanoHareket[]> {
  const rows = await prisma.goodsReceipt.findMany({
    where: { status: GoodsReceiptStatus.ACTIVE },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: N,
    select: {
      id: true, receiptNo: true, createdAt: true,
      supplier: { select: { name: true } }, subcontractorSupplier: { select: { name: true } },
      // Liste sayacıyla aynı (`goods-receipt.service` list `_count.rolls`); iplik/sarf satırı top sayılmaz.
      _count: { select: { rolls: true } },
    },
  });
  return rows.map((g) => ({
    tur: "MAL_KABUL", belgeNo: g.receiptNo, cari: g.supplier?.name ?? g.subcontractorSupplier?.name ?? null,
    miktar: g._count.rolls > 0 ? g._count.rolls : null, birim: g._count.rolls > 0 ? "top" : null,
    zaman: g.createdAt.toISOString(), hedef: { tur: "goodsReceipt", id: g.id },
  }));
}

async function deliveryNotes(): Promise<PanoHareket[]> {
  const rows = await prisma.customerDeliveryNote.findMany({
    where: { status: { in: [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.PARTIAL] }, approvedAt: { not: null } },
    orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
    take: N,
    select: {
      id: true, noteNo: true, approvedAt: true, ownerCustomer: { select: { name: true } },
      _count: { select: { lines: { where: { rollId: { not: null } } } } },
    },
  });
  return rows.map((n) => ({
    tur: "GELEN_BELGE", belgeNo: n.noteNo, cari: n.ownerCustomer?.name ?? null,
    miktar: n._count.lines, birim: "top",
    zaman: n.approvedAt!.toISOString(), hedef: { tur: "deliveryNote", id: n.id },
  }));
}

/** Hareket türü kapılarının izin kodları — tek tablo (izin kataloğu bekçisi bu sabiti okur). */
const GATE_PERMISSIONS = {
  SIPARIS: "order:read",
  SEVK: "shipping:read",
  DOGRUDAN_SEVK: "shipping:read",
  FASON_GIDEN: "workorder:read",
  FASON_DONEN: "workorder:read",
  MAL_KABUL: "goods-receipt:read",
  GELEN_BELGE: "gelen-belge:read",
} as const satisfies Record<HareketTuru, string>;

/** Tür başına kapı — kutu kataloğu da bunu okur (tek kaynak). */
export function movementGates(ctx: AccessContext): Record<HareketTuru, boolean> {
  return {
    SIPARIS: gate(ctx, GATE_PERMISSIONS.SIPARIS),
    SEVK: gate(ctx, GATE_PERMISSIONS.SEVK),
    DOGRUDAN_SEVK: gate(ctx, GATE_PERMISSIONS.DOGRUDAN_SEVK),
    FASON_GIDEN: gate(ctx, GATE_PERMISSIONS.FASON_GIDEN),
    FASON_DONEN: gate(ctx, GATE_PERMISSIONS.FASON_DONEN),
    MAL_KABUL: gate(ctx, GATE_PERMISSIONS.MAL_KABUL, "ticaretEnabled"),
    GELEN_BELGE: gate(ctx, GATE_PERMISSIONS.GELEN_BELGE, "gelenBelgeEnabled"),
  };
}

export async function getPanoHareketler(user: PanoKullanici, now: Date = new Date()): Promise<PanoHareketler> {
  const can = movementGates(await loadAccessContext(user));
  const parts = await Promise.all([
    can.SIPARIS ? orders() : none(),
    can.SEVK ? shipments(now) : none(),
    can.FASON_GIDEN ? subcontractDispatches() : none(),
    can.FASON_DONEN ? subcontractReceipts() : none(),
    can.MAL_KABUL ? goodsReceipts() : none(),
    can.GELEN_BELGE ? deliveryNotes() : none(),
  ]);
  // En yeni önce; eşit zamanda tür + kimlik belirlenimli eşitlik bozucu.
  const hareketler = parts
    .flat()
    .sort((a, b) => cmp(b.zaman, a.zaman) || cmp(a.tur, b.tur) || cmp(a.hedef.id, b.hedef.id))
    .slice(0, N);
  return { hareketler, turler: HAREKET_TURLERI.filter((t) => can[t]) };
}

export const PANO_HAREKET_ROUTE_PERMISSIONS = ["order:read", "shipping:read", "workorder:read", "goods-receipt:read", "gelen-belge:read"] as const;
