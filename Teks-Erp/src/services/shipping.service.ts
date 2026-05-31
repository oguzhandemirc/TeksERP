// =============================================================================
// Shipping Service — Çuval (Sack) + İrsaliye (Shipment)
// =============================================================================
// Akış:
//   1) Çuval aç (createSack)            → OPEN, tek müşteri + tek şube
//   2) Top/kartela okut (assignRoll)    → Roll.sackId + (gerekirse) targetOrderLineId
//   3) Tart + kapat (weighAndCloseSack) → CLOSED; toplar SHIPPED; Order.shippedQty
//      güncellenir + recomputeOrderStatus → "SEVK EDİLDİ" anı budur (karar: a)
//   4) İrsaliye (createShipment + addSack) → çuvalları bir müşteri+şube belgesinde grupla
//   5) dispatchShipment                  → DISPATCHED; çuvallar SHIPPED (kamyona yüklendi)
//
// Etiket SADECE tamburda basılır; bu modül etikete dokunmaz. Çuvala eklenen
// her top zaten bir müşteri/sipariş satırına etiketlidir (Roll.targetOrderLineId).
// =============================================================================

import { Prisma, RollStatus, SackStatus, ShipmentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { recomputeOrderStatusForOrders } from "./helpers/order-status.helper";
import { ApiResponse } from "../types/api.types";

// ---------------------------------------------------------------------------
// Sequence helpers — CV-YYMMDD-NNN (çuval), IRS-YYMMDD-NNN (irsaliye)
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

async function nextShipmentNo(): Promise<string> {
  const prefix = datePrefix("IRS-");
  const last = await prisma.shipment.findFirst({
    where: { shipmentNo: { startsWith: prefix } },
    orderBy: { shipmentNo: "desc" },
    select: { shipmentNo: true },
  });
  const seq = last ? parseInt(last.shipmentNo.split("-").pop() ?? "0", 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export class ShippingService {
  // =========================================================================
  // ÇUVAL (SACK)
  // =========================================================================

  /** Yeni açık çuval. sackNo verilmezse server üretir (offline için client de geçebilir). */
  async createSack(
    data: { customerId: string; branchId?: string | null; sackNo?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, isActive: true },
    });
    if (!customer || !customer.isActive) throw AppError.notFound("Müşteri bulunamadı");

    if (data.branchId) {
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { customerId: true, isActive: true },
      });
      if (!branch || !branch.isActive) throw AppError.notFound("Şube bulunamadı");
      if (branch.customerId !== data.customerId) {
        throw AppError.badRequest("Şube bu müşteriye ait değil");
      }
    }

    // sackNo: client verirse (offline barkod) onu kullan, yoksa server üret.
    // withBarcodeRetry server-üretiminde P2002 çakışmasında yeniden dener.
    const sack = await withBarcodeRetry(async () => {
      const sackNo = data.sackNo?.trim() || (await nextSackNo());
      return prisma.sack.create({
        data: {
          sackNo,
          customerId: data.customerId,
          branchId: data.branchId ?? null,
          status: SackStatus.OPEN,
        },
        select: { id: true, sackNo: true },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { sackNo: sack.sackNo, customerId: data.customerId, branchId: data.branchId ?? null },
    });

    return { success: true, data: sack, message: `Çuval açıldı: ${sack.sackNo}` };
  }

  /** Topu çuvala ekle. Top zaten bir sipariş satırına etiketli olmalı (stok topu pakette sevk edilemez). */
  async assignRoll(
    data: { rollId: string; sackId: string; targetOrderLineId?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const [roll, sack] = await Promise.all([
      prisma.roll.findUnique({
        where: { id: data.rollId },
        select: { id: true, status: true, sackId: true, targetOrderLineId: true, barcode: true },
      }),
      prisma.sack.findUnique({
        where: { id: data.sackId },
        select: { id: true, status: true, customerId: true },
      }),
    ]);
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.status !== SackStatus.OPEN) throw AppError.conflict("Çuval açık değil; top eklenemez");
    if (roll.status !== RollStatus.WAREHOUSE) {
      throw AppError.badRequest(`Sadece depodaki toplar çuvallanabilir (bu top: ${roll.status})`);
    }

    const effectiveLineId =
      data.targetOrderLineId !== undefined ? data.targetOrderLineId : roll.targetOrderLineId;
    if (!effectiveLineId) {
      throw AppError.badRequest(
        "Bu top stok etiketli (müşteri/sipariş atanmamış). Önce tamburda müşteri etiketi basılmalı."
      );
    }

    // Çuval = tek müşteri: topun hedef siparişinin müşterisi çuvalla aynı olmalı
    const line = await prisma.orderLine.findUnique({
      where: { id: effectiveLineId },
      select: { order: { select: { customerId: true } } },
    });
    if (!line) throw AppError.notFound("Hedef sipariş satırı bulunamadı");
    if (line.order.customerId !== sack.customerId) {
      throw AppError.badRequest(
        "Bu top başka müşterinin siparişine etiketli. Yön değiştirmek için tamburda yeni etiket basılmalı."
      );
    }

    await prisma.roll.update({
      where: { id: roll.id },
      data: {
        sackId: sack.id,
        ...(data.targetOrderLineId !== undefined ? { targetOrderLineId: data.targetOrderLineId } : {}),
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: { kind: "PACK_ASSIGN", sackId: sack.id, targetOrderLineId: effectiveLineId, barcode: roll.barcode },
    });

    return { success: true, data: {}, message: "Top çuvala eklendi" };
  }

  /** Topu çuvaldan çıkar (sadece çuval açıkken). */
  async removeRoll(rollId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, sackId: true, sack: { select: { status: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId) throw AppError.badRequest("Top zaten bir çuvalda değil");
    if (roll.sack && roll.sack.status !== SackStatus.OPEN) {
      throw AppError.conflict("Çuval kapalı; top çıkarılamaz");
    }

    await prisma.roll.update({ where: { id: rollId }, data: { sackId: null } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: { kind: "PACK_REMOVE", sackId: null },
    });
    return { success: true, data: {}, message: "Top çuvaldan çıkarıldı" };
  }

  /** Kartelayı çuvala ekle. */
  async assignSwatch(
    data: { swatchId: string; sackId: string; targetOrderLineId?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const [swatch, sack] = await Promise.all([
      prisma.swatch.findUnique({
        where: { id: data.swatchId },
        select: { id: true, sackId: true, targetOrderLineId: true },
      }),
      prisma.sack.findUnique({
        where: { id: data.sackId },
        select: { id: true, status: true, customerId: true },
      }),
    ]);
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.status !== SackStatus.OPEN) throw AppError.conflict("Çuval açık değil; kartela eklenemez");

    const effectiveLineId =
      data.targetOrderLineId !== undefined ? data.targetOrderLineId : swatch.targetOrderLineId;
    if (effectiveLineId) {
      const line = await prisma.orderLine.findUnique({
        where: { id: effectiveLineId },
        select: { order: { select: { customerId: true } } },
      });
      if (!line) throw AppError.notFound("Hedef sipariş satırı bulunamadı");
      if (line.order.customerId !== sack.customerId) {
        throw AppError.badRequest("Kartela başka müşterinin siparişine ait");
      }
    }

    await prisma.swatch.update({
      where: { id: swatch.id },
      data: {
        sackId: sack.id,
        ...(data.targetOrderLineId !== undefined ? { targetOrderLineId: data.targetOrderLineId } : {}),
      },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: swatch.id,
      newData: { kind: "PACK_ASSIGN", sackId: sack.id, targetOrderLineId: effectiveLineId ?? null },
    });
    return { success: true, data: {}, message: "Kartela çuvala eklendi" };
  }

  /** Kartelayı çuvaldan çıkar. */
  async removeSwatch(swatchId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const swatch = await prisma.swatch.findUnique({
      where: { id: swatchId },
      select: { id: true, sackId: true, sack: { select: { status: true } } },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (!swatch.sackId) throw AppError.badRequest("Kartela zaten bir çuvalda değil");
    if (swatch.sack && swatch.sack.status !== SackStatus.OPEN) {
      throw AppError.conflict("Çuval kapalı; kartela çıkarılamaz");
    }
    await prisma.swatch.update({ where: { id: swatchId }, data: { sackId: null } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH",
      recordId: swatchId,
      newData: { kind: "PACK_REMOVE", sackId: null },
    });
    return { success: true, data: {}, message: "Kartela çuvaldan çıkarıldı" };
  }

  /**
   * Çuvalı tart + kapat = "SEVK EDİLDİ" anı.
   * İçindeki toplar SHIPPED'a çekilir, şube adresi snapshot'lanır,
   * etkilenen siparişlerin shippedQty + status'u yeniden hesaplanır.
   */
  async weighAndCloseSack(
    data: { sackId: string; weightKg: number },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (data.weightKg <= 0) throw AppError.badRequest("Geçerli bir kg girilmeli");

    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      include: {
        branch: { select: { name: true, address: true, city: true, district: true } },
        customer: { select: { name: true } },
        rolls: { select: { id: true, status: true, targetOrderLineId: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.status !== SackStatus.OPEN) throw AppError.conflict("Yalnızca açık çuval kapatılabilir");
    if (sack.rolls.length === 0) throw AppError.badRequest("Boş çuval kapatılamaz");

    const result = await prisma.$transaction(async (tx) => {
      const rollIds = sack.rolls
        .filter((r) => r.status !== RollStatus.SHIPPED)
        .map((r) => r.id);
      if (rollIds.length > 0) {
        await tx.roll.updateMany({
          where: { id: { in: rollIds } },
          data: { status: RollStatus.SHIPPED },
        });
      }

      await tx.sack.update({
        where: { id: sack.id },
        data: {
          status: SackStatus.CLOSED,
          weightKg: new Prisma.Decimal(data.weightKg),
          closedAt: new Date(),
          shipToName: sack.branch?.name ?? sack.customer.name,
          shipToAddress: sack.branch?.address ?? null,
          shipToCity: sack.branch?.city ?? null,
          shipToDistrict: sack.branch?.district ?? null,
        },
      });

      // Etkilenen siparişler — targetOrderLineId'lerden orderId çıkar
      const lineIds = [
        ...new Set(
          sack.rolls
            .map((r) => r.targetOrderLineId)
            .filter((x): x is string => Boolean(x))
        ),
      ];
      let orderIds: string[] = [];
      if (lineIds.length > 0) {
        const lines = await tx.orderLine.findMany({
          where: { id: { in: lineIds } },
          select: { orderId: true },
        });
        orderIds = [...new Set(lines.map((l) => l.orderId))];
      }
      await recomputeOrderStatusForOrders(tx, orderIds);

      return { rollCount: rollIds.length, affectedOrders: orderIds.length };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { kind: "WEIGH_CLOSE", weightKg: data.weightKg, ...result },
    });

    return {
      success: true,
      data: { sackId: sack.id, ...result },
      message: "Çuval tartıldı ve kapatıldı (sevk edildi)",
    };
  }

  async getSackById(id: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        rolls: {
          select: { id: true, barcode: true, currentQty: true, status: true, targetOrderLineId: true },
        },
        swatches: { select: { id: true, barcode: true, length: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    return { success: true, data: sack };
  }

  /** Çuval listesi — müşteri / durum / sevkiyata bağlanmamış filtreleri. */
  async listSacks(params: {
    customerId?: string;
    status?: SackStatus;
    unassignedOnly?: boolean;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.SackWhereInput = {};
    if (params.customerId) where.customerId = params.customerId;
    if (params.status) where.status = params.status;
    if (params.unassignedOnly) where.shipmentId = null;

    const sacks = await prisma.sack.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        sackNo: true,
        status: true,
        weightKg: true,
        shipmentId: true,
        createdAt: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { rolls: true, swatches: true } },
      },
    });
    return { success: true, data: sacks };
  }

  // =========================================================================
  // İRSALİYE (SHIPMENT)
  // =========================================================================

  async createShipment(
    data: {
      customerId: string;
      branchId?: string | null;
      plateNumber?: string | null;
      driverName?: string | null;
      carrier?: string | null;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, isActive: true },
    });
    if (!customer || !customer.isActive) throw AppError.notFound("Müşteri bulunamadı");

    if (data.branchId) {
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { customerId: true },
      });
      if (!branch) throw AppError.notFound("Şube bulunamadı");
      if (branch.customerId !== data.customerId) throw AppError.badRequest("Şube bu müşteriye ait değil");
    }

    const shipment = await withBarcodeRetry(async () => {
      const shipmentNo = await nextShipmentNo();
      return prisma.shipment.create({
        data: {
          shipmentNo,
          customerId: data.customerId,
          branchId: data.branchId ?? null,
          status: ShipmentStatus.PREPARING,
          plateNumber: data.plateNumber ?? null,
          driverName: data.driverName ?? null,
          carrier: data.carrier ?? null,
        },
        select: { id: true, shipmentNo: true, status: true },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SHIPMENT",
      recordId: shipment.id,
      newData: { shipmentNo: shipment.shipmentNo, customerId: data.customerId, branchId: data.branchId ?? null },
    });

    return { success: true, data: shipment, message: `İrsaliye oluşturuldu: ${shipment.shipmentNo}` };
  }

  /** Kapalı çuvalı irsaliyeye bağla (aynı müşteri). */
  async addSack(shipmentId: string, sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const [shipment, sack] = await Promise.all([
      prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, customerId: true },
      }),
      prisma.sack.findUnique({
        where: { id: sackId },
        select: { id: true, status: true, customerId: true, shipmentId: true },
      }),
    ]);
    if (!shipment) throw AppError.notFound("İrsaliye bulunamadı");
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("İrsaliye hazırlanıyor durumunda değil");
    }
    if (sack.status !== SackStatus.CLOSED) {
      throw AppError.badRequest("Önce çuval tartılıp kapatılmalı");
    }
    if (sack.customerId !== shipment.customerId) {
      throw AppError.badRequest("Çuval ve irsaliye müşterisi farklı");
    }
    if (sack.shipmentId && sack.shipmentId !== shipmentId) {
      throw AppError.conflict("Çuval başka bir irsaliyede");
    }

    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: sackId,
      newData: { kind: "SHIPMENT_ADD", shipmentId },
    });
    return { success: true, data: {}, message: "Çuval irsaliyeye eklendi" };
  }

  async removeSack(shipmentId: string, sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { id: true, shipmentId: true, shipment: { select: { status: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId !== shipmentId) throw AppError.badRequest("Çuval bu irsaliyede değil");
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("İrsaliye sevk edilmiş; çuval çıkarılamaz");
    }
    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId: null } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: sackId,
      newData: { kind: "SHIPMENT_REMOVE", shipmentId: null },
    });
    return { success: true, data: {}, message: "Çuval irsaliyeden çıkarıldı" };
  }

  /** İrsaliyeyi sevk et (kamyona yükle) — DISPATCHED, çuvallar SHIPPED. */
  async dispatchShipment(
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, _count: { select: { sacks: true } } },
    });
    if (!shipment) throw AppError.notFound("İrsaliye bulunamadı");
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw AppError.conflict("İrsaliye zaten sevk edilmiş veya iptal");
    }
    if (shipment._count.sacks === 0) throw AppError.badRequest("İrsaliyede çuval yok");

    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.DISPATCHED,
          dispatchedAt: new Date(),
          ...(data.plateNumber !== undefined ? { plateNumber: data.plateNumber } : {}),
          ...(data.driverName !== undefined ? { driverName: data.driverName } : {}),
          ...(data.carrier !== undefined ? { carrier: data.carrier } : {}),
        },
      });
      await tx.sack.updateMany({
        where: { shipmentId },
        data: { status: SackStatus.SHIPPED },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "DISPATCH", plateNumber: data.plateNumber ?? null, driverName: data.driverName ?? null },
    });

    return { success: true, data: { shipmentId }, message: "İrsaliye sevk edildi" };
  }

  async getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        sacks: {
          select: {
            id: true,
            sackNo: true,
            status: true,
            weightKg: true,
            _count: { select: { rolls: true, swatches: true } },
          },
        },
      },
    });
    if (!shipment) throw AppError.notFound("İrsaliye bulunamadı");
    return { success: true, data: shipment };
  }

  async listShipments(params: {
    status?: ShipmentStatus;
    customerId?: string;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.ShipmentWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.customerId) where.customerId = params.customerId;

    const shipments = await prisma.shipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        shipmentNo: true,
        status: true,
        plateNumber: true,
        driverName: true,
        carrier: true,
        dispatchedAt: true,
        createdAt: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { sacks: true } },
      },
    });
    return { success: true, data: shipments };
  }
}

export const shippingService = new ShippingService();
