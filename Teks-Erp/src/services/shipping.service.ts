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

import {
  Prisma,
  RollStatus,
  SackStatus,
  ShipmentStatus,
  OrderStatus,
  WorkOrderStatus,
} from "@prisma/client";
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
        select: { id: true, status: true, customerId: true, branchId: true },
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

    // Çuval = tek müşteri: topun hedef siparişinin müşterisi çuvalla aynı olmalı.
    // Kapalı (iptal/tamamlanmış) siparişe ait top paketlenemez — önce yönlendir.
    const line = await prisma.orderLine.findUnique({
      where: { id: effectiveLineId },
      select: { order: { select: { customerId: true, branchId: true, status: true } } },
    });
    if (!line) throw AppError.notFound("Hedef sipariş satırı bulunamadı");
    if (
      line.order.status === OrderStatus.CANCELLED ||
      line.order.status === OrderStatus.COMPLETED
    ) {
      throw AppError.badRequest("Topun siparişi kapalı (iptal/tamamlanmış) — önce yönlendir.");
    }
    if (line.order.customerId !== sack.customerId) {
      throw AppError.badRequest(
        "Bu top başka müşterinin siparişine etiketli. Yön değiştirmek için önce yönlendir."
      );
    }
    // Çuval = tek müşteri + tek şube. Çuvalın şubesi belliyse siparişin şubesiyle
    // eşleşmeli; çuval henüz şubesizse ilk topun siparişinin şubesine kilitlenir
    // (teslim adresi snapshot'ı da bu şubeden alınır). null şube = "belirtilmemiş".
    const orderBranchId = line.order.branchId ?? null;
    if (sack.branchId != null && orderBranchId !== sack.branchId) {
      throw AppError.badRequest(
        "Bu çuval başka bir şubeye ait. Aynı müşteri+şubenin siparişine ait top eklenebilir."
      );
    }
    const lockBranch = sack.branchId == null && orderBranchId != null;

    await prisma.$transaction(async (tx) => {
      await tx.roll.update({
        where: { id: roll.id },
        data: {
          sackId: sack.id,
          ...(data.targetOrderLineId !== undefined ? { targetOrderLineId: data.targetOrderLineId } : {}),
        },
      });
      if (lockBranch) {
        await tx.sack.update({ where: { id: sack.id }, data: { branchId: orderBranchId } });
      }
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
        select: { id: true, status: true, customerId: true, branchId: true },
      }),
    ]);
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.status !== SackStatus.OPEN) throw AppError.conflict("Çuval açık değil; kartela eklenemez");

    const effectiveLineId =
      data.targetOrderLineId !== undefined ? data.targetOrderLineId : swatch.targetOrderLineId;
    let lockBranch = false;
    let orderBranchId: string | null = null;
    if (effectiveLineId) {
      const line = await prisma.orderLine.findUnique({
        where: { id: effectiveLineId },
        select: { order: { select: { customerId: true, branchId: true } } },
      });
      if (!line) throw AppError.notFound("Hedef sipariş satırı bulunamadı");
      if (line.order.customerId !== sack.customerId) {
        throw AppError.badRequest("Kartela başka müşterinin siparişine ait");
      }
      // Çuval tek şube — assignRoll ile aynı kural (bkz. assignRoll yorumu).
      orderBranchId = line.order.branchId ?? null;
      if (sack.branchId != null && orderBranchId !== sack.branchId) {
        throw AppError.badRequest(
          "Bu çuval başka bir şubeye ait. Aynı müşteri+şubenin siparişine ait kartela eklenebilir."
        );
      }
      lockBranch = sack.branchId == null && orderBranchId != null;
    }

    await prisma.$transaction(async (tx) => {
      await tx.swatch.update({
        where: { id: swatch.id },
        data: {
          sackId: sack.id,
          ...(data.targetOrderLineId !== undefined ? { targetOrderLineId: data.targetOrderLineId } : {}),
        },
      });
      if (lockBranch) {
        await tx.sack.update({ where: { id: sack.id }, data: { branchId: orderBranchId } });
      }
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

  /**
   * Yanlış açılan / boşaltılacak çuvalı İPTAL et (soft delete → status=CANCELLED).
   * Sadece AÇIK çuval iptal edilebilir — kapanmış (CLOSED) / sevk edilmiş (SHIPPED)
   * çuvalı geri almak sevk muhasebesini ters çevirmek demektir (ayrı akış).
   * İçindeki top/kartela serbest bırakılır (sackId=null) → sevke-hazır havuza döner.
   */
  async cancelSack(sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        status: true,
        rolls: { select: { id: true } },
        swatches: { select: { id: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.status === SackStatus.CANCELLED) {
      return { success: true, data: { sackId }, message: "Çuval zaten iptal edilmiş" };
    }
    if (sack.status !== SackStatus.OPEN) {
      throw AppError.conflict(
        "Yalnızca açık çuval iptal edilebilir. Kapanmış/sevk edilmiş çuval iptal edilemez."
      );
    }

    const rollIds = sack.rolls.map((r) => r.id);
    const swatchIds = sack.swatches.map((s) => s.id);

    await prisma.$transaction(async (tx) => {
      if (rollIds.length > 0) {
        await tx.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null } });
      }
      if (swatchIds.length > 0) {
        await tx.swatch.updateMany({ where: { id: { in: swatchIds } }, data: { sackId: null } });
      }
      await tx.sack.update({ where: { id: sackId }, data: { status: SackStatus.CANCELLED } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: sackId,
      newData: {
        kind: "CANCEL",
        sackNo: sack.sackNo,
        freedRolls: rollIds.length,
        freedSwatches: swatchIds.length,
      },
    });

    return {
      success: true,
      data: { sackId, freedRolls: rollIds.length, freedSwatches: swatchIds.length },
      message:
        rollIds.length + swatchIds.length > 0
          ? `Çuval iptal edildi — ${rollIds.length} top, ${swatchIds.length} kartela serbest bırakıldı`
          : "Çuval iptal edildi",
    };
  }

  /**
   * İptal önizleme — yıkıcı işlem onayı için serbest bırakılacak top/kartelaları
   * somut listeler (CLAUDE.md: "X kayıt etkilenecek" yetmez, her kaydı göster).
   */
  async getSackCancelPreview(sackId: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        status: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        rolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            targetOrderLine: { select: { order: { select: { orderNumber: true } } } },
          },
        },
        swatches: { select: { id: true, barcode: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");

    const canCancel = sack.status === SackStatus.OPEN;
    return {
      success: true,
      data: {
        sackId: sack.id,
        sackNo: sack.sackNo,
        status: sack.status,
        customerName: sack.customer.name,
        branchName: sack.branch?.name ?? null,
        canCancel,
        reason: canCancel
          ? null
          : "Yalnızca açık çuval iptal edilebilir (kapanmış/sevk edilmiş çuval iptal edilemez).",
        rolls: sack.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          currentQty: r.currentQty,
          orderNumber: r.targetOrderLine?.order.orderNumber ?? null,
        })),
        swatches: sack.swatches.map((s) => ({ id: s.id, barcode: s.barcode })),
      },
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

  // =========================================================================
  // SEVKE HAZIR + DEĞİŞEBİLİR ETİKET
  // =========================================================================

  /**
   * Sevke Hazır — depoda etiketli (WAREHOUSE + targetOrderLineId) ve henüz
   * çuvalda olmayan topu bulunan AÇIK siparişler. Mod A listesini besler.
   * Her satıra istenen/sevk/rezerve/açık metraj + hazır top sayısı/metrajı eklenir.
   */
  async getReadyForShipping(): Promise<ApiResponse<unknown>> {
    // 1) Depoda etiketli, çuvalda olmayan hazır toplar — satır başına topla
    const readyGrouped = await prisma.roll.groupBy({
      by: ["targetOrderLineId"],
      where: { status: RollStatus.WAREHOUSE, targetOrderLineId: { not: null }, sackId: null },
      _sum: { currentQty: true },
      _count: true,
    });
    if (readyGrouped.length === 0) return { success: true, data: [] };

    const readyByLine = new Map<string, { readyQty: Prisma.Decimal; readyCount: number }>();
    for (const g of readyGrouped) {
      if (g.targetOrderLineId) {
        readyByLine.set(g.targetOrderLineId, {
          readyQty: g._sum.currentQty ?? new Prisma.Decimal(0),
          readyCount: g._count,
        });
      }
    }
    const lineIds = [...readyByLine.keys()];

    // 2) Satırları sipariş + müşteri + ürün/renk + canlı WO bağlarıyla çek (açık siparişler)
    const lines = await prisma.orderLine.findMany({
      where: {
        id: { in: lineIds },
        order: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
      },
      select: {
        id: true,
        quantity: true,
        width: true,
        customerItemName: true,
        customerColorName: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            deadline: true,
            status: true,
            createdAt: true,
            customer: { select: { id: true, code: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        workOrderLinks: {
          select: { allocatedQty: true, workOrder: { select: { status: true } } },
        },
      },
    });

    // 3) Sevk edilen metraj — satır başına (SHIPPED)
    const shippedByLine = new Map<string, Prisma.Decimal>();
    const shippedGrouped = await prisma.roll.groupBy({
      by: ["targetOrderLineId"],
      where: { targetOrderLineId: { in: lineIds }, status: RollStatus.SHIPPED },
      _sum: { currentQty: true },
    });
    for (const g of shippedGrouped) {
      if (g.targetOrderLineId) {
        shippedByLine.set(g.targetOrderLineId, g._sum.currentQty ?? new Prisma.Decimal(0));
      }
    }

    const BLOCKING: WorkOrderStatus[] = [
      WorkOrderStatus.PLANNED,
      WorkOrderStatus.IN_PROGRESS,
      WorkOrderStatus.PAUSED,
      WorkOrderStatus.COMPLETED,
    ];

    // 4) Satırları zenginleştir + sipariş bazında grupla
    type ReadyOrder = {
      order: {
        id: string;
        orderNumber: string;
        status: OrderStatus;
        deadline: Date | null;
        createdAt: Date;
        customer: { id: string; code: string; name: string };
        branch: { id: string; name: string } | null;
      };
      lines: unknown[];
    };
    const byOrder = new Map<string, ReadyOrder>();
    for (const l of lines) {
      const ready = readyByLine.get(l.id) ?? { readyQty: new Prisma.Decimal(0), readyCount: 0 };
      const shipped = shippedByLine.get(l.id) ?? new Prisma.Decimal(0);
      const reserved = l.workOrderLinks.reduce(
        (sum, link) =>
          BLOCKING.includes(link.workOrder.status) ? sum.plus(link.allocatedQty ?? 0) : sum,
        new Prisma.Decimal(0),
      );
      const openQty = new Prisma.Decimal(l.quantity).minus(shipped).minus(reserved);

      const o = l.order;
      if (!byOrder.has(o.id)) {
        byOrder.set(o.id, {
          order: {
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            deadline: o.deadline,
            createdAt: o.createdAt,
            customer: o.customer,
            branch: o.branch,
          },
          lines: [],
        });
      }
      byOrder.get(o.id)!.lines.push({
        lineId: l.id,
        item: l.item,
        color: l.color,
        width: l.width,
        customerItemName: l.customerItemName,
        customerColorName: l.customerColorName,
        requested: l.quantity,
        shipped,
        reserved,
        openQty,
        readyQty: ready.readyQty,
        readyCount: ready.readyCount,
      });
    }

    // 5) Termine göre sırala (null en sona), eşitlikte oluşturulma sırası
    const data = [...byOrder.values()].sort((a, b) => {
      const ad = a.order.deadline ? a.order.deadline.getTime() : Infinity;
      const bd = b.order.deadline ? b.order.deadline.getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return a.order.createdAt.getTime() - b.order.createdAt.getTime();
    });

    return { success: true, data };
  }

  /**
   * Değişebilir etiket / yönlendir — topun targetOrderLineId atıfını değiştirir.
   * Bu bir STOK HAREKETİ DEĞİLDİR; sadece "kime sayılıyor" değişir.
   *   - SHIPPED / iptal / scrap / tüketilmiş top yeniden etiketlenemez.
   *   - STOCK top bir siparişe yönlendirilirse WAREHOUSE'a (sevke hazır havuza) alınır.
   *   - Spec uyumsuzluğu (ürün/renk/en) BLOK DEĞİL → specMismatch bayrağı (uyar-geç).
   *   - Eski + yeni siparişin karşılanması yeniden hesaplanır.
   * Fiziksel etiket sonradan tambur yazıcısından basılır (reprintRequired).
   */
  async relabelRoll(
    data: { rollId: string; targetOrderLineId: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: {
        id: true,
        status: true,
        barcode: true,
        itemId: true,
        colorId: true,
        width: true,
        sackId: true,
        sack: { select: { customerId: true, status: true } },
        targetOrderLineId: true,
        targetOrderLine: { select: { orderId: true } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const BLOCKED: RollStatus[] = [
      RollStatus.SHIPPED,
      RollStatus.CANCELLED,
      RollStatus.SCRAP,
      RollStatus.TAMBUR_CONSUMED,
      RollStatus.SUBCONTRACTOR_CONSUMED,
    ];
    if (BLOCKED.includes(roll.status)) {
      throw AppError.conflict(`Bu durumdaki top yeniden etiketlenemez (${roll.status})`);
    }

    const newLineId = data.targetOrderLineId;

    // No-op — atıf zaten aynı
    if ((roll.targetOrderLineId ?? null) === newLineId) {
      return {
        success: true,
        data: { rollId: roll.id, customerName: null, specMismatch: false, reprintRequired: false },
        message: "Etiket zaten aynı",
      };
    }

    // Hedef satır doğrulaması + spec uyumu (uyar-geç)
    let specMismatch = false;
    let newCustomerName: string | null = null;
    let newOrderId: string | null = null;
    let newCustomerId: string | null = null;
    if (newLineId) {
      const line = await prisma.orderLine.findUnique({
        where: { id: newLineId },
        select: {
          itemId: true,
          colorId: true,
          width: true,
          order: {
            select: {
              id: true,
              status: true,
              customer: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!line) throw AppError.notFound("Hedef sipariş satırı bulunamadı");
      if (
        line.order.status === OrderStatus.CANCELLED ||
        line.order.status === OrderStatus.COMPLETED
      ) {
        throw AppError.badRequest("İptal edilmiş veya tamamlanmış siparişe etiketlenemez");
      }
      newOrderId = line.order.id;
      newCustomerId = line.order.customer.id;
      newCustomerName = line.order.customer.name;
      const colorMismatch =
        line.colorId != null && roll.colorId != null && line.colorId !== roll.colorId;
      const widthMismatch =
        line.width != null &&
        roll.width != null &&
        !new Prisma.Decimal(line.width).equals(roll.width);
      specMismatch = line.itemId !== roll.itemId || colorMismatch || widthMismatch;
    }

    const oldOrderId = roll.targetOrderLine?.orderId ?? null;

    // Çuval bütünlüğü: top AÇIK bir çuvaldaysa ve yeni hedefin müşterisi çuvalın
    // müşterisinden farklıysa (veya etiket kaldırılıyorsa) topu çuvaldan çıkar —
    // çuval tek-müşteri kalmalı. Çapraz sevk tasarımca serbest; çuval bozulmaz.
    const popFromSack =
      roll.sackId != null &&
      roll.sack?.status === SackStatus.OPEN &&
      (newLineId == null || newCustomerId !== roll.sack.customerId);

    await prisma.$transaction(async (tx) => {
      await tx.roll.update({
        where: { id: roll.id },
        data: {
          targetOrderLineId: newLineId,
          // Müşteri etiketi değişti → fiziksel etiket tamburda yeniden basılmalı
          needsReprint: true,
          // STOCK topu sevke yönlendirilirse hazır havuza al
          ...(roll.status === RollStatus.STOCK && newLineId
            ? { status: RollStatus.WAREHOUSE }
            : {}),
          // Çuval müşterisi değişiyorsa topu çuvaldan çıkar
          ...(popFromSack ? { sackId: null } : {}),
        },
      });
      const affected = [
        ...new Set([oldOrderId, newOrderId].filter((x): x is string => Boolean(x))),
      ];
      await recomputeOrderStatusForOrders(tx, affected);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        kind: "RELABEL",
        from: roll.targetOrderLineId ?? null,
        to: newLineId,
        barcode: roll.barcode,
        specMismatch,
        poppedFromSack: popFromSack,
      },
    });

    return {
      success: true,
      data: {
        rollId: roll.id,
        customerName: newCustomerName,
        specMismatch,
        reprintRequired: true,
        poppedFromSack: popFromSack,
      },
      message: newLineId ? "Etiket güncellendi" : "Top stoğa alındı (etiket kaldırıldı)",
    };
  }

  /**
   * Hızlı Okut (Mod C) — barkodla top okut, sistem topun siparişinden müşteriyi
   * bulur ve o müşterinin AÇIK çuvalına ekler (yoksa çuval açar). Müşteri seçtirmez.
   * Stok etiketli (targetOrderLineId yok) top kabul edilmez → önce yönlendir.
   */
  async autoAssignByBarcode(
    data: { barcode: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { barcode: data.barcode },
      select: {
        id: true,
        status: true,
        sackId: true,
        barcode: true,
        targetOrderLine: {
          select: {
            order: {
              select: {
                status: true,
                customerId: true,
                branchId: true,
                customer: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound(`Top bulunamadı: ${data.barcode}`);
    if (roll.status !== RollStatus.WAREHOUSE) {
      throw AppError.badRequest(`Sadece depodaki toplar çuvallanabilir (bu top: ${roll.status})`);
    }
    if (roll.sackId) throw AppError.conflict("Top zaten bir çuvalda");
    if (!roll.targetOrderLine) {
      throw AppError.badRequest(
        "Top stok etiketli (müşteri/sipariş atanmamış). Önce yönlendir / etiketle."
      );
    }
    const order = roll.targetOrderLine.order;
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.COMPLETED) {
      throw AppError.badRequest("Topun siparişi kapalı (iptal/tamamlanmış) — önce yönlendir.");
    }
    const customerId = order.customerId;
    const customerName = order.customer.name;
    const orderBranchId = order.branchId ?? null;

    // Müşteri + şube eşleşen en yeni açık çuval; yoksa o müşteri+şube için aç.
    // (Çuval tek müşteri + tek şube — assignRoll ile aynı kural.)
    const existing = await prisma.sack.findFirst({
      where: { customerId, status: SackStatus.OPEN, branchId: orderBranchId },
      orderBy: { createdAt: "desc" },
      select: { id: true, sackNo: true },
    });

    let sackId: string;
    let sackNo: string;
    let createdSack = false;
    if (existing) {
      sackId = existing.id;
      sackNo = existing.sackNo;
    } else {
      createdSack = true;
      const sack = await withBarcodeRetry(async () => {
        const no = await nextSackNo();
        return prisma.sack.create({
          data: { sackNo: no, customerId, branchId: orderBranchId, status: SackStatus.OPEN },
          select: { id: true, sackNo: true },
        });
      });
      sackId = sack.id;
      sackNo = sack.sackNo;
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "SACK",
        recordId: sackId,
        newData: { sackNo, customerId, via: "AUTO_PACK" },
      });
    }

    await prisma.roll.update({ where: { id: roll.id }, data: { sackId } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: { kind: "AUTO_PACK_ASSIGN", sackId, sackNo, customerId, createdSack, barcode: roll.barcode },
    });

    return {
      success: true,
      data: { sackId, sackNo, customerId, customerName, createdSack },
      message: createdSack
        ? `${customerName} için çuval açıldı, top eklendi`
        : `${customerName} çuvalına eklendi`,
    };
  }

  // =========================================================================
  // PRINT-QUEUE — yeniden basılacak etiketler (tek yazıcı = tambur)
  // =========================================================================

  /** Relabel sonrası fiziksel etiketi yeniden basılacak toplar. Tambur listesi. */
  async getReprintQueue(): Promise<ApiResponse<unknown>> {
    const rolls = await prisma.roll.findMany({
      where: { needsReprint: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        barcode: true,
        width: true,
        currentQty: true,
        status: true,
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
        targetOrderLine: {
          select: {
            customerItemName: true,
            customerColorName: true,
            order: { select: { orderNumber: true, customer: { select: { name: true } } } },
          },
        },
      },
    });
    return { success: true, data: rolls };
  }

  /** Etiket basıldı → topu print-queue'dan düşür. */
  async markReprinted(rollId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, needsReprint: true, barcode: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.needsReprint) {
      return { success: true, data: {}, message: "Top zaten kuyrukta değil" };
    }
    await prisma.roll.update({ where: { id: rollId }, data: { needsReprint: false } });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: { kind: "REPRINT_DONE", barcode: roll.barcode },
    });
    return { success: true, data: {}, message: "Etiket basıldı olarak işaretlendi" };
  }
}

export const shippingService = new ShippingService();
