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
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { OrderStatus, Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";
import { readOrderDefaultDeadlineDays } from "./system-setting.service";
import { recomputeOrderStatus } from "./helpers/order-status.helper";
import { computeLineCoverage } from "./helpers/coverage.helper";
import {
  applyDateRange,
  buildOrderByClause,
  buildPagination,
  buildWhereClause,
  parseQueryParams,
} from "../utils/query-parser";
import { Request } from "express";

// ─── Cancel Akışı Karar Matrisi ─────────────────────────────────────────────
//
// Operatör sipariş iptal ederken, etkilenecek her WO için üç olası aksiyon:
//   - UNLINK_ONLY     : sadece order-WO join'ini sil, WO yaşamaya devam
//   - CONVERT_TO_STOCK: join sil + WO.type = STOCK_PRODUCTION (kalan üretim
//                       stoğa düşer; ORDER_PRODUCTION'dı, müşteri iptal etti)
//   - CANCEL_WO       : WorkOrderService.softDelete (rolls STOCK'a, traveler
//                       VOID, fason kayıtlar sil vb. tam kaskat)
//
// İzin matrisi WO.status + tek/çoklu sipariş durumuna göre değişir.
// "Tek-sipariş" = bu WO'ya bağlı tek sipariş bu — diğer order link yok.

export type CancelAction = "UNLINK_ONLY" | "CONVERT_TO_STOCK" | "CANCEL_WO";

function computeAllowedActions(
  woStatus: string,
  isSoleOrder: boolean
): CancelAction[] {
  if (woStatus === "PLANNED") {
    // Üretim başlamadı; CONVERT/CANCEL anlamsız.
    return ["UNLINK_ONLY"];
  }
  if (woStatus === "COMPLETED") {
    // Üretim bitti, rulolar var. CANCEL_WO yasak (workorder.service zaten
    // reddeder). Tek-sipariş ise CONVERT açık (müşteri kaydı silinir).
    return isSoleOrder ? ["UNLINK_ONLY", "CONVERT_TO_STOCK"] : ["UNLINK_ONLY"];
  }
  if (woStatus === "IN_PROGRESS" || woStatus === "PAUSED") {
    return isSoleOrder
      ? ["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"]
      : ["UNLINK_ONLY"];
  }
  // CANCELLED WO bağı zaten anlamsız — gelmemesi gerek ama defansif.
  return ["UNLINK_ONLY"];
}

function pickDefaultAction(
  woStatus: string,
  isSoleOrder: boolean
): CancelAction {
  if (woStatus === "PLANNED") return "UNLINK_ONLY";
  if (isSoleOrder) return "CONVERT_TO_STOCK"; // en sık vaka: malı stoğa al
  return "UNLINK_ONLY";
}

/**
 * Lines üzerinden totalAmount hesaplar. unitPrice null olan satırlar toplama
 * dahil edilmez (kasıtlı: "fiyatlandırılmamış" kalemleri 0 saymak yanıltıcı).
 * Hiç satırın fiyatı yoksa null döner — sipariş "fiyatsız" sayılır.
 */
function computeTotalAmount(
  lines: Array<{ quantity?: number; unitPrice?: number | null | string }>
): number | null {
  // Fiyatlandırma Decimal aritmetik ile — float drift faturada kuruş kayması yaratmasın.
  let total = new Prisma.Decimal(0);
  let any = false;
  for (const l of lines) {
    if (l.unitPrice == null) continue;
    const qtyRaw = Number(l.quantity ?? 0);
    const priceRaw =
      typeof l.unitPrice === "string" ? Number(l.unitPrice) : l.unitPrice;
    if (!Number.isFinite(qtyRaw) || !Number.isFinite(priceRaw)) continue;
    total = total.plus(new Prisma.Decimal(qtyRaw).times(priceRaw as number));
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

  /**
   * İş emri picker'ı için müsait sipariş listesi.
   *
   * Standart `findAll`'dan iki farkı var:
   *   1. Sipariş kalemlerini `workOrderLinks`'e göre filtreler. Aktif bir WO'ya
   *      (PLANNED / IN_PROGRESS / PAUSED / COMPLETED) bağlı kalemler hem
   *      `include`'dan çıkarılır hem de "hiç müsait kalemi yok" olan siparişler
   *      tamamen listeden düşer. CANCELLED WO'ya bağlı kalemler tekrar müsait
   *      sayılır (WO iptal olduysa kalem serbest).
   *   2. `excludeWorkOrderId` verilirse o WO'nun kendi bağları "bağ değilmiş
   *      gibi" sayılır. Edit modunda picker mevcut WO'nun seçimlerini gösterip
   *      kontrol edebilsin diye.
   *
   * Standart `filters` (status, customerId), `search`, `dateFrom/dateTo`,
   * `sortBy` ve sayfalama parametreleri `findAll` ile aynı şekilde çalışır.
   */
  async findAvailableForWorkOrder(
    req: Request,
    excludeWorkOrderId?: string
  ): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    // Search'i `buildWhereClause`'a vermiyoruz; picker'da arama relation'lara
    // (müşteri adı, kalem ürün adı) genişletiliyor — kendi OR'umuzu kuruyoruz.
    const baseWhere = buildWhereClause(
      params.filters,
      this.config.searchFields
    );
    applyDateRange(baseWhere, params, this.config.dateFields ?? []);

    const search = params.search?.trim();
    if (search) {
      baseWhere.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { lines: { some: { item: { name: { contains: search, mode: "insensitive" } } } } },
        { lines: { some: { customerItemName: { contains: search, mode: "insensitive" } } } },
      ];
    }

    // Gap-bazlı picker: bir satır "müsait" ise Açık > 0.
    //   Açık = quantity − Sevk(SHIPPED+targetOrderLineId) − Rezerve(canlı WO allocatedQty)
    // Kapalı/iptal sipariş hariç (gap hesabı yalnız açık siparişlerde anlamlı).
    const where = {
      ...baseWhere,
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
    };

    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);

    // Aday açık siparişleri display include + satır tahsisleriyle çek (picker tavanı 500).
    const orders = await prisma.order.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        customer: true,
        branch: { select: { id: true, name: true, city: true, district: true } },
        lines: {
          include: {
            item: { include: { allowedProperties: { include: { property: true } } } },
            color: true,
            requiredProperties: { include: { property: true } },
            workOrderLinks: {
              select: { allocatedQty: true, workOrder: { select: { id: true, status: true } } },
            },
          },
        },
      },
    });

    // Uzlaştırılmış kapsama — tüm aday satırlar için tek hesap (etiket+plan defterleri).
    const allLineIds = orders.flatMap((o) => o.lines.map((l) => l.id));
    const covMap = await computeLineCoverage(prisma, allLineIds, { excludeWorkOrderId });

    // Her sipariş için Açık>0 satırları süz + kovaları satıra ekle (UI'da göster).
    const enriched = orders
      .map((order) => {
        const lines = order.lines
          .map((line) => {
            const cov = covMap.get(line.id);
            const shipped = cov?.shipped ?? new Prisma.Decimal(0);
            const reserved = cov?.reserved ?? new Prisma.Decimal(0);
            const warehouseLabeled = cov?.warehouseLabeled ?? new Prisma.Decimal(0);
            const openQty = new Prisma.Decimal(line.quantity)
              .minus(cov?.coverage ?? new Prisma.Decimal(0));
            return { ...line, shippedQty: shipped, reservedQty: reserved, warehouseLabeledQty: warehouseLabeled, openQty };
          })
          .filter((line) => line.openQty.greaterThan(0));
        return { ...order, lines };
      })
      .filter((order) => order.lines.length > 0);

    const total = enriched.length;
    const { skip, take } = buildPagination(params.page, params.pageSize);
    const data = enriched.slice(skip, skip + take);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

  /**
   * Bir topun özelliğine (itemId + opsiyonel colorId/width) uyan, Açık > 0 olan
   * AÇIK sipariş kalemlerini döner. Tambur "Yeniden Kes" (depo topu → müşteri
   * etiketi) ve top-önce paketleme picker'ları için.
   * Açık = quantity − sevk(SHIPPED) − canlı WO rezerve(allocatedQty).
   */
  async findAvailableOrderLines(params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.OrderLineWhereInput = {
      itemId: params.itemId,
      order: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
    };
    if (params.colorId) where.colorId = params.colorId;
    if (params.width != null) where.width = params.width;

    const lines = await prisma.orderLine.findMany({
      where,
      take: 200,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        quantity: true,
        width: true,
        customerItemName: true,
        customerColorName: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            deadline: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
        workOrderLinks: {
          select: { allocatedQty: true, workOrder: { select: { status: true } } },
        },
      },
    });

    const lineIds = lines.map((l) => l.id);
    const covMap = await computeLineCoverage(prisma, lineIds);

    const data = lines
      .map((l) => {
        const cov = covMap.get(l.id);
        const openQty = new Prisma.Decimal(l.quantity).minus(cov?.coverage ?? new Prisma.Decimal(0));
        return {
          lineId: l.id,
          orderId: l.order.id,
          orderNumber: l.order.orderNumber,
          deadline: l.order.deadline,
          customerId: l.order.customer.id,
          customerName: l.order.customer.name,
          branchName: l.order.branch?.name ?? null,
          itemCode: l.item.code,
          itemName: l.item.name,
          customerItemName: l.customerItemName,
          colorCode: l.color?.code ?? null,
          colorName: l.color?.name ?? null,
          customerColorName: l.customerColorName,
          width: l.width,
          quantity: l.quantity,
          openQty,
        };
      })
      .filter((l) => l.openQty.greaterThan(0));

    return { success: true, data };
  }

  /**
   * Kapsama (coverage) — WO formundaki seçili sipariş kalemleri için üretim
   * açığını gösterir. Her kalem: istenen − sevk − WO-rezerve − serbest depo
   * stoğu − serbest ham stok = net üretim açığı (eksi = fazla).
   * Serbest stok = item+renk+en eşleşen, hiçbir kaleme etiketli OLMAYAN toplar.
   * Rezerve EDİLMEZ (anlık fotoğraf; çift sayım mümkün — planlamacı karar verir).
   * excludeWorkOrderId: düzenleme modunda WO'nun kendi tahsisini sayma.
   */
  async getCoverageForLines(params: {
    lineIds: string[];
    excludeWorkOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    const lineIds = [...new Set(params.lineIds)];
    if (lineIds.length === 0) return { success: true, data: [] };

    const lines = await prisma.orderLine.findMany({
      where: { id: { in: lineIds } },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        quantity: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        workOrderLinks: {
          select: { allocatedQty: true, workOrder: { select: { id: true, status: true } } },
        },
      },
    });

    // Uzlaştırılmış kapsama (etiket + plan): shipped, warehouseLabeled, reserved.
    const covMap = await computeLineCoverage(prisma, lineIds, {
      excludeWorkOrderId: params.excludeWorkOrderId,
    });

    // Serbest stok — spec bazında grupla (etiketsiz toplar); WAREHOUSE + STOCK ayrı
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const freeGrouped = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width", "status"],
      where: {
        targetOrderLineId: null,
        itemId: { in: itemIds },
        status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
      },
      _sum: { currentQty: true },
    });

    // Serbest stok eşleştirme: item kesin, renk/en line'da boşsa gevşek eşleşir
    const matchFree = (line: (typeof lines)[number], status: RollStatus): Prisma.Decimal =>
      freeGrouped.reduce((sum, g) => {
        if (g.status !== status) return sum;
        if (g.itemId !== line.itemId) return sum;
        if (line.colorId != null && g.colorId !== line.colorId) return sum;
        if (
          line.width != null &&
          (g.width == null || !new Prisma.Decimal(line.width).equals(g.width))
        ) {
          return sum;
        }
        return sum.plus(g._sum.currentQty ?? 0);
      }, new Prisma.Decimal(0));

    const data = lines.map((l) => {
      const cov = covMap.get(l.id);
      const shipped = cov?.shipped ?? new Prisma.Decimal(0);
      const reserved = cov?.reserved ?? new Prisma.Decimal(0);
      const warehouseLabeled = cov?.warehouseLabeled ?? new Prisma.Decimal(0);
      const freeWarehouse = matchFree(l, RollStatus.WAREHOUSE);
      const freeStock = matchFree(l, RollStatus.STOCK);
      const requested = new Prisma.Decimal(l.quantity);
      const netGap = requested
        .minus(shipped)
        .minus(warehouseLabeled)
        .minus(reserved)
        .minus(freeWarehouse)
        .minus(freeStock);
      return {
        lineId: l.id,
        item: l.item,
        color: l.color,
        width: l.width,
        requested,
        shipped,
        warehouseLabeled,
        reserved,
        freeWarehouse,
        freeStock,
        netGap,
      };
    });

    return { success: true, data };
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
   * Update override — status-gated header + lines editi.
   *
   * Kurallar:
   * - COMPLETED / CANCELLED → değiştirilemez (409).
   * - PARTIAL_SHIPPED → sadece `deadline` güncellenir; lines forbidden.
   * - APPROVED / PENDING → header alanları açık. Aktif WO (IN_PROGRESS/PAUSED/
   *   COMPLETED) bağlıysa customerId/branchId değiştirilemez.
   * - Lines: CANCELLED dışı herhangi bir WO bağı yoksa düzenlenebilir.
   *   Diff stratejisi: id eşleşene update, eşleşmeyene create, mevcut'ta var
   *   incoming'de yok ise delete. customerItemName/customerColorName + property
   *   referansları id korunduğu için bozulmaz.
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
            id: true,
            requiredProperties: { select: { propertyId: true } },
            workOrderLinks: {
              select: {
                workOrder: { select: { status: true } },
              },
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

    const incomingLines = Array.isArray(data.lines)
      ? (data.lines as Array<Record<string, unknown>>)
      : null;

    const cleanData: Record<string, unknown> = { ...data };
    delete cleanData.lines;

    // PARTIAL_SHIPPED: sadece deadline. Lines kabul edilmez, diğer header
    // alanları sessizce yutulur (eski davranış korunur).
    if (current.status === OrderStatus.PARTIAL_SHIPPED) {
      if (incomingLines) {
        throw AppError.conflict(
          "Kısmi sevk edilmiş siparişin kalemleri değiştirilemez"
        );
      }
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

    // Lines payload geldiyse: WO bağı kontrolü + diff uygula.
    if (incomingLines) {
      // CANCELLED WO bağları sayılmaz (iptal edilmiş, kalem serbest).
      const hasActiveWoLink = current.lines.some((line) =>
        line.workOrderLinks.some((link) => link.workOrder.status !== "CANCELLED")
      );
      if (hasActiveWoLink) {
        throw AppError.conflict(
          "İş emri açılmış siparişin kalemleri değiştirilemez. Önce iş emrini iptal edin."
        );
      }
      this.validateLines(incomingLines);

      // totalAmount auto-recompute (cleanData'da explicit yoksa)
      if (cleanData.totalAmount === undefined) {
        cleanData.totalAmount = computeTotalAmount(
          incomingLines as Array<{ quantity?: number; unitPrice?: number | null | string }>
        );
      }
    }

    // Tek transaction: lines diff + header update + final fetch.
    const updated = await prisma.$transaction(async (tx) => {
      if (incomingLines) {
        const existingById = new Map(current.lines.map((l) => [l.id, l]));
        const incomingIds = new Set(
          incomingLines
            .filter((l) => typeof l.id === "string" && (l.id as string).length > 0)
            .map((l) => l.id as string)
        );

        // Delete: existing - incoming. Cascade ile requiredProperties otomatik siler.
        const toDelete = [...existingById.keys()].filter((eid) => !incomingIds.has(eid));
        if (toDelete.length > 0) {
          await tx.orderLine.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const raw of incomingLines) {
          const propertyIds: string[] = Array.isArray(raw.requiredPropertyIds)
            ? [...new Set((raw.requiredPropertyIds as string[]).filter(Boolean))]
            : [];

          const lineData: Record<string, unknown> = { ...raw };
          delete lineData.id;
          delete lineData.requiredPropertyIds;
          // clientId frontend-internal — Prisma'da kolon yok, sızdırma.
          delete lineData.clientId;

          const existingLine =
            typeof raw.id === "string" ? existingById.get(raw.id as string) : undefined;

          if (existingLine) {
            const lineId = existingLine.id;
            await tx.orderLine.update({ where: { id: lineId }, data: lineData });

            const currentPropIds = new Set(
              existingLine.requiredProperties.map((p) => p.propertyId)
            );
            const incomingPropIds = new Set(propertyIds);
            const propsToDelete = [...currentPropIds].filter(
              (pid) => !incomingPropIds.has(pid)
            );
            const propsToAdd = [...incomingPropIds].filter(
              (pid) => !currentPropIds.has(pid)
            );

            if (propsToDelete.length > 0) {
              await tx.orderLineRequiredProperty.deleteMany({
                where: { orderLineId: lineId, propertyId: { in: propsToDelete } },
              });
            }
            if (propsToAdd.length > 0) {
              await tx.orderLineRequiredProperty.createMany({
                data: propsToAdd.map((propertyId) => ({ orderLineId: lineId, propertyId })),
                skipDuplicates: true,
              });
            }
          } else {
            await tx.orderLine.create({
              data: {
                ...(lineData as Prisma.OrderLineUncheckedCreateInput),
                orderId: id,
                ...(propertyIds.length > 0
                  ? {
                      requiredProperties: {
                        create: propertyIds.map((propertyId) => ({ propertyId })),
                      },
                    }
                  : {}),
              },
            });
          }
        }
      }

      if (Object.keys(cleanData).length > 0) {
        await tx.order.update({ where: { id }, data: cleanData });
      }

      return tx.order.findUnique({
        where: { id },
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude as Prisma.OrderInclude }
          : {}),
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      newData: {
        ...cleanData,
        ...(incomingLines ? { linesCount: incomingLines.length } : {}),
      },
    });

    return { success: true, data: updated, message: "Sipariş güncellendi" };
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

  // ─────────────────────────────────────────────────────────────────────────
  // İptal Akışı (Preview + Per-WO Action) — R1.2
  //
  // Operatör "Sipariş Sil" derken katı 409 yerine WO başına seçim sunulur:
  //   - PLANNED WO          → otomatik UNLINK_ONLY (üretim yok, sessiz kopar)
  //   - IN_PROGRESS/PAUSED ya da COMPLETED + tek-sipariş WO
  //                         → UNLINK_ONLY | CONVERT_TO_STOCK | CANCEL_WO
  //                           (CANCEL_WO sadece IN_PROGRESS/PAUSED için)
  //   - IN_PROGRESS/PAUSED ya da COMPLETED + çoklu-sipariş WO
  //                         → sadece UNLINK_ONLY (diğer siparişler ayakta)
  //
  // Frontend önce `getCancelPreview` ile etkilenecek WO listesini alır,
  // operatör seçimini yapar, `cancelWithActions` ile uygular.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * İptal "dry-run" — operatöre detaylı onay göstermek için.
   * Aksiyon belirlenmemiş ham bilgi döner; karar matrisi de döner ki frontend
   * tek noktadan default'u alabilsin.
   */
  async getCancelPreview(orderId: string): Promise<ApiResponse<unknown>> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        lines: {
          select: {
            id: true,
            workOrderLinks: {
              select: {
                allocatedQty: true,
                workOrder: {
                  select: {
                    id: true,
                    batchNumber: true,
                    status: true,
                    type: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) throw AppError.notFound("Sipariş bulunamadı");

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.COMPLETED
    ) {
      throw AppError.conflict(
        `Sipariş ${order.status === "CANCELLED" ? "zaten iptal" : "tamamlanmış"} — iptal edilemez`
      );
    }

    // WO bazında grupla — bir WO'ya birden fazla satırdan bağ olabilir.
    const woMap = new Map<
      string,
      {
        id: string;
        batchNumber: string;
        status: string;
        // Decimal — toplamada float drift yaratmasın; serializer number'a çevirir.
        allocatedQty: Prisma.Decimal;
      }
    >();
    for (const line of order.lines) {
      for (const link of line.workOrderLinks) {
        const wo = link.workOrder;
        const existing = woMap.get(wo.id);
        if (existing) {
          existing.allocatedQty = existing.allocatedQty.plus(link.allocatedQty);
        } else {
          woMap.set(wo.id, {
            id: wo.id,
            batchNumber: wo.batchNumber,
            status: wo.status,
            allocatedQty: new Prisma.Decimal(link.allocatedQty),
          });
        }
      }
    }

    // Her WO için: diğer siparişlere de bağlı mı + üretilen rulo sayısı.
    const affectedWorkOrders = await Promise.all(
      Array.from(woMap.values()).map(async (wo) => {
        const [otherOrders, producedRollCount] = await Promise.all([
          prisma.order.findMany({
            where: {
              id: { not: orderId },
              lines: {
                some: { workOrderLinks: { some: { workOrderId: wo.id } } },
              },
            },
            select: { id: true, orderNumber: true },
          }),
          prisma.roll.count({
            where: { producedInStep: { workOrderId: wo.id } },
          }),
        ]);

        const isSoleOrder = otherOrders.length === 0;
        const allowedActions = computeAllowedActions(wo.status, isSoleOrder);
        const defaultAction = pickDefaultAction(wo.status, isSoleOrder);

        return {
          id: wo.id,
          batchNumber: wo.batchNumber,
          status: wo.status,
          allocatedQty: wo.allocatedQty,
          isSoleOrder,
          otherOrdersCount: otherOrders.length,
          otherOrderNumbers: otherOrders.map((o) => o.orderNumber),
          producedRollCount,
          allowedActions,
          defaultAction,
        };
      })
    );

    return {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        affectedWorkOrders,
      },
    };
  }

  /**
   * Planlamacı: Preview'ı görüp her WO için seçim yaptıktan sonra çağrılır.
   * `workOrderActions` boş gelirse default davranış uygulanır (preview ile
   * aynı): PLANNED → UNLINK_ONLY, IN_PROGRESS+ tek-sipariş → CONVERT_TO_STOCK,
   * çoklu-sipariş → UNLINK_ONLY.
   *
   * Sıra: önce CANCEL_WO aksiyonları (WorkOrderService.softDelete cascadeleriyle),
   * sonra tek transaction içinde join temizliği + WO type değişimi + order
   * iptal. CANCEL_WO öncesi başarılı, sonrası başarısız olursa orphan WO
   * iptal kalır — operatör tekrar denerse idempotent (zaten iptal).
   */
  async cancelWithActions(
    orderId: string,
    workOrderActions: Array<{ workOrderId: string; action: CancelAction }>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const previewRes = await this.getCancelPreview(orderId);
    const preview = previewRes.data as {
      orderId: string;
      orderNumber: string;
      affectedWorkOrders: Array<{
        id: string;
        status: string;
        isSoleOrder: boolean;
        allowedActions: CancelAction[];
        defaultAction: CancelAction;
      }>;
    };

    // Her WO için seçilen aksiyonu belirle (operatör vermediyse default).
    const actionByWO = new Map<string, CancelAction>();
    for (const wo of preview.affectedWorkOrders) {
      const provided = workOrderActions.find((a) => a.workOrderId === wo.id);
      if (provided) {
        if (!wo.allowedActions.includes(provided.action)) {
          throw AppError.badRequest(
            `WO ${wo.id} için '${provided.action}' geçersiz. İzinli: ${wo.allowedActions.join(", ")}`
          );
        }
        actionByWO.set(wo.id, provided.action);
      } else {
        actionByWO.set(wo.id, wo.defaultAction);
      }
    }

    // 1) CANCEL_WO aksiyonları — WorkOrderService.softDelete cascadeleriyle.
    //    Dynamic import: workorder.service.ts → order.service.ts döngüsünden
    //    kaçınmak için.
    const cancelWoIds = preview.affectedWorkOrders
      .filter((wo) => actionByWO.get(wo.id) === "CANCEL_WO")
      .map((wo) => wo.id);
    if (cancelWoIds.length > 0) {
      const { WorkOrderService } = await import("./workorder.service");
      const woService = new WorkOrderService();
      for (const woId of cancelWoIds) {
        await woService.softDelete(woId, userId);
      }
    }

    // 2) Tek transaction: convert + unlink + order cancel.
    await prisma.$transaction(async (tx) => {
      for (const wo of preview.affectedWorkOrders) {
        const action = actionByWO.get(wo.id)!;
        if (action === "CONVERT_TO_STOCK") {
          await tx.workOrder.update({
            where: { id: wo.id },
            data: { type: "STOCK_PRODUCTION" },
          });
        }
        // UNLINK_ONLY / CONVERT_TO_STOCK / CANCEL_WO hepsi join'i temizler.
        await tx.workOrderToOrderLine.deleteMany({
          where: {
            workOrderId: wo.id,
            orderLine: { orderId },
          },
        });
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: orderId,
      newData: {
        status: "CANCELLED",
        actions: Array.from(actionByWO.entries()).map(([woId, a]) => ({
          workOrderId: woId,
          action: a,
        })),
      },
    });

    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    return {
      success: true,
      data: updated,
      message: `Sipariş iptal edildi (${preview.affectedWorkOrders.length} iş emri etkilendi)`,
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
