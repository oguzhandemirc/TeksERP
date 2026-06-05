// =============================================================================
// Shipping Service — Sevkiyat oturumu (Shipment) + Çuval (Sack = tartı)
// =============================================================================
// GEVŞEK MODEL (top→sipariş bağı YOK) + ÇUVAL-ÖNCE paketleme. Akış:
//   1) Sipariş seç → createShipment(orderIds)        → PREPARING (tek müşteri+şube)
//   2) Çuval aç → addSack()                          → Sack (boş; brüt tartı sonra)
//   3) Topları O çuvala okut → scanIntoShipment(sackId) → Roll.shipmentId + Roll.sackId
//   4) Çuvalı brüt tart + kod gir → updateSack(weightKg, manualCode); moveRollToSack ile aktar
//   5) Sevke Hazır → markReady                       → READY (rezerve): her top+kartela çuvalda &
//      her çuval tartılı + KODLU (invariant). Stok/karşılanma DÜŞMEZ — ara depoda/kapıda bekler.
//   6) Sevk/çıkış → dispatchShipment (PREPARING "Hemen Sevk Et" veya READY "Çıkış Ver") → DISPATCHED:
//      spec-toplam termin→tarih FIFO dağıtılır (ShipmentAllocation + OrderLine.shippedQty), toplar
//      SHIPPED, recompute — stok yalnız burada düşer.
//   İptal → cancelShipment (PREPARING/READY): top+çuval bağı kopar, depoda kalır (karşılanmaya dokunmaz).
//
// Karşılanma "hangi top hangi siparişe" değil "aynı tür sipariş ↔ aynı tür top" metraj
// toplamıdır. Çuval İÇERİK tutar (Roll/Swatch.sackId) → irsaliyede ürün-bazlı döküm.
// =============================================================================

