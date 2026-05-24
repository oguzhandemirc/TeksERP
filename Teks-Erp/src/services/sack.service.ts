// =============================================================================
// TeksERP - Sack (Çuval) Service
// =============================================================================
// Tartı/Paket çıktısı: bir müşteriye ait, içinde N top + N kartela.
//
// İŞ KURALLARI:
//   - Bir çuval bir müşteriye aittir (customerId zorunlu).
//   - Çuvala top/kartela atarken: müşteri uyumu kontrol edilir.
//   - Müşteri-malı (SERVICE_PRODUCTION) toplar sadece sahibinin çuvalına gider.
//   - Sevkiyatlanmış çuvallar (shipmentId dolu, shipment SHIPPED) düzenlenmez.
//     Shipment PREPARING ise düzenleme açıktır.
//   - Top'a sipariş bağlanırsa OrderAllocation oluşur; eski allocation'lar
//     transfer edilir → recomputeOrderStatus etkilenen tüm siparişlere çağrılır.
//   - Çuvalın müşterisi sadece içi boşken değiştirilebilir.
//   - Boş çuval otomatik silinmez — operatör manuel siler (uyarı UI'da).
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { Prisma, RollStatus, ShipmentStatus } from "@prisma/client";
import { recomputeOrderStatus } from "./helpers/order-status.helper";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeCrockford(n: number, length: number): string {
  let s = "";
  let v = n;
  for (let i = 0; i < length; i++) {
    s = CROCKFORD[v % 32] + s;
    v = Math.floor(v / 32);
  }
  return s;
}

async function nextSackSequence(
  tx: Prisma.TransactionClient,
  date: Date
): Promise<number> {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `ÇVL-${yy}${mm}-`;

  const last = await tx.sack.findFirst({
    where: { sackNumber: { startsWith: prefix } },
    orderBy: { sackNumber: "desc" },
    select: { sackNumber: true },
  });

  if (!last) return 1;
  const parts = last.sackNumber.split("-");
  const n = parseInt(parts[2] ?? "", 10);
  return (Number.isFinite(n) ? n : 0) + 1;
}

function buildSackNumber(date: Date, seq: number): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `ÇVL-${yy}${mm}-${String(seq).padStart(6, "0")}`;
}

/**
 * Bir çuvalın düzenlenebilir olup olmadığını kontrol eder.
 * Sevkiyatı SHIPPED'a geçtiyse kilitli.
 */
async function assertSackEditable(
  tx: Prisma.TransactionClient,
  sackId: string
): Promise<void> {
  const sack = await tx.sack.findUnique({
    where: { id: sackId },
    select: {
      shipmentId: true,
      shipment: { select: { status: true } },
    },
  });
  if (!sack) throw AppError.notFound("Çuval bulunamadı");
  if (sack.shipmentId && sack.shipment?.status === ShipmentStatus.SHIPPED) {
    throw AppError.conflict(
      "Bu çuval sevk edilmiş — düzenlenemez"
    );
  }
}

/**
 * Top'un mevcut allocation'larını siler (allocatedQty rolün currentQty'sini
 * aşmasın diye genelde tek allocation tutuluyor). Etkilenen sipariş ID'lerini döner.
 */
