// =============================================================================
// TeksERP - Order Service (extends BaseService)
// =============================================================================
// Overrides:
//   - create: auto-generates orderNumber as YYYYMMDD-N
//   - softDelete: sets status = CANCELLED (Order has no isActive field)
//                 + iş emri bağlarını güvenli şekilde çözer (R1)
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { BaseService, BaseServiceConfig } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { OrderStatus } from "@prisma/client";
import { isValidCurrency, CURRENCY_CODES } from "../config/currencies";
import { readOrderDefaultDeadlineDays } from "./system-setting.service";
import { recomputeOrderStatus } from "./helpers/order-status.helper";

/**
 * Lines üzerinden totalAmount hesaplar. unitPrice null olan satırlar toplama
 * dahil edilmez (kasıtlı: "fiyatlandırılmamış" kalemleri 0 saymak yanıltıcı).
 * Hiç satırın fiyatı yoksa null döner — sipariş "fiyatsız" sayılır.
 */
function computeTotalAmount(
  lines: Array<{ quantity?: number; unitPrice?: number | null | string }>
): number | null {
  let total = 0;
  let any = false;
  for (const l of lines) {
    if (l.unitPrice == null) continue;
    const qty = Number(l.quantity ?? 0);
    const price = typeof l.unitPrice === "string" ? Number(l.unitPrice) : l.unitPrice;
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    total += qty * (price as number);
    any = true;
  }
  return any ? Number(total.toFixed(2)) : null;
}

export class OrderService extends BaseService {
  constructor(config: BaseServiceConfig) {
    super(config);
  }