import {
  Prisma,
  RollStatus,
  ShipmentStatus,
  OrderStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { recomputeOrderStatusForOrders } from "./helpers/order-status.helper";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import type { Request } from "express";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";

// Sevkiyat liste filtreleri (Electron FilterBar + arama). Top-level skaler alanlar —
// `buildWhereClause` OR-contains'i bu alanlarda çalışır. Tarih alanları whitelist'i
// `applyDateRange` ile: createdAt indexli (`[status, createdAt]`), diğerleri tarih
// penceresiyle sınırlı.
const SHIPMENT_SEARCH_FIELDS = ["shipmentNo", "plateNumber", "driverName", "carrier"];
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt", "readyAt"] as const;

// ---------------------------------------------------------------------------
// Sequence helpers — SVK-YYMMDD-NNN (sevkiyat), CV-YYMMDD-NNN (çuval)
// ---------------------------------------------------------------------------
function datePrefix(prefix: string): string {
  const now = new Date();
  return (
    prefix +
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-"
  );
}

async function nextShipmentNo(): Promise<string> {
  const prefix = datePrefix("SVK-");
  const last = await prisma.shipment.findFirst({
    where: { shipmentNo: { startsWith: prefix } },
    orderBy: { shipmentNo: "desc" },
    select: { shipmentNo: true },
  });
  const seq = last ? parseInt(last.shipmentNo.split("-").pop() ?? "0", 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

async function nextSackNo(): Promise<string> {
  const prefix = datePrefix("CV-");
  const last = await prisma.sack.findFirst({
    where: { sackNo: { startsWith: prefix } },
    orderBy: { sackNo: "desc" },
    select: { sackNo: true },
  });
  const seq = last ? parseInt(last.sackNo.split("-").pop() ?? "0", 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Spec eşleştirme + FIFO tahsis simülasyonu (saf — hem önizleme hem yazma kullanır)
// ---------------------------------------------------------------------------
const D0 = () => new Prisma.Decimal(0);

interface RollSpec {
  itemId: string;
  colorId: string | null;
  width: Prisma.Decimal | null;
  currentQty: Prisma.Decimal;
}
interface LineForAlloc {
  id: string;
  itemId: string;
  colorId: string | null;
  width: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  shippedQty: Prisma.Decimal;
  deadline: Date | null;
  orderDate: Date;
  lineCreatedAt: Date;
}

// item kesin; renk/en ikisi de doluysa eşit olmalı, biri null ise gevşek eşleşir.
function specMatch(
  a: { itemId: string; colorId: string | null; width: Prisma.Decimal | null },
  b: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }
): boolean {
  if (a.itemId !== b.itemId) return false;
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  if (
    a.width != null &&
    b.width != null &&
    !new Prisma.Decimal(a.width).equals(new Prisma.Decimal(b.width))
  ) {
    return false;
  }
  return true;
}

/**
 * Spec-toplam → seçilen sipariş satırlarına termin→sipariş tarihi→satır FIFO dağıt.
 * Her satır (quantity − shippedQty) kadar doldurulur; havuz biterse eksik kalır,
 * artarsa "fazla sevk" (tahsis edilmez). Saf fonksiyon — hem canlı önizleme
 * (getShipmentById) hem yazma (markReady) aynı sonucu üretir.
 */
function allocate(rolls: RollSpec[], lines: LineForAlloc[]): Map<string, Prisma.Decimal> {
  // Havuz: rolleri exact spec'e göre grupla
  const pool: { itemId: string; colorId: string | null; width: Prisma.Decimal | null; remaining: Prisma.Decimal }[] = [];
  const poolByKey = new Map<string, (typeof pool)[number]>();
  for (const r of rolls) {
    const key = `${r.itemId}|${r.colorId ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
    let e = poolByKey.get(key);
    if (!e) {
      e = { itemId: r.itemId, colorId: r.colorId, width: r.width, remaining: D0() };
      poolByKey.set(key, e);
      pool.push(e);
    }
    e.remaining = e.remaining.plus(r.currentQty);
  }

  const sorted = [...lines].sort((a, b) => {
    const ad = a.deadline ? a.deadline.getTime() : Infinity;
    const bd = b.deadline ? b.deadline.getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    const ao = a.orderDate.getTime();
    const bo = b.orderDate.getTime();
    if (ao !== bo) return ao - bo;
    return a.lineCreatedAt.getTime() - b.lineCreatedAt.getTime();
  });

  const result = new Map<string, Prisma.Decimal>();
  for (const line of sorted) {
    let need = Prisma.Decimal.max(0, line.quantity.minus(line.shippedQty));
    if (need.lessThanOrEqualTo(0)) continue;
    let alloc = D0();
    for (const e of pool) {
      if (need.lessThanOrEqualTo(0)) break;
      if (e.remaining.lessThanOrEqualTo(0)) continue;
      if (!specMatch(e, line)) continue;
      const take = Prisma.Decimal.min(need, e.remaining);
      e.remaining = e.remaining.minus(take);
      need = need.minus(take);
      alloc = alloc.plus(take);
    }
    if (alloc.greaterThan(0)) result.set(line.id, alloc);
  }
  return result;
}

export class ShippingService {
  // =========================================================================
  // SEVKİYAT OTURUMU — oluştur / liste / detay
  // =========================================================================

  /**
   * Yeni sevkiyat oturumu — seçilen siparişlerden müşteri+şube türetilir.
   * Tüm siparişler aynı müşteri + aynı şube + açık olmalı (tek oturum = tek alıcı).
   */
  async createShipment(
    data: { orderIds: string[] },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const orderIds = [...new Set(data.orderIds)];
    if (orderIds.length === 0) throw AppError.badRequest("En az bir sipariş seçilmeli");

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, customerId: true, branchId: true, status: true },
    });
    if (orders.length !== orderIds.length) throw AppError.notFound("Bazı siparişler bulunamadı");

    const closed = orders.find(
      (o) => o.status === OrderStatus.CANCELLED || o.status === OrderStatus.COMPLETED
    );
    if (closed) {
      throw AppError.badRequest(`Kapalı sipariş seçilemez: ${closed.orderNumber}`);
    }

    const customerId = orders[0].customerId;
    const branchId = orders[0].branchId ?? null;
    const mixed = orders.some(
      (o) => o.customerId !== customerId || (o.branchId ?? null) !== branchId
    );
    if (mixed) {
      throw AppError.badRequest(
        "Tek sevkiyat = tek müşteri + tek şube. Seçilen siparişler aynı müşteri/şubeye ait olmalı."
      );
    }

    // Tek aktif sevkiyat: bir açık sipariş aynı anda yalnız bir PREPARING/READY
    // sevkiyatta olabilir → çift sevkiyat/çift sevk olmaz (mevcut olanı sürdür).
    const alreadyIn = await prisma.shipmentOrder.findFirst({
      where: {
        orderId: { in: orderIds },
        shipment: { status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY] } },
      },
      select: { orderId: true, shipment: { select: { shipmentNo: true } } },
    });
    if (alreadyIn) {
      const ordNo = orders.find((o) => o.id === alreadyIn.orderId)?.orderNumber ?? "";
      throw AppError.conflict(
        `Sipariş ${ordNo} zaten bir sevkiyatta (${alreadyIn.shipment.shipmentNo}) — onu sürdür.`
      );
    }

    const shipment = await withBarcodeRetry(async () => {
      const shipmentNo = await nextShipmentNo();
      return prisma.shipment.create({
        data: {
          shipmentNo,
          customerId,
          branchId,
          status: ShipmentStatus.PREPARING,
          orders: { create: orderIds.map((orderId) => ({ orderId })) },
        },
        select: { id: true, shipmentNo: true, status: true },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SHIPMENT",
      recordId: shipment.id,
      newData: { shipmentNo: shipment.shipmentNo, customerId, branchId, orderIds },
    });

    return { success: true, data: shipment, message: `Sevkiyat açıldı: ${shipment.shipmentNo}` };
  }

  /** Açık sevkiyata sipariş ekle (aynı müşteri+şube, açık, PREPARING). */
  async addOrders(
    shipmentId: string,
    orderIds: string[],
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(orderIds)];
    if (ids.length === 0) throw AppError.badRequest("Sipariş seçilmeli");

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, customerId: true, branchId: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyata sipariş eklenebilir");
    }

    const orders = await prisma.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderNumber: true, customerId: true, branchId: true, status: true },
    });
    if (orders.length !== ids.length) throw AppError.notFound("Bazı siparişler bulunamadı");
    for (const o of orders) {
      if (o.status === OrderStatus.CANCELLED || o.status === OrderStatus.COMPLETED) {
        throw AppError.badRequest(`Kapalı sipariş eklenemez: ${o.orderNumber}`);
      }
      if (o.customerId !== shipment.customerId || (o.branchId ?? null) !== (shipment.branchId ?? null)) {
        throw AppError.badRequest(`Sipariş bu sevkiyatın müşteri/şubesine ait değil: ${o.orderNumber}`);
      }
    }

    // Başka bir aktif sevkiyatta olan sipariş eklenemez (tek aktif sevkiyat kuralı).
    const alreadyIn = await prisma.shipmentOrder.findFirst({
      where: {
        orderId: { in: ids },
        shipmentId: { not: shipmentId },
        shipment: { status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY] } },
      },
      select: { shipment: { select: { shipmentNo: true } } },
    });
    if (alreadyIn) {
      throw AppError.conflict(`Sipariş zaten başka bir sevkiyatta (${alreadyIn.shipment.shipmentNo}).`);
    }

    await prisma.shipmentOrder.createMany({
      data: ids.map((orderId) => ({ shipmentId, orderId })),
      skipDuplicates: true,
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "ADD_ORDERS", orderIds: ids },
    });
    return { success: true, data: {}, message: "Sipariş(ler) eklendi" };
  }

  /** Sevkiyattan sipariş çıkar (PREPARING). */
  async removeOrder(
    shipmentId: string,
    orderId: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { status: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyattan sipariş çıkarılabilir");
    }
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId, orderId } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "REMOVE_ORDER", orderId },
    });
    return { success: true, data: {}, message: "Sipariş çıkarıldı" };
  }

  async listShipments(
    req: Request
  ): Promise<ApiResponse<unknown> | CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);

    // Electron FilterBar/sekme → filter[status] (tek-değer veya çoklu CSV→{in}),
    // filter[customerId], filter[branchId] + arama (shipmentNo/plaka/sürücü/taşıyıcı)
    // tek seferde kurulur; ardından tarih aralığı (whitelist) eklenir.
    const where = buildWhereClause(
      params.filters,
      SHIPMENT_SEARCH_FIELDS,
      params.search
    ) as Prisma.ShipmentWhereInput;
    applyDateRange(where as Record<string, unknown>, params, SHIPMENT_DATE_FIELDS);

    // Mobil geri-uyum: ham ?status= / ?customerId= (filter[] değil). buildWhereClause
    // ham query'i görmez — varsa burada uygula (status enum'a karşı doğrulanır).
    const rawStatus = req.query.status as string | undefined;
    if (rawStatus && Object.values(ShipmentStatus).includes(rawStatus as ShipmentStatus)) {
      where.status = rawStatus as ShipmentStatus;
    }
    const rawCustomerId = req.query.customerId as string | undefined;
    if (rawCustomerId) where.customerId = rawCustomerId;

    // Lean select — liste için sayılar (dizi değil); snapshot/dizi YOK (perf, rule 13).
    const select = {
      id: true,
      shipmentNo: true,
      status: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      readyAt: true,
      dispatchedAt: true,
      createdAt: true,
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, name: true } },
      _count: { select: { sacks: true, rolls: true, orders: true } },
    } as const;

    // Electron DataTable → cursor; mobil/eski istemci → array (geri uyum, mobil bozulmaz).
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      // Toplam tahmini yalnız ilk sayfada (`useDataTable` withTotal=true yollar) —
      // filtreli + tarih-pencereli `where` üstünde tek count.
      const wantTotal = req.query.withTotal === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhere = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.shipment.findMany({
          where: cursorWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select,
        }),
        wantTotal ? prisma.shipment.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    const shipments = await prisma.shipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select,
    });
    return { success: true, data: shipments };
  }

  /**
   * Sevkiyat detayı — paketleme ekranının canlı kaynağı. Seçilen siparişler +
   * her satırda istenen/şu ana dek sevk/açık + bu oturumda okutulan toplardan
   * projeksiyon (FIFO simülasyonu); okutulan toplar; çuvallar; özet.
   */
  async getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true,
        shipmentNo: true,
        status: true,
        plateNumber: true,
        driverName: true,
        carrier: true,
        readyAt: true,
        dispatchedAt: true,
        createdAt: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        orders: {
          select: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                deadline: true,
                orderDate: true,
                lines: {
                  select: {
                    id: true,
                    itemId: true,
                    colorId: true,
                    width: true,
                    quantity: true,
                    shippedQty: true,
                    customerItemName: true,
                    customerColorName: true,
                    createdAt: true,
                    item: { select: { id: true, code: true, name: true } },
                    color: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
          },
        },
        rolls: {
          select: {
            id: true,
            barcode: true,
            itemId: true,
            colorId: true,
            width: true,
            currentQty: true,
            sackId: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
        },
        swatches: { select: { id: true, barcode: true, length: true, width: true, sackId: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true,
            sackNo: true,
            seq: true,
            manualCode: true,
            weightKg: true,
            rolls: {
              select: {
                id: true,
                barcode: true,
                width: true,
                currentQty: true,
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
              },
            },
            swatches: {
              select: {
                id: true,
                barcode: true,
                length: true,
                width: true,
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
              },
            },
          },
        },
        allocations: { select: { orderLineId: true, qty: true } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    // FIFO projeksiyon — bu oturumdaki toplar seçilen satırlara nasıl düşer.
    const linesForAlloc: LineForAlloc[] = shipment.orders.flatMap((so) =>
      so.order.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        colorId: l.colorId,
        width: l.width,
        quantity: new Prisma.Decimal(l.quantity),
        shippedQty: new Prisma.Decimal(l.shippedQty),
        deadline: so.order.deadline,
        orderDate: so.order.orderDate,
        lineCreatedAt: l.createdAt,
      }))
    );
    const rollsForAlloc: RollSpec[] = shipment.rolls.map((r) => ({
      itemId: r.itemId,
      colorId: r.colorId,
      width: r.width,
      currentQty: new Prisma.Decimal(r.currentQty),
    }));
    // Yalnız DISPATCHED'te gerçek tahsis yazılıdır; PREPARING + READY'de canlı projeksiyon
    // (READY artık karşılanmayı düşmüyor — stok sevkte/DISPATCH'te düşer).
    const persisted = new Map<string, Prisma.Decimal>();
    for (const a of shipment.allocations) {
      persisted.set(a.orderLineId, (persisted.get(a.orderLineId) ?? D0()).plus(a.qty));
    }
    const projected =
      shipment.status === ShipmentStatus.DISPATCHED
        ? persisted
        : allocate(rollsForAlloc, linesForAlloc);

    const orders = shipment.orders.map((so) => ({
      id: so.order.id,
      orderNumber: so.order.orderNumber,
      status: so.order.status,
      deadline: so.order.deadline,
      lines: so.order.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const thisShipment = projected.get(l.id) ?? D0();
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: l.customerItemName,
          customerColorName: l.customerColorName,
          requested,
          shipped, // önceki sevkiyatlardan + (READY ise bu da dahil)
          openQty: requested.minus(shipped),
          thisShipment, // bu oturumun bu satıra düşürdüğü/düşüreceği metraj
        };
      }),
    }));

    const totalMeters = rollsForAlloc.reduce((s, r) => s.plus(r.currentQty), D0());
    const totalKg = shipment.sacks.reduce(
      (s, sk) => s.plus(sk.weightKg ?? 0),
      D0()
    );

    // Çuval içeriği — toplar/kartelalar + ürün-bazlı özet (irsaliye/detay dökümü).
    const sacks = shipment.sacks.map((sk) => {
      const summaryMap = new Map<
        string,
        {
          itemCode: string;
          itemName: string;
          colorCode: string | null;
          colorName: string | null;
          width: Prisma.Decimal | null;
          totalQty: Prisma.Decimal;
          rollCount: number;
        }
      >();
      for (const r of sk.rolls) {
        const key = `${r.item.code}|${r.color?.code ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
        let e = summaryMap.get(key);
        if (!e) {
          e = {
            itemCode: r.item.code,
            itemName: r.item.name,
            colorCode: r.color?.code ?? null,
            colorName: r.color?.name ?? null,
            width: r.width,
            totalQty: D0(),
            rollCount: 0,
          };
          summaryMap.set(key, e);
        }
        e.totalQty = e.totalQty.plus(r.currentQty);
        e.rollCount += 1;
      }
      return {
        id: sk.id,
        sackNo: sk.sackNo,
        seq: sk.seq,
        manualCode: sk.manualCode,
        weightKg: sk.weightKg,
        rolls: sk.rolls,
        swatches: sk.swatches,
        productSummary: [...summaryMap.values()],
        rollCount: sk.rolls.length,
        swatchCount: sk.swatches.length,
      };
    });

    // Issue A: iade edilen toplar shipmentId=null olduğundan canlı `shipment.rolls`'ta
    // görünmez. Geçmiş bütünlüğü için bu sevkiyattan iade edilenleri (iptal olmayan)
    // RollReturn'den ayrı çekip detayda "iade edilenler" olarak göster (gerçek gönderilen
    // = mevcut + iade). İade iptal edilirse top shipment.rolls'a geri döner + RollReturn
    // cancelled olur → buradan düşer; çift sayım olmaz.
    const returnRows = await prisma.rollReturn.findMany({
      where: { fromShipmentId: id, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        qty: true,
        width: true,
        createdAt: true,
        reasonText: true,
        roll: { select: { barcode: true } },
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
        reason: { select: { name: true, color: true } },
      },
    });
    const returnedRolls = returnRows.map((rr) => ({
      id: rr.id,
      barcode: rr.roll.barcode,
      item: rr.item,
      color: rr.color,
      width: rr.width,
      qty: rr.qty,
      returnedAt: rr.createdAt,
      reasonName: rr.reason?.name ?? rr.reasonText ?? null,
      reasonColor: rr.reason?.color ?? null,
    }));
    const returnedMeters = returnRows.reduce((s, r) => s.plus(r.qty), D0());

    return {
      success: true,
      data: {
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        carrier: shipment.carrier,
        readyAt: shipment.readyAt,
        dispatchedAt: shipment.dispatchedAt,
        customer: shipment.customer,
        branch: shipment.branch,
        orders,
        rolls: shipment.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          item: r.item,
          color: r.color,
          width: r.width,
          currentQty: r.currentQty,
          sackId: r.sackId,
        })),
        swatches: shipment.swatches,
        sacks,
        returnedRolls,
        summary: {
          rollCount: shipment.rolls.length,
          swatchCount: shipment.swatches.length,
          totalMeters,
          sackCount: shipment.sacks.length,
          totalKg,
          returnedCount: returnedRolls.length,
          returnedMeters,
        },
      },
    };
  }

  // =========================================================================
  // OKUTMA — top / kartela sevkiyata ekle / çıkar
  // =========================================================================

  /**
   * Barkod okut → top ya da kartelayı sevkiyata + AKTİF ÇUVALA ekle (depodaki serbest mal).
   * `sackId` verilirse içerik o çuvala yazılır (çuval-önce akış). Zaten bu sevkiyatta olan
   * bir top/kartela farklı bir aktif çuvala okutulursa o çuvala TAŞINIR (re-scan = aktar).
   */
  async scanIntoShipment(
    data: { shipmentId: string; barcode: string; sackId?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      select: { id: true, status: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyata top okutulabilir");
    }

    // Aktif çuval verildiyse bu sevkiyata ait olduğunu doğrula
    let targetSackId: string | null = null;
    if (data.sackId) {
      const sack = await prisma.sack.findUnique({
        where: { id: data.sackId },
        select: { id: true, shipmentId: true },
      });
      if (!sack || sack.shipmentId !== data.shipmentId) {
        throw AppError.badRequest("Çuval bu sevkiyata ait değil");
      }
      targetSackId = sack.id;
    }

    const code = data.barcode.trim();
    const roll = await prisma.roll.findUnique({
      where: { barcode: code },
      select: { id: true, status: true, shipmentId: true, sackId: true, barcode: true, currentQty: true },
    });
    if (roll) {
      if (roll.shipmentId === data.shipmentId) {
        // Zaten bu sevkiyatta — aktif çuval farklıysa o çuvala taşı (re-scan = aktar)
        if (targetSackId && roll.sackId !== targetSackId) {
          await prisma.roll.update({ where: { id: roll.id }, data: { sackId: targetSackId } });
          await AuditService.log({
            userId,
            action: "UPDATE",
            tableName: "ROLL",
            recordId: roll.id,
            newData: { kind: "SACK_MOVE", sackId: targetSackId, barcode: roll.barcode },
          });
          return {
            success: true,
            data: { kind: "ROLL", rollId: roll.id, sackId: targetSackId, currentQty: roll.currentQty },
            message: "Top bu çuvala taşındı",
          };
        }
        return {
          success: true,
          data: { kind: "ROLL", rollId: roll.id, sackId: roll.sackId },
          message: "Top zaten bu çuvalda",
        };
      }
      if (roll.shipmentId) throw AppError.conflict("Top başka bir sevkiyatta");
      if (roll.status !== RollStatus.WAREHOUSE) {
        throw AppError.badRequest(`Sadece depodaki toplar okutulabilir (bu top: ${roll.status})`);
      }
      // ATOMIK SAHİPLENME: top hâlâ boşta (shipmentId null) VE depodaysa
      // (WAREHOUSE) bu sevkiyata bağla. Okuma ile yazma arasında başka bir akış
      // (başka sevkiyat okutması / kartela sevki) topu kapmışsa count=0 döner →
      // çift-bağ yerine temiz çakışma hatası. (TOCTOU guard.)
      const claimed = await prisma.roll.updateMany({
        where: { id: roll.id, shipmentId: null, status: RollStatus.WAREHOUSE },
        data: { shipmentId: data.shipmentId, sackId: targetSackId },
      });
      if (claimed.count === 0) {
        throw AppError.conflict(
          "Top az önce başka bir akışa girdi (sevkiyat/kartela) — tekrar deneyin."
        );
      }
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: roll.id,
        newData: { kind: "SHIPMENT_SCAN", shipmentId: data.shipmentId, sackId: targetSackId, barcode: roll.barcode },
      });
      return {
        success: true,
        data: { kind: "ROLL", rollId: roll.id, sackId: targetSackId, currentQty: roll.currentQty },
        message: targetSackId ? "Top çuvala eklendi" : "Top sevkiyata eklendi",
      };
    }

    // Kartela (top değilse) — bitmiş ürün gibi çuvala konur
    const swatch = await prisma.swatch.findUnique({
      where: { barcode: code },
      select: { id: true, shipmentId: true, sackId: true, barcode: true },
    });
    if (!swatch) throw AppError.notFound(`Top/kartela bulunamadı: ${code}`);
    if (swatch.shipmentId === data.shipmentId) {
      if (targetSackId && swatch.sackId !== targetSackId) {
        await prisma.swatch.update({ where: { id: swatch.id }, data: { sackId: targetSackId } });
        await AuditService.log({
          userId,
          action: "UPDATE",
          tableName: "SWATCH",
          recordId: swatch.id,
          newData: { kind: "SACK_MOVE", sackId: targetSackId, barcode: swatch.barcode },
        });
        return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: targetSackId }, message: "Kartela bu çuvala taşındı" };
      }
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: swatch.sackId }, message: "Kartela zaten bu çuvalda" };
    }
    if (swatch.shipmentId) throw AppError.conflict("Kartela başka bir sevkiyatta");
    await prisma.swatch.update({ where: { id: swatch.id }, data: { shipmentId: data.shipmentId, sackId: targetSackId } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: swatch.id,
      newData: { kind: "SHIPMENT_SCAN", shipmentId: data.shipmentId, sackId: targetSackId, barcode: swatch.barcode },
    });
    return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: targetSackId }, message: targetSackId ? "Kartela çuvala eklendi" : "Kartela sevkiyata eklendi" };
  }

  /** Yanlış okutulan topu sevkiyattan çıkar (depoya geri döner). */
  async removeRollFromShipment(
    data: { shipmentId: string; rollId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, shipmentId: true, shipment: { select: { status: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.shipmentId !== data.shipmentId) throw AppError.badRequest("Top bu sevkiyatta değil");
    if (roll.shipment && roll.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevke hazır/sevk edilmiş sevkiyattan top çıkarılamaz");
    }
    await prisma.roll.update({ where: { id: data.rollId }, data: { shipmentId: null, sackId: null } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: data.rollId,
      newData: { kind: "SHIPMENT_UNSCAN", shipmentId: null, sackId: null },
    });
    return { success: true, data: {}, message: "Top sevkiyattan çıkarıldı" };
  }

  /** Kartelayı sevkiyattan çıkar. */
  async removeSwatchFromShipment(
    data: { shipmentId: string; swatchId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const swatch = await prisma.swatch.findUnique({
      where: { id: data.swatchId },
      select: { id: true, shipmentId: true, shipment: { select: { status: true } } },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (swatch.shipmentId !== data.shipmentId) throw AppError.badRequest("Kartela bu sevkiyatta değil");
    if (swatch.shipment && swatch.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevke hazır/sevk edilmiş sevkiyattan kartela çıkarılamaz");
    }
    await prisma.swatch.update({ where: { id: data.swatchId }, data: { shipmentId: null, sackId: null } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: data.swatchId,
      newData: { kind: "SHIPMENT_UNSCAN", shipmentId: null, sackId: null },
    });
    return { success: true, data: {}, message: "Kartela sevkiyattan çıkarıldı" };
  }

  /**
   * Topu çuvaldan çuvala (veya çuvalsızdan çuvala) taşı — aynı sevkiyat içi, tek dokunuş.
   * Stok hareketi değil; yalnız "hangi çuvalda" bilgisi değişir.
   */
  async moveRollToSack(
    data: { rollId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: {
        id: true,
        barcode: true,
        shipmentId: true,
        sackId: true,
        shipment: { select: { status: true } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.shipmentId) throw AppError.badRequest("Top bir sevkiyatta değil");
    if (roll.shipment && roll.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevke hazır/sevk edilmiş sevkiyatta çuval değiştirilemez");
    }
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, seq: true, shipmentId: true },
    });
    if (!sack || sack.shipmentId !== roll.shipmentId) {
      throw AppError.badRequest("Hedef çuval aynı sevkiyata ait değil");
    }
    if (roll.sackId === data.sackId) {
      return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
    }
    await prisma.roll.update({ where: { id: roll.id }, data: { sackId: data.sackId } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: { kind: "SACK_MOVE", sackId: data.sackId, barcode: roll.barcode },
    });
    return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: `Top Çuval ${sack.seq}'e taşındı` };
  }

  // =========================================================================
  // ÇUVAL — brüt tartı (no + kg) + İÇERİK (Roll/Swatch.sackId)
  // =========================================================================

  /**
   * Çuval aç. Çuval-önce akışta önce boş açılır (kg + kod sonra updateSack ile girilir),
   * içine top/kartela okutulur. weightKg / manualCode verilirse açılışta set edilir.
   */
  async addSack(
    data: { shipmentId: string; weightKg?: number | null; sackNo?: string | null; manualCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (data.weightKg != null && !(data.weightKg > 0)) {
      throw AppError.badRequest("Geçerli bir kg girilmeli");
    }
    const shipment = await prisma.shipment.findUnique({
      where: { id: data.shipmentId },
      select: { id: true, status: true, _count: { select: { sacks: true } } },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Yalnızca hazırlanan sevkiyata çuval eklenebilir");
    }

    const code = data.manualCode?.trim() || null; // serbest format, benzersizlik aranmaz

    const sack = await withBarcodeRetry(async () => {
      const sackNo = data.sackNo?.trim() || (await nextSackNo());
      return prisma.sack.create({
        data: {
          sackNo,
          shipmentId: data.shipmentId,
          seq: shipment._count.sacks + 1,
          manualCode: code,
          weightKg: data.weightKg != null ? new Prisma.Decimal(data.weightKg) : null,
        },
        select: { id: true, sackNo: true, seq: true, weightKg: true, manualCode: true },
      });
    });
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { sackNo: sack.sackNo, shipmentId: data.shipmentId, weightKg: data.weightKg ?? null, manualCode: code },
    });
    return {
      success: true,
      data: sack,
      message:
        data.weightKg != null ? `Çuval ${sack.seq} açıldı (${data.weightKg} kg)` : `Çuval ${sack.seq} açıldı`,
    };
  }

  /**
   * Çuval brüt tartısını ve/veya elle yazılan kodunu güncelle. weightKg ve manualCode'dan
   * en az biri verilmeli. Kod serbest formattır (benzersizlik aranmaz); boş ("") gelirse
   * temizlenir — Sevke Hazır/Sevk'te invariant kodu yine de zorunlu kılar.
   */
  async updateSack(
    data: { sackId: string; weightKg?: number | null; manualCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const hasWeight = data.weightKg !== undefined && data.weightKg !== null;
    const hasCode = data.manualCode !== undefined;
    if (!hasWeight && !hasCode) {
      throw AppError.badRequest("Tartı veya çuval kodu girilmeli");
    }
    if (hasWeight && !(data.weightKg! > 0)) throw AppError.badRequest("Geçerli bir kg girilmeli");

    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, shipment: { select: { status: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevke hazır/sevk edilmiş sevkiyatın çuvalı değiştirilemez");
    }

    const update: Prisma.SackUpdateInput = {};
    if (hasWeight) update.weightKg = new Prisma.Decimal(data.weightKg!);
    let codeForLog: string | null | undefined;
    if (hasCode) {
      const code = data.manualCode?.trim() || null; // serbest format, benzersizlik aranmaz
      update.manualCode = code;
      codeForLog = code;
    }

    await prisma.sack.update({ where: { id: data.sackId }, data: update });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: data.sackId,
      newData: { kind: "WEIGH", ...(hasWeight ? { weightKg: data.weightKg } : {}), ...(hasCode ? { manualCode: codeForLog } : {}) },
    });
    return { success: true, data: {}, message: "Çuval güncellendi" };
  }

  /** Çuvalı sil. Dolu çuval silinemez — önce içerik boşaltılmalı (içerik bütünlüğü). */
  async removeSack(sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        shipment: { select: { status: true } },
        _count: { select: { rolls: true, swatches: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevke hazır/sevk edilmiş sevkiyatın çuvalı silinemez");
    }
    if (sack._count.rolls > 0 || sack._count.swatches > 0) {
      throw AppError.conflict(
        "Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya sevkiyattan çıkar"
      );
    }
    await prisma.sack.delete({ where: { id: sackId } });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { sackNo: sack.sackNo },
    });
    return { success: true, data: {}, message: "Çuval silindi" };
  }

  // =========================================================================
  // SEVKE HAZIR (READY, rezerve) + SEVK (DISPATCH, stok+karşılanma burada düşer)
  // =========================================================================

  /** markReady / dispatch için sevkiyatı içerikle yükle (toplar + çuvallar + sipariş satırları). */
  private loadShipmentForFinalize(shipmentId: string) {
    return prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        readyAt: true,
        rolls: { select: { id: true, barcode: true, sackId: true, itemId: true, colorId: true, width: true, currentQty: true, status: true } },
        swatches: { select: { id: true, barcode: true, sackId: true } },
        sacks: { select: { id: true, seq: true, weightKg: true, manualCode: true } },
        orders: {
          select: {
            orderId: true,
            order: {
              select: {
                deadline: true,
                orderDate: true,
                lines: {
                  select: {
                    id: true,
                    itemId: true,
                    colorId: true,
                    width: true,
                    quantity: true,
                    shippedQty: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Sevke hazır / sevk öncesi değişmez kurallar: içerik var, her top+kartela bir çuvalda,
   * her çuval brüt tartılı VE elle yazılan kodu girilmiş. İrsaliyede içerik eksiksiz olsun.
   */
  private assertReadyInvariants(
    shipment: NonNullable<Awaited<ReturnType<ShippingService["loadShipmentForFinalize"]>>>
  ): void {
    if (shipment.rolls.length === 0 && shipment.swatches.length === 0) {
      throw AppError.badRequest("Boş sevkiyat hazırlanamaz — önce top/kartela okut");
    }
    if (shipment.sacks.length === 0) {
      throw AppError.badRequest("Önce en az bir çuval aç");
    }
    const looseRolls = shipment.rolls.filter((r) => !r.sackId).map((r) => r.barcode ?? r.id);
    const looseSwatches = shipment.swatches.filter((s) => !s.sackId).map((s) => s.barcode);
    if (looseRolls.length > 0 || looseSwatches.length > 0) {
      throw AppError.badRequest(
        `Şu top/kartelalar henüz bir çuvalda değil: ${[...looseRolls, ...looseSwatches].join(", ")}`
      );
    }
    const unweighed = shipment.sacks
      .filter((s) => s.weightKg == null || !new Prisma.Decimal(s.weightKg).greaterThan(0))
      .map((s) => s.seq);
    if (unweighed.length > 0) {
      throw AppError.badRequest(
        `Şu çuvalların tartısı girilmemiş: ${unweighed.map((n) => `#${n}`).join(", ")}`
      );
    }
    const uncoded = shipment.sacks.filter((s) => !s.manualCode || !s.manualCode.trim()).map((s) => s.seq);
    if (uncoded.length > 0) {
      throw AppError.badRequest(
        `Şu çuvalların kodu girilmemiş: ${uncoded.map((n) => `#${n}`).join(", ")}`
      );
    }
  }

  /** Spec-toplam → seçilen sipariş satırlarına termin→tarih FIFO tahsis (DISPATCH'te yazılır). */
  private computeShipmentAllocation(
    shipment: NonNullable<Awaited<ReturnType<ShippingService["loadShipmentForFinalize"]>>>
  ): { alloc: Map<string, Prisma.Decimal>; orderIds: string[]; rollIds: string[] } {
    const linesForAlloc: LineForAlloc[] = shipment.orders.flatMap((so) =>
      so.order.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        colorId: l.colorId,
        width: l.width,
        quantity: new Prisma.Decimal(l.quantity),
        shippedQty: new Prisma.Decimal(l.shippedQty),
        deadline: so.order.deadline,
        orderDate: so.order.orderDate,
        lineCreatedAt: l.createdAt,
      }))
    );
    // Yalnız WAREHOUSE toplar sevke katılır. İptal/scrap edilmiş ama shipmentId'si
    // (legacy/edge) duran toplar tahsise sayılmaz ve SHIPPED'a "diriltilmez".
    const shippableRolls = shipment.rolls.filter(
      (r) => r.status === RollStatus.WAREHOUSE
    );
    const rollsForAlloc: RollSpec[] = shippableRolls.map((r) => ({
      itemId: r.itemId,
      colorId: r.colorId,
      width: r.width,
      currentQty: new Prisma.Decimal(r.currentQty),
    }));
    return {
      alloc: allocate(rollsForAlloc, linesForAlloc),
      orderIds: shipment.orders.map((o) => o.orderId),
      rollIds: shippableRolls.map((r) => r.id),
    };
  }

  /**
   * Sevke Hazır — paketlendi, ara depoda/kapıda bekliyor. Stok/karşılanma BURADA DÜŞMEZ
   * (rezerve: toplar shipmentId'li ama WAREHOUSE → serbest stoğa sayılmaz). Karşılanma yalnız
   * fiilen sevkte (DISPATCH) kesinleşir. "Sevk onayı" açık modda ① yalnız buraya kadar gelir.
   */
  async markReady(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await this.loadShipmentForFinalize(shipmentId);
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("Sevkiyat zaten sevke hazır veya sevk edilmiş");
    }
    this.assertReadyInvariants(shipment);

    await prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.READY, readyAt: new Date() },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "READY", rollCount: shipment.rolls.length, sackCount: shipment.sacks.length },
    });
    return {
      success: true,
      data: { shipmentId, rollCount: shipment.rolls.length },
      message: "Sevke hazır — ara depoda/kapıda bekliyor (stok çıkışta düşülür)",
    };
  }

  /**
   * Sevk (çıkış) — "ambar aldı / kamyona yüklendi" anı. PREPARING ("Hemen Sevk Et") veya
   * READY ("Çıkış Ver") sevkiyat kabul edilir (ara depodan çıkış flag'den bağımsız). Karşılanma
   * (ShipmentAllocation + OrderLine.shippedQty), toplar SHIPPED ve sipariş status'u BURADA işlenir
   * → stok yalnız bu noktada düşer. İptalde geri alınamaz (DISPATCHED kilitli).
   */
  async dispatchShipment(
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await this.loadShipmentForFinalize(shipmentId);
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING && shipment.status !== ShipmentStatus.READY) {
      throw AppError.conflict("Yalnızca hazırlanan veya bekleyen sevkiyat sevk edilebilir");
    }
    this.assertReadyInvariants(shipment);

    const { alloc, orderIds, rollIds } = this.computeShipmentAllocation(shipment);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Tahsis kayıtları + satır shippedQty artır (karşılanma burada kesinleşir)
      for (const [orderLineId, qty] of alloc) {
        await tx.shipmentAllocation.create({ data: { shipmentId, orderLineId, qty } });
        await tx.orderLine.update({ where: { id: orderLineId }, data: { shippedQty: { increment: qty } } });
      }
      // Toplar sevk edildi (stok çıkışı)
      if (rollIds.length > 0) {
        await tx.roll.updateMany({ where: { id: { in: rollIds }, status: RollStatus.WAREHOUSE }, data: { status: RollStatus.SHIPPED } });
      }
      await recomputeOrderStatusForOrders(tx, orderIds);
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.DISPATCHED,
          dispatchedAt: now,
          readyAt: shipment.readyAt ?? now, // "Hemen Sevk Et"te READY'den geçilmediyse damgala
          ...(data.plateNumber !== undefined ? { plateNumber: data.plateNumber } : {}),
          ...(data.driverName !== undefined ? { driverName: data.driverName } : {}),
          ...(data.carrier !== undefined ? { carrier: data.carrier } : {}),
        },
      });
    });

    const allocatedTotal = [...alloc.values()].reduce((s, q) => s.plus(q), D0());
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: {
        kind: "DISPATCH",
        fromStatus: shipment.status,
        rollCount: rollIds.length,
        allocatedLines: alloc.size,
        allocatedTotal: allocatedTotal.toString(),
        plateNumber: data.plateNumber ?? null,
        driverName: data.driverName ?? null,
      },
    });
    return {
      success: true,
      data: { shipmentId, rollCount: rollIds.length, allocatedLines: alloc.size },
      message: "Sevk edildi — stok düştü, karşılanma kesinleşti",
    };
  }

  // =========================================================================
  // İPTAL (yıkıcı) — önizleme + uygula
  // =========================================================================

  /** İptal önizleme — depoya dönecek toplar + karşılanması geri alınacak siparişler. */
  async getCancelPreview(shipmentId: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        shipmentNo: true,
        status: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        rolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
        _count: { select: { swatches: true, sacks: true } },
        allocations: {
          select: {
            qty: true,
            orderLine: { select: { order: { select: { orderNumber: true } } } },
          },
        },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    const canCancel = shipment.status !== ShipmentStatus.DISPATCHED && shipment.status !== ShipmentStatus.CANCELLED;

    // Karşılanması geri alınacak siparişler (sipariş bazında metraj)
    const byOrder = new Map<string, Prisma.Decimal>();
    for (const a of shipment.allocations) {
      const ord = a.orderLine.order.orderNumber;
      byOrder.set(ord, (byOrder.get(ord) ?? D0()).plus(a.qty));
    }

    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        customerName: shipment.customer.name,
        branchName: shipment.branch?.name ?? null,
        canCancel,
        reason: canCancel ? null : "Sevk edilmiş veya iptal edilmiş sevkiyat iptal edilemez.",
        rolls: shipment.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          currentQty: r.currentQty,
          itemName: r.item.name,
          colorName: r.color?.name ?? null,
        })),
        swatchCount: shipment._count.swatches,
        sackCount: shipment._count.sacks,
        affectedOrders: [...byOrder.entries()].map(([orderNumber, qty]) => ({
          orderNumber,
          qty: qty.toString(),
        })),
      },
    };
  }

  /**
   * Sevkiyatı iptal et (soft → CANCELLED). PREPARING/READY iptal edilebilir: toplar/kartelalar
   * serbest (status zaten WAREHOUSE — karşılanma sevkte düşer, burada dokunulmaz), çuvallar (tartı)
   * silinir. DISPATCHED iptal edilemez. (Tahsis geri alma yalnız legacy kayıt güvenliği için kaldı.)
   */
  async cancelShipment(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        rolls: { select: { id: true } },
        allocations: { select: { id: true, orderLineId: true, qty: true } },
        orders: { select: { orderId: true } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) {
      return { success: true, data: { shipmentId }, message: "Sevkiyat zaten iptal edilmiş" };
    }
    if (shipment.status === ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Sevk edilmiş sevkiyat iptal edilemez");
    }

    const rollIds = shipment.rolls.map((r) => r.id);
    const orderIds = shipment.orders.map((o) => o.orderId);
    // Yeni modelde karşılanma yalnız DISPATCH'te yazılır; PREPARING/READY'de tahsis yoktur
    // (DISPATCHED zaten iptal edilemez). hadAllocations defansif: eski/legacy kayıt güvenliği.
    const hadAllocations = shipment.allocations.length > 0;

    await prisma.$transaction(async (tx) => {
      // Tahsis varsa geri al — satır shippedQty düş + tahsis sil (legacy güvenliği)
      if (hadAllocations) {
        for (const a of shipment.allocations) {
          await tx.orderLine.update({
            where: { id: a.orderLineId },
            data: { shippedQty: { decrement: a.qty } },
          });
        }
        await tx.shipmentAllocation.deleteMany({ where: { shipmentId } });
      }
      // Toplar serbest — shipment/çuval bağı kopar. PREPARING/READY'de status zaten WAREHOUSE;
      // tahsis varsa (legacy SHIPPED) WAREHOUSE'a geri çek.
      if (rollIds.length > 0) {
        await tx.roll.updateMany({
          where: { id: { in: rollIds } },
          data: { shipmentId: null, sackId: null, ...(hadAllocations ? { status: RollStatus.WAREHOUSE } : {}) },
        });
      }
      // Kartelalar serbest
      await tx.swatch.updateMany({ where: { shipmentId }, data: { shipmentId: null, sackId: null } });
      // Çuvallar (tartı) silinir
      await tx.sack.deleteMany({ where: { shipmentId } });
      // Sipariş status/shippedQty senkron (yalnız tahsis geri alındıysa)
      if (hadAllocations) await recomputeOrderStatusForOrders(tx, orderIds);
      // Sevkiyat iptal
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: ShipmentStatus.CANCELLED } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "CANCEL", freedRolls: rollIds.length, reversedAllocations: shipment.allocations.length },
    });

    return {
      success: true,
      data: { shipmentId, freedRolls: rollIds.length },
      message:
        rollIds.length > 0
          ? `Sevkiyat iptal edildi — ${rollIds.length} top depoya döndü`
          : "Sevkiyat iptal edildi",
    };
  }

  // =========================================================================
  // SİPARİŞ SEÇİM EKRANI — açık siparişler + depo karşılaması (Mod A girişi)
  // =========================================================================

  /**
   * Açık siparişler + her satırda depo karşılaması. Personel sipariş-önce ekranı:
   * "depodaki mal bu siparişi karşılıyor mu". Depo serbest stoğu (shipmentId=null,
   * WAREHOUSE) açık satırlara termin→tarih FIFO greedy dağıtılarak satır başına
   * "depodan karşılanabilir" gösterilir (rezerve YOK — anlık foto). Termine sıralı.
   */
  async listOpenOrdersWithCoverage(params: {
    customerId?: string;
    branchId?: string | null;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.OrderWhereInput = {
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
    };
    if (params.customerId) where.customerId = params.customerId;
    if (params.branchId !== undefined) where.branchId = params.branchId;

    const orders = await prisma.order.findMany({
      where,
      take: 300,
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }],
      select: {
        id: true,
        orderNumber: true,
        status: true,
        deadline: true,
        orderDate: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        lines: {
          select: {
            id: true,
            itemId: true,
            colorId: true,
            width: true,
            quantity: true,
            shippedQty: true,
            customerItemName: true,
            customerColorName: true,
            createdAt: true,
            item: { select: { id: true, code: true, name: true } },
            color: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (orders.length === 0) return { success: true, data: [] };

    // Bu siparişler zaten aktif (PREPARING/READY) bir sevkiyatta mı? → ekranda "Sürdür".
    const activeLinks = await prisma.shipmentOrder.findMany({
      where: {
        orderId: { in: orders.map((o) => o.id) },
        shipment: { status: { in: [ShipmentStatus.PREPARING, ShipmentStatus.READY] } },
      },
      select: { orderId: true, shipment: { select: { id: true, shipmentNo: true, status: true } } },
    });
    const activeByOrder = new Map<string, { id: string; shipmentNo: string; status: ShipmentStatus }>();
    for (const a of activeLinks) activeByOrder.set(a.orderId, a.shipment);

    // Depodaki serbest stok — spec bazında TOPLAM (groupBy; tüm roll satırlarını
    // belleğe çekmez). Anlık foto: rezerve YOK, çift sayım serbest (aynı spec birden
    // çok kalemde tam stoğu görür) — gerçek tahsis Sevke Hazır'da FIFO yapılır.
    // (Eski hâl tüm rolleri yükleyip global FIFO koşuyordu → ağır + başka müşterinin
    //  önceliği yüzünden "yanlış eksik" görünebiliyordu.)
    const itemIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)))];
    const stockBySpec = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width"],
      where: { shipmentId: null, status: RollStatus.WAREHOUSE, itemId: { in: itemIds } },
      _sum: { currentQty: true },
    });
    // Bir satırın spec'ine uyan toplam depo stoğu (renk/en line'da boşsa gevşek eşleşir).
    const specAvail = (line: {
      itemId: string;
      colorId: string | null;
      width: Prisma.Decimal | null;
    }): Prisma.Decimal =>
      stockBySpec.reduce((sum, g) => {
        if (g.itemId !== line.itemId) return sum;
        if (line.colorId != null && g.colorId !== line.colorId) return sum;
        if (
          line.width != null &&
          (g.width == null || !new Prisma.Decimal(line.width).equals(g.width))
        ) {
          return sum;
        }
        return sum.plus(g._sum.currentQty ?? 0);
      }, D0());

    const data = orders.map((o) => ({
      order: {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        deadline: o.deadline,
        customer: o.customer,
        branch: o.branch,
        activeShipment: activeByOrder.get(o.id) ?? null, // doluysa: zaten sevkiyatta → "Sürdür"
      },
      lines: o.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const openQty = requested.minus(shipped);
        const fromWarehouse = specAvail(l);
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: l.customerItemName,
          customerColorName: l.customerColorName,
          requested,
          shipped,
          openQty,
          warehouseAvailable: fromWarehouse, // o spec'ten depodaki toplam (anlık, rezerve yok)
          covered: openQty.lessThanOrEqualTo(0) || fromWarehouse.greaterThanOrEqualTo(openQty),
        };
      }),
    }));

    return { success: true, data };
  }
}

export const shippingService = new ShippingService();