async function clearRollAllocations(
  tx: Prisma.TransactionClient,
  rollId: string
): Promise<string[]> {
  const allocations = await tx.orderAllocation.findMany({
    where: { rollId },
    select: { id: true, orderLine: { select: { orderId: true } } },
  });
  const orderIds = allocations.map((a) => a.orderLine.orderId);
  if (allocations.length > 0) {
    await tx.orderAllocation.deleteMany({ where: { rollId } });
  }
  return orderIds;
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class SackService {
  // ===========================================================================
  // Çuval CRUD
  // ===========================================================================

  /**
   * Yeni bir çuval açar. Müşteri zorunlu; aynı müşteri için birden fazla açık
   * çuval olabilir (operatör doluluğa göre yenisini açar).
   */
  async createSack(
    data: { customerId: string; notes?: string },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, code: true, name: true },
    });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");

    const sack = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const seq = await nextSackSequence(tx, now);
      const sackNumber = buildSackNumber(now, seq);

      return tx.sack.create({
        data: {
          sackNumber,
          customerId: data.customerId,
          notes: data.notes ?? null,
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: {
        sackNumber: sack.sackNumber,
        customerId: data.customerId,
        customerName: customer.name,
      },
    });

    return {
      success: true,
      data: sack,
      message: `Çuval açıldı: ${sack.sackNumber} (${customer.name})`,
    };
  }

  /**
   * Boş çuval silme — operatör manuel siler.
   * Çuval boş değilse (top veya kartela varsa) hata fırlatır.
   */
  async deleteSack(
    sackId: string,
    userId?: string
  ): Promise<ApiResponse<{ deleted: true }>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNumber: true,
        shipmentId: true,
        _count: { select: { rolls: true, swatches: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId) {
      throw AppError.conflict(
        "Bu çuval sevkiyata atanmış — silinemez"
      );
    }
    if (sack._count.rolls + sack._count.swatches > 0) {
      throw AppError.conflict(
        "Çuval boş değil — önce içindeki top/kartelaları çıkarın"
      );
    }

    await prisma.sack.delete({ where: { id: sackId } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { sackNumber: sack.sackNumber },
    });

    return {
      success: true,
      data: { deleted: true },
      message: `Çuval silindi: ${sack.sackNumber}`,
    };
  }

  /**
   * Çuvalın müşterisini değiştirme — sadece içi boş çuvallar için.
   */
  async updateSackCustomer(
    data: { sackId: string; customerId: string },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: {
        id: true,
        sackNumber: true,
        customerId: true,
        shipmentId: true,
        _count: { select: { rolls: true, swatches: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId) {
      throw AppError.conflict(
        "Bu çuval sevkiyata atanmış — müşteri değiştirilemez"
      );
    }
    if (sack._count.rolls + sack._count.swatches > 0) {
      throw AppError.conflict(
        "Çuval boş değil — müşteri sadece boşken değiştirilebilir. Önce içindekileri çıkarın."
      );
    }
    if (sack.customerId === data.customerId) {
      return { success: true, data: { sackId: sack.id }, message: "Değişiklik yok" };
    }

    const newCustomer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, name: true },
    });
    if (!newCustomer) throw AppError.notFound("Yeni müşteri bulunamadı");

    const updated = await prisma.sack.update({
      where: { id: data.sackId },
      data: { customerId: data.customerId },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: data.sackId,
      oldData: { customerId: sack.customerId },
      newData: { customerId: data.customerId, customerName: newCustomer.name },
    });

    return {
      success: true,
      data: updated,
      message: `Çuval ${sack.sackNumber} → ${newCustomer.name}`,
    };
  }

  /**
   * Çuvala brüt ağırlık girilmesi (opsiyonel — ihracat araç kg kapasitesi için).
   */
  async weighSack(
    data: { sackId: string; weightKg: number },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    if (data.weightKg < 0) {
      throw AppError.badRequest("Ağırlık negatif olamaz");
    }
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, sackNumber: true, weightKg: true, shipmentId: true, shipment: { select: { status: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId && sack.shipment?.status === ShipmentStatus.SHIPPED) {
      throw AppError.conflict("Bu çuval sevk edilmiş — ağırlık değiştirilemez");
    }

    const updated = await prisma.sack.update({
      where: { id: data.sackId },
      data: { weightKg: data.weightKg },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: data.sackId,
      oldData: { weightKg: sack.weightKg },
      newData: { weightKg: data.weightKg },
    });

    return {
      success: true,
      data: updated,
      message: `Çuval ${sack.sackNumber} brüt: ${data.weightKg.toFixed(2)} kg`,
    };
  }

  // ===========================================================================
  // Top atama / çıkarma
  // ===========================================================================

  /**
   * Bir topu çuvala atar. orderLineId verilirse o siparişe allocation oluşturur
   * (eski allocation'lar otomatik temizlenir — top tek bir siparişe bağlı kalır).
   *
   * Müşteri uyumu kontrolleri:
   *  - Çuvalın müşterisi = orderLine'ın siparişinin müşterisi (varsa)
   *  - Müşteri-malı top (ownerCustomerId dolu) → sadece sahibinin çuvalına
   */
  async assignRollToSack(
    data: {
      rollId: string;
      sackId: string;
      orderLineId?: string | null;
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        sackId: true,
        ownerCustomerId: true,
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // Statü kontrolü — depodaki veya hazır toplar çuvallanır
    const eligibleStatuses: RollStatus[] = [
      RollStatus.WAREHOUSE,
      RollStatus.READY_FOR_SHIP,
      RollStatus.A1_STOCK,
    ];
    if (!eligibleStatuses.includes(roll.status)) {
      throw AppError.badRequest(
        `Top çuvallama için uygun değil (${roll.status})`
      );
    }

    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: {
        id: true,
        sackNumber: true,
        customerId: true,
        shipmentId: true,
        shipment: { select: { status: true } },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId && sack.shipment?.status === ShipmentStatus.SHIPPED) {
      throw AppError.conflict(
        "Bu çuval sevk edilmiş — top eklenemez"
      );
    }

    // Duplicate / transfer kontrolü:
    //  - Aynı çuvala tekrar atılmaya çalışıyorsa 409 (operatör hatası, scanner
    //    çift okuma veya UI tıklama hatası — sessizce kabul ettirip audit'i
    //    şişirmemek için açık hata).
    //  - Farklı çuvala atılmaya çalışıyorsa: sessiz transfer. Eski sack'tan
    //    çıkar (Roll.sackId = yeni), audit'te eski sack referansı tutulur.
    //    Müşteri uyumu zaten aşağıda kontrol ediliyor; başka müşteri çuvalına
    //    transfer otomatik engellenir.
    let transferredFromSack: { id: string; sackNumber: string } | null = null;
    if (roll.sackId === data.sackId) {
      throw AppError.conflict(
        `Top ${roll.barcode} zaten ${sack.sackNumber} çuvalında`
      );
    }
    if (roll.sackId && roll.sackId !== data.sackId) {
      const oldSack = await prisma.sack.findUnique({
        where: { id: roll.sackId },
        select: {
          id: true,
          sackNumber: true,
          shipmentId: true,
          shipment: { select: { status: true } },
        },
      });
      if (oldSack?.shipmentId && oldSack.shipment?.status === ShipmentStatus.SHIPPED) {
        throw AppError.conflict(
          `Top zaten sevk edilmiş çuvala (${oldSack.sackNumber}) bağlı — transfer edilemez`
        );
      }
      transferredFromSack = oldSack
        ? { id: oldSack.id, sackNumber: oldSack.sackNumber }
        : null;
    }

    // Müşteri-malı top kontrolü (sıkı)
    if (roll.ownerCustomerId && roll.ownerCustomerId !== sack.customerId) {
      throw AppError.badRequest(
        `Top ${roll.barcode} müşteri malı — sadece sahibinin çuvalına atılabilir`
      );
    }

    // Sipariş atama varsa: müşteri uyumu zorunlu
    let validatedOrderLineId: string | null = null;
    let validatedAllocatedQty = 0;
    if (data.orderLineId) {
      const orderLine = await prisma.orderLine.findUnique({
        where: { id: data.orderLineId },
        select: {
          id: true,
          quantity: true,
          itemId: true,
          colorId: true,
          order: { select: { id: true, customerId: true } },
        },
      });
      if (!orderLine) throw AppError.notFound("Sipariş satırı bulunamadı");
      if (orderLine.order.customerId !== sack.customerId) {
        throw AppError.badRequest(
          "Sipariş başka müşteriye ait — bu çuvala atanamaz"
        );
      }
      validatedOrderLineId = orderLine.id;
      validatedAllocatedQty = roll.currentQty;
    }

    const affectedOrderIds = await prisma.$transaction(async (tx) => {
      // 1) Eski allocation'ları temizle (hangi siparişler etkilendi topla)
      const orderIds = await clearRollAllocations(tx, data.rollId);

      // 2) Yeni allocation oluştur (orderLineId verildiyse)
      if (validatedOrderLineId) {
        await tx.orderAllocation.create({
          data: {
            rollId: data.rollId,
            orderLineId: validatedOrderLineId,
            allocatedQty: validatedAllocatedQty,
          },
        });
        // Etkilenen sipariş listesine yeni siparişi ekle
        const newOrderId = (
          await tx.orderLine.findUnique({
            where: { id: validatedOrderLineId },
            select: { orderId: true },
          })
        )?.orderId;
        if (newOrderId) orderIds.push(newOrderId);
      }

      // 3) Top'un sackId'sini güncelle + status READY_FOR_SHIP.
      // Roll-level tartı YOK — kilo çuval brütü olarak Sack.weightKg'de tutulur
      // (POST /api/sacks/weigh ile operatör çuvalı doldurduktan sonra girer).
      await tx.roll.update({
        where: { id: data.rollId },
        data: {
          sackId: data.sackId,
          status: RollStatus.READY_FOR_SHIP,
          packagingDate:
            roll.status === RollStatus.WAREHOUSE ? new Date() : undefined,
        },
      });

      // 4) Tüm etkilenen siparişlerin durumlarını yeniden hesapla
      const unique = [...new Set(orderIds)];
      for (const id of unique) {
        await recomputeOrderStatus(tx, id);
      }

      return unique;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_SACK_ASSIGN",
      recordId: data.rollId,
      newData: {
        rollBarcode: roll.barcode,
        sackId: data.sackId,
        sackNumber: sack.sackNumber,
        orderLineId: validatedOrderLineId,
        affectedOrderIds,
        // Transfer ise eski sack referansı (audit zinciri için)
        transferredFromSackId: transferredFromSack?.id ?? null,
        transferredFromSackNumber: transferredFromSack?.sackNumber ?? null,
      },
    });

    return {
      success: true,
      data: {
        rollId: data.rollId,
        sackId: data.sackId,
        sackNumber: sack.sackNumber,
        affectedOrders: affectedOrderIds.length,
        transferredFromSackNumber: transferredFromSack?.sackNumber ?? null,
      },
      message: transferredFromSack
        ? `Top ${roll.barcode}: ${transferredFromSack.sackNumber} → ${sack.sackNumber} (transfer)`
        : `Top ${roll.barcode} → çuval ${sack.sackNumber}`,
    };
  }

  /**
   * Top'u çuvaldan çıkarır. Eski sipariş allocation'ları korunur (operatör
   * tekrar başka çuvala koyacak veya havuza geri).
   * Top status: READY_FOR_SHIP → WAREHOUSE'a geri.
   */
  async removeRollFromSack(
    rollId: string,
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        barcode: true,
        sackId: true,
        sack: {
          select: {
            sackNumber: true,
            shipmentId: true,
            shipment: { select: { status: true } },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId || !roll.sack) {
      throw AppError.badRequest(`Top ${roll.barcode} herhangi bir çuvalda değil`);
    }
    if (roll.sack.shipmentId && roll.sack.shipment?.status === ShipmentStatus.SHIPPED) {
      throw AppError.conflict("Çuval sevk edilmiş — top çıkarılamaz");
    }

    const sackNumber = roll.sack.sackNumber;
    await prisma.$transaction(async (tx) => {
      await tx.roll.update({
        where: { id: rollId },
        data: { sackId: null, status: RollStatus.WAREHOUSE },
      });
      // Allocation korunur — operatör başka çuvala atmadan önce sipariş bağı kalsın.
      // Sonraki assign'da clearRollAllocations zaten temizliyor.
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_SACK_ASSIGN",
      recordId: rollId,
      newData: { rollBarcode: roll.barcode, removedFromSack: sackNumber },
    });

    return {
      success: true,
      data: { rollId, removedFromSack: sackNumber },
      message: `Top ${roll.barcode} çuval ${sackNumber}'dan çıkarıldı`,
    };
  }

  // ===========================================================================
  // Kartela atama / çıkarma
  // ===========================================================================

  async assignSwatchToSack(
    data: { swatchId: string; sackId: string; weightKg?: number | null },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const swatch = await prisma.swatch.findUnique({
      where: { id: data.swatchId },
      select: { id: true, barcode: true, sackId: true },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");

    await assertSackEditable(prisma, data.sackId);
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { sackNumber: true },
    });

    await prisma.swatch.update({
      where: { id: data.swatchId },
      data: {
        sackId: data.sackId,
        ...(data.weightKg != null && data.weightKg >= 0
          ? { weightKg: data.weightKg }
          : {}),
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH_SACK_ASSIGN",
      recordId: data.swatchId,
      newData: {
        swatchBarcode: swatch.barcode,
        sackId: data.sackId,
        sackNumber: sack?.sackNumber,
      },
    });

    return {
      success: true,
      data: { swatchId: data.swatchId, sackId: data.sackId },
      message: `Kartela ${swatch.barcode} → çuval ${sack?.sackNumber}`,
    };
  }

  async removeSwatchFromSack(
    swatchId: string,
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const swatch = await prisma.swatch.findUnique({
      where: { id: swatchId },
      select: {
        id: true,
        barcode: true,
        sackId: true,
        sack: {
          select: {
            sackNumber: true,
            shipmentId: true,
            shipment: { select: { status: true } },
          },
        },
      },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (!swatch.sackId || !swatch.sack) {
      throw AppError.badRequest(`Kartela herhangi bir çuvalda değil`);
    }
    if (
      swatch.sack.shipmentId &&
      swatch.sack.shipment?.status === ShipmentStatus.SHIPPED
    ) {
      throw AppError.conflict("Çuval sevk edilmiş — kartela çıkarılamaz");
    }

    await prisma.swatch.update({
      where: { id: swatchId },
      data: { sackId: null },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SWATCH_SACK_ASSIGN",
      recordId: swatchId,
      newData: {
        swatchBarcode: swatch.barcode,
        removedFromSack: swatch.sack.sackNumber,
      },
    });

    return {
      success: true,
      data: { swatchId },
      message: `Kartela çuvaldan çıkarıldı`,
    };
  }

  // ===========================================================================
  // LIST & QUERIES
  // ===========================================================================

  /**
   * Bir müşterinin açık çuvalları (henüz sevk edilmemiş).
   * Mobil tartı/paket ekranında "müşterinin çuvalları" tab'ı için.
   */
  /**
   * Sevkiyata bağlanmamış tüm açık çuvallar — müşteri-grupsuz tek liste.
   * Electron'da "Açık Çuvallar" görünümü için. shipmentId NULL veya bağlı
   * shipment henüz SHIPPED değil.
   */
  async listAllOpenSacks(): Promise<ApiResponse<unknown[]>> {
    const sacks = await prisma.sack.findMany({
      where: {
        OR: [
          { shipmentId: null },
          { shipment: { status: { not: ShipmentStatus.SHIPPED } } },
        ],
      },
      select: {
        id: true,
        sackNumber: true,
        weightKg: true,
        notes: true,
        shipmentId: true,
        createdAt: true,
        customer: { select: { id: true, code: true, name: true } },
        shipment: {
          select: { id: true, shipmentNumber: true, status: true },
        },
        _count: { select: { rolls: true, swatches: true } },
        rolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            weightKg: true,
            width: true,
            qualityGrade: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            allocations: {
              select: {
                allocatedQty: true,
                orderLine: {
                  select: {
                    id: true,
                    order: { select: { id: true, orderNumber: true } },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ shipmentId: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    });

    const data = sacks.map((s) => ({
      id: s.id,
      sackNumber: s.sackNumber,
      weightKg: s.weightKg,
      notes: s.notes,
      customer: s.customer,
      shipment: s.shipment,
      rollCount: s._count.rolls,
      swatchCount: s._count.swatches,
      totalQty: s.rolls.reduce((sum, r) => sum + r.currentQty, 0),
      totalRollWeight: s.rolls.reduce(
        (sum, r) => sum + (r.weightKg ?? 0),
        0,
      ),
      rolls: s.rolls.map((r) => ({
        id: r.id,
        barcode: r.barcode,
        currentQty: r.currentQty,
        weightKg: r.weightKg,
        width: r.width,
        qualityGrade: r.qualityGrade,
        itemCode: r.item.code,
        itemName: r.item.name,
        colorName: r.color?.name ?? null,
        orderNumber: r.allocations[0]?.orderLine.order.orderNumber ?? null,
        allocatedQty: r.allocations[0]?.allocatedQty ?? null,
      })),
      createdAt: s.createdAt,
    }));

    return { success: true, data };
  }

  async listOpenSacksByCustomer(
    customerId: string
  ): Promise<ApiResponse<unknown[]>> {
    const sacks = await prisma.sack.findMany({
      where: {
        customerId,
        OR: [
          { shipmentId: null },
          { shipment: { status: { not: ShipmentStatus.SHIPPED } } },
        ],
      },
      select: {
        id: true,
        sackNumber: true,
        weightKg: true,
        notes: true,
        shipmentId: true,
        createdAt: true,
        _count: { select: { rolls: true, swatches: true } },
        // Toplam içerik metrajı için topların currentQty'leri
        rolls: { select: { currentQty: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = sacks.map((s) => ({
      id: s.id,
      sackNumber: s.sackNumber,
      weightKg: s.weightKg,
      notes: s.notes,
      shipmentId: s.shipmentId,
      rollCount: s._count.rolls,
      swatchCount: s._count.swatches,
      totalQty: s.rolls.reduce((sum, r) => sum + r.currentQty, 0),
      createdAt: s.createdAt,
    }));

    return { success: true, data };
  }

  /**
   * Çuvalın detaylı içeriği — toplar + kartelalar + her birinin sipariş bağı.
   */
  async getSack(sackId: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        shipment: {
          select: { id: true, shipmentNumber: true, status: true, shippedAt: true },
        },
        rolls: {
          include: {
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            allocations: {
              include: {
                orderLine: {
                  include: { order: { select: { orderNumber: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        swatches: {
          include: {
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");

    return { success: true, data: sack };
  }

  /**
   * Tartı/paket havuzu — bir müşteri için (veya tüm) çuvallanmamış toplar+kartelalar.
   * Operatör scan veya listeden seçer.
   */
  async getPool(params?: {
    customerId?: string;
  }): Promise<ApiResponse<{ rolls: unknown[]; swatches: unknown[] }>> {
    const rollWhere: Prisma.RollWhereInput = {
      sackId: null,
      status: { in: [RollStatus.WAREHOUSE, RollStatus.A1_STOCK] },
    };
    if (params?.customerId) {
      rollWhere.OR = [
        { ownerCustomerId: params.customerId },
        { ownerCustomerId: null },
      ];
    } else {
      rollWhere.ownerCustomerId = null; // genel havuzda müşteri-malı toplar gizli
    }

    const [rolls, swatches] = await Promise.all([
      prisma.roll.findMany({
        where: rollWhere,
        select: {
          id: true,
          barcode: true,
          currentQty: true,
          weightKg: true,
          width: true,
          qualityGrade: true,
          status: true,
          ownerCustomerId: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, code: true, name: true } },
          allocations: {
            select: {
              orderLine: {
                select: {
                  id: true,
                  order: {
                    select: { id: true, orderNumber: true, customerId: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.swatch.findMany({
        where: { sackId: null },
        select: {
          id: true,
          barcode: true,
          length: true,
          width: true,
          weightKg: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, code: true, name: true } },
          parentRoll: { select: { id: true, barcode: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return { success: true, data: { rolls, swatches } };
  }
}