  /**
   * Sipariş kalemleri için finansal sınırlar:
   *   - quantity > 0 (pozitif metraj/adet)
   *   - unitPrice >= 0 ya da null (null = "fiyatlandırılmamış", iş kuralı)
   * Negatif/sıfır metraj veya negatif fiyat finansal kayıt + üretim akışını
   * bozacağı için service seviyesinde reddedilir (Zod yerine inline AppError,
   * mevcut validateBranch / isValidCurrency deseniyle uyumlu).
   */
  private validateLines(lines: unknown): void {
    if (!Array.isArray(lines)) return;
    lines.forEach((rawLine, idx) => {
      if (rawLine == null || typeof rawLine !== "object") return;
      const line = rawLine as Record<string, unknown>;
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw AppError.badRequest(
          `Sipariş kalemi #${idx + 1}: miktar pozitif olmalı (0'dan büyük).`
        );
      }
      if (line.unitPrice != null) {
        const price =
          typeof line.unitPrice === "string"
            ? Number(line.unitPrice)
            : (line.unitPrice as number);
        if (!Number.isFinite(price) || price < 0) {
          throw AppError.badRequest(
            `Sipariş kalemi #${idx + 1}: birim fiyat negatif olamaz.`
          );
        }
      }
    });
  }

  /**
   * Hedef şubenin müşteriye ait + aktif olduğunu doğrular.
   * Aynı validasyon deseni shipping.service.ts:createShipment'te kullanılır.
   */
  private async validateBranch(
    branchId: string,
    customerId: string
  ): Promise<void> {
    const branch = await prisma.customerBranch.findUnique({
      where: { id: branchId },
      select: { id: true, customerId: true, isActive: true },
    });
    if (!branch) throw AppError.notFound("Şube bulunamadı");
    if (branch.customerId !== customerId) {
      throw AppError.badRequest("Şube bu müşteriye ait değil");
    }
    if (!branch.isActive) throw AppError.badRequest("Şube pasif durumda");
  }

  /**
   * Müşterinin varlığını + aktifliğini doğrular. Pasif (soft-deleted) müşteriye
   * yeni sipariş açılamaz — satış temsilcisi yanlış kayıt seçimini fark etmesin
   * diye iş kuralı seviyesinde reddedilir.
   */
  private async validateCustomer(customerId: string): Promise<void> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, isActive: true },
    });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    if (!customer.isActive) {
      throw AppError.badRequest(
        "Müşteri pasif durumda. Aktif olmayan müşteriye sipariş açılamaz."
      );
    }
  }

  async create(
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    this.validateLines(data.lines);

    if (data.customerId) {
      await this.validateCustomer(data.customerId as string);
    }

    if (data.branchId && data.customerId) {
      await this.validateBranch(
        data.branchId as string,
        data.customerId as string
      );
    }

    // Currency whitelist (varsa). Boş bırakılırsa şema default "TRY" kullanır.
    if (data.currency != null && !isValidCurrency(data.currency as string)) {
      throw AppError.badRequest(
        `Geçersiz para birimi: ${data.currency}. İzinli: ${CURRENCY_CODES.join(", ")}`
      );
    }

    // totalAmount: gönderilmediyse lines'tan otomatik hesapla. Gönderilmiş ise
    // (planlamacı override etmiş — KDV/indirim gibi) olduğu gibi bırak.
    if (
      data.totalAmount == null &&
      Array.isArray(data.lines) &&
      data.lines.length > 0
    ) {
      const computed = computeTotalAmount(
        data.lines as Array<{ quantity?: number; unitPrice?: number | null | string }>
      );
      if (computed !== null) data.totalAmount = computed;
    }

    // Termin (deadline) default: sipariş tarihinden N gün sonra. N tanımlardan
    // (`order.defaultDeadlineDays`) okunur; yoksa 7. orderDate verilmediyse
    // şema default'u (now()) baz alınır.
    if (data.deadline == null) {
      const baseDate = data.orderDate
        ? new Date(data.orderDate as string)
        : new Date();
      const days = await readOrderDefaultDeadlineDays();
      const deadline = new Date(baseDate);
      deadline.setDate(deadline.getDate() + days);
      data.deadline = deadline;
    } else {
      // İş kuralı: deadline >= orderDate olmalı (geçmişe teslim anlamsız).
      // orderDate verilmediyse şema default'u (now()); bu durumda da deadline
      // bugünden önce olmamalı.
      const deadlineDate = new Date(data.deadline as string);
      if (Number.isNaN(deadlineDate.getTime())) {
        throw AppError.badRequest("Termin tarihi geçersiz");
      }
      const orderDateRef = data.orderDate
        ? new Date(data.orderDate as string)
        : new Date();
      if (deadlineDate.getTime() < orderDateRef.getTime()) {
        throw AppError.badRequest(
          "Termin tarihi sipariş tarihinden önce olamaz"
        );
      }
    }

    const today = new Date();
    const prefix =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    // orderNumber server-tarafında otomatik üretilir; istemci gönderse de
    // göz ardı edilir (doc-code uyumu için açıkça siliyoruz).
    if ("orderNumber" in data) {
      delete data.orderNumber;
    }

    // Numeric tail sort: "20260523-9" > "20260523-10" hatası (lex sort) için
    // bugünün tüm orderNumber'larını çekip JS'te numeric max alıyoruz. Tek-gün
    // sipariş sayısı sınırlı (yüzler), maliyet ihmal edilebilir.
    //
    // Race condition: iki eşzamanlı POST aynı seq'i hesaplayabilir → P2002.
    // Bunu Postgres SERIAL kolonu ile veya retry-on-conflict ile çözmek
    // ayrı bir iyileştirme. Tipik kullanımda eşzamanlı insert nadir.
    const todaysOrders = await prisma.order.findMany({
      where: { orderNumber: { startsWith: prefix } },
      select: { orderNumber: true },
    });
    const maxSeq = todaysOrders.reduce((max, o) => {
      const tail = o.orderNumber.split("-")[1] ?? "";
      const n = parseInt(tail, 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const orderNumber = `${prefix}-${maxSeq + 1}`;

    const prismaData: Record<string, unknown> = {
      ...data,
      orderNumber,
      // Sipariş oluşturulur oluşturulmaz üretime/sevke açık olsun;
      // ayrı bir "onay" adımı kullanılmıyor.
      status: OrderStatus.APPROVED,
    };

    // Lines: requiredPropertyIds varsa { create: [...] } formatına çevir.
    if (Array.isArray(prismaData.lines)) {
      prismaData.lines = (prismaData.lines as Record<string, unknown>[]).map((rawLine) => {
        const line = { ...rawLine };
        const ids = Array.isArray(line.requiredPropertyIds)
          ? [...new Set((line.requiredPropertyIds as string[]).filter(Boolean))]
          : [];
        delete line.requiredPropertyIds;
        if (ids.length > 0) {
          line.requiredProperties = {
            create: ids.map((propertyId) => ({ propertyId })),
          };
        }
        return line;
      });
    }

    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        if (Array.isArray(prismaData[field])) {
          prismaData[field] = { create: prismaData[field] };
        }
      }
    }

    const record = (await this.delegate.create({
      data: prismaData,
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    })) as Record<string, unknown>;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: record.id as string,
      newData: { ...data, orderNumber },
    });

    return { success: true, data: record, message: "Sipariş oluşturuldu" };
  }

  /**
   * Update override — status-gated header editi.
   *
   * Kurallar:
   * - COMPLETED / CANCELLED → değiştirilemez (409).
   * - PARTIAL_SHIPPED → sadece `deadline` güncellenir; diğer alanlar yoksayılır.
   * - APPROVED → header alanları (customerId, branchId, currency, totalAmount,
   *   deadline) açık; ancak aktif (PLANNED dışı) iş emri bağlıysa customerId/
   *   branchId değiştirilemez (409). Currency whitelist kontrolü de yapılır.
   * - Lines (kalemler) HİÇBİR durumda güncellenmez — yanlışlıkla gelmiş olsa
   *   bile data'dan silinir. Kalem değişikliği için sipariş iptal + yeniden
   *   oluşturma akışı kullanılır.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const current = await prisma.order.findUnique({
      where: { id },
      select: {
        customerId: true,
        branchId: true,
        status: true,
        lines: {
          select: {
            workOrderLinks: {
              select: { workOrder: { select: { status: true } } },
            },
          },
        },
      },
    });
    if (!current) throw AppError.notFound("Sipariş bulunamadı");

    if (
      current.status === OrderStatus.COMPLETED ||
      current.status === OrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş sipariş düzenlenemez"
      );
    }

    // Kalem güncellemesi hiçbir koşulda kabul edilmez.
    const cleanData: Record<string, unknown> = { ...data };
    delete cleanData.lines;

    // Currency whitelist (varsa). PARTIAL_SHIPPED'de zaten allowlist filtrele.
    if (cleanData.currency != null && !isValidCurrency(cleanData.currency as string)) {
      throw AppError.badRequest(
        `Geçersiz para birimi: ${cleanData.currency}. İzinli: ${CURRENCY_CODES.join(", ")}`
      );
    }

    if (current.status === OrderStatus.PARTIAL_SHIPPED) {
      const allowed = new Set(["deadline"]);
      for (const key of Object.keys(cleanData)) {
        if (!allowed.has(key)) delete cleanData[key];
      }
      if (Object.keys(cleanData).length === 0) {
        return { success: true, data: current, message: "Değişiklik yok" };
      }
      return super.update(id, cleanData, userId);
    }

    const branchChanging = Object.prototype.hasOwnProperty.call(cleanData, "branchId");
    const customerChanging = Object.prototype.hasOwnProperty.call(cleanData, "customerId");

    if (branchChanging || customerChanging) {
      // Aktif (PLANNED dışı) WO bağlıysa müşteri/şube değiştirilemez.
      const blockingStatuses = new Set(["IN_PROGRESS", "PAUSED", "COMPLETED"]);
      const hasBlockingWO = current.lines.some((line) =>
        line.workOrderLinks.some((link) =>
          blockingStatuses.has(link.workOrder.status)
        )
      );
      if (hasBlockingWO) {
        throw AppError.conflict(
          "Aktif iş emrine bağlı sipariş; müşteri veya şube değiştirilemez"
        );
      }

      const finalBranchId = branchChanging
        ? (cleanData.branchId as string | null)
        : current.branchId;
      const finalCustomerId = customerChanging
        ? (cleanData.customerId as string)
        : current.customerId;

      if (finalBranchId) {
        await this.validateBranch(finalBranchId, finalCustomerId);
      }
    }

    return super.update(id, cleanData, userId);
  }

  /**
   * Soft-delete (cancel) an order.
   *
   * Business Rules (R1 — sipariş iptal çift yönlü tutarlılık):
   *   - Sipariş hiçbir WO'ya bağlı değilse sorunsuz iptal.
   *   - PLANNED durumdaki WO bağları varsa → join satırlarını otomatik kopar
   *     (WO hayatta kalır, operatör isterse STOCK_PRODUCTION'a çevirir).
   *   - IN_PROGRESS / PAUSED / COMPLETED durumda WO varsa → 409 conflict.
   *     Operatör önce o WO'yu iptal etmeli.
   */
  async softDelete(
    id: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const oldRecord = await prisma.order.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            workOrderLinks: {
              include: { workOrder: true },
            },
          },
        },
      },
    });

    if (!oldRecord) {
      return { success: false, data: null, message: "Sipariş bulunamadı" };
    }

    const allLinks = oldRecord.lines.flatMap((line) => line.workOrderLinks);
    const blockingStatuses = new Set(["IN_PROGRESS", "PAUSED", "COMPLETED"]);
    const blockingWOs = allLinks
      .map((l) => l.workOrder)
      .filter((wo) => blockingStatuses.has(wo.status));

    if (blockingWOs.length > 0) {
      const batchNumbers = [...new Set(blockingWOs.map((w) => w.batchNumber))].join(", ");
      throw AppError.conflict(
        `Bu siparişe bağlı aktif/tamamlanmış iş emirleri var: ${batchNumbers}. Önce onları iptal edin.`
      );
    }

    const plannedLinkIds = allLinks
      .filter((l) => l.workOrder.status === "PLANNED")
      .map((l) => ({ workOrderId: l.workOrderId, orderLineId: l.orderLineId }));

    const updated = await prisma.$transaction(async (tx) => {
      if (plannedLinkIds.length > 0) {
        await tx.workOrderToOrderLine.deleteMany({
          where: {
            OR: plannedLinkIds.map((k) => ({
              workOrderId: k.workOrderId,
              orderLineId: k.orderLineId,
            })),
          },
        });
      }

      return tx.order.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as unknown as Record<string, unknown>,
      newData: {
        status: "CANCELLED",
        unlinkedWorkOrderCount: plannedLinkIds.length,
      },
    });

    return {
      success: true,
      data: updated,
      message:
        plannedLinkIds.length > 0
          ? `Sipariş iptal edildi. ${plannedLinkIds.length} planlı iş emri bağlantısı koparıldı.`
          : "Sipariş iptal edildi",
    };
  }

  /**
   * Planlamacı tarafından manuel tamamlama. Tölerans dışında eksik metraj
   * kabul edildiğinde, ürün üretilmeyecekse, müşteri kabul ettiğinde vb.
   *
   * - APPROVED veya PARTIAL_SHIPPED durumdaki siparişler için.
   * - PENDING (onaysız) ya da CANCELLED kapatılamaz.
   * - Zaten COMPLETED ise no-op değil hata — yanlışlıkla tetiklenmesin.
   */
  async manualComplete(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();
    if (!reason.trim()) throw AppError.badRequest("Tamamlama sebebi gerekli");

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, status: true, completedAt: true },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (order.status === OrderStatus.COMPLETED) {
      throw AppError.badRequest("Sipariş zaten tamamlanmış");
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw AppError.badRequest("İptal edilmiş sipariş kapatılamaz");
    }
    if (order.status === OrderStatus.PENDING) {
      throw AppError.badRequest("Onaysız sipariş manuel tamamlanamaz");
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: OrderStatus.COMPLETED,
        completedAt: order.completedAt ?? new Date(),
        manualClosedById: userId,
        manualCloseReason: reason.trim(),
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: { status: order.status },
      newData: {
        status: updated.status,
        manualClosedById: userId,
        manualCloseReason: updated.manualCloseReason,
      },
    });

    return {
      success: true,
      data: updated,
      message: `Sipariş manuel tamamlandı: ${order.orderNumber}`,
    };
  }

  /**
   * Manuel kapatılmış siparişi geri açar. Recompute sonucunda statü
   * otomatik PARTIAL_SHIPPED veya APPROVED'a döner. Sadece manuel
   * kapatılmış (manualClosedById dolu) siparişler için.
   */
  async reopen(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        manualClosedById: true,
      },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (!order.manualClosedById) {
      throw AppError.badRequest(
        "Bu sipariş manuel kapatılmamış — yeniden açma uygulanamaz"
      );
    }

    // Manuel iz silinir; sonra recomputeOrderStatus sevk sayaçlarına göre
    // status (APPROVED/PARTIAL_SHIPPED) ve shippedQty'yi senkronize eder.
    const updated = await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          manualClosedById: null,
          manualCloseReason: null,
          completedAt: null,
          status: OrderStatus.APPROVED,
        },
      });
      await recomputeOrderStatus(tx, id);
      return tx.order.findUniqueOrThrow({ where: { id } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: { status: order.status, manualClosedById: order.manualClosedById },
      newData: {
        status: updated.status,
        manualClosedById: null,
        reopenReason: reason.trim() || null,
      },
    });

    return {
      success: true,
      data: updated,
      message: `Sipariş yeniden açıldı: ${order.orderNumber}`,
    };
  }
}
