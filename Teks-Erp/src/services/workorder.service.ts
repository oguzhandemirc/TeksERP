// =============================================================================
// TeksERP - WorkOrder (Parti) Service
// =============================================================================
// Handles Work Order creation, roll attachment, and document generation.
// Business Rules:
//   - A Work Order CAN exist without linked orders (producing for stock).
//   - A Work Order CAN be linked to multiple orders.
//   - WorkOrderSteps are auto-generated from the provided route stations.
//   - Rolls attached to a WO change status from STOCK → IN_PRODUCTION.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
} from "../utils/query-parser";
import { Request } from "express";
import { WorkOrder, WorkOrderStatus, RollStatus, Prisma } from "@prisma/client";

/**
 * Eğer bir Order'a bağlı başka aktif (CANCELLED olmayan) WO yoksa,
 * Order'ı IN_PRODUCTION'dan APPROVED'a geri çek.
 * Transaction client (tx) parametresi dışarıdan verilmeli.
 */
async function revertOrdersIfNoActiveWO(
  tx: Prisma.TransactionClient,
  orderIds: string[],
  excludeWorkOrderId: string
): Promise<string[]> {
  if (orderIds.length === 0) return [];

  const reverted: string[] = [];

  for (const orderId of orderIds) {
    const activeLinkCount = await tx.workOrderToOrderLine.count({
      where: {
        orderLine: { orderId },
        workOrderId: { not: excludeWorkOrderId },
        workOrder: { status: { not: WorkOrderStatus.CANCELLED } },
      },
    });

    if (activeLinkCount === 0) {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: "IN_PRODUCTION" },
        data: { status: "APPROVED" },
      });
      if (result.count > 0) reverted.push(orderId);
    }
  }

  return reverted;
}

export interface WorkOrderCreateInput {
  batchNumber?:       string | null;
  type?:              string;
  width?:             number | null;
  targetQuantity?:    number | null;
  recipeNo?:          string | null;
  parameters?:        Record<string, unknown> | null;
  plannedStartDate?:  string | null;
  plannedEndDate?:    string | null;
  routeTemplateId?:   string | null;
  dyehouseCompanyId?: string | null;
  /**
   * Rota adımları — routeTemplateId verilmezse zorunlu.
   * Şablon verilirse bu alan override için kullanılabilir.
   */
  steps?: { stationId: string; notes?: string | null }[];
  /**
   * Tercih edilen: her satıra tahsis miktarı.
   * Eski API ile uyum için `orderLineIds` da kabul edilir (allocatedQty=0 olur).
   */
  orderLineAllocations?: { orderLineId: string; allocatedQty?: number }[];
  orderLineIds?: string[] | null;
}

export class WorkOrderService {
  /**
   * Auto-generate a batch number: "B-YYMMDD-NNN".
   * Günlük sıra veritabanındaki mevcut maksimum +1.
   */
  async generateBatchNumber(): Promise<string> {
    const now = new Date();
    const prefix =
      "B-" +
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "-";

    // Retry loop — nadiren de olsa unique çakışma olursa tekrar dene
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await prisma.workOrder.findFirst({
        where: { batchNumber: { startsWith: prefix } },
        orderBy: { batchNumber: "desc" },
        select: { batchNumber: true },
      });

      const seq = last
        ? parseInt(last.batchNumber.split("-").pop() ?? "0", 10) + 1
        : 1;

      const candidate = `${prefix}${String(seq).padStart(3, "0")}`;

      const exists = await prisma.workOrder.findUnique({ where: { batchNumber: candidate } });
      if (!exists) return candidate;
    }

    throw AppError.internal("Parti numarası üretilemedi, lütfen tekrar deneyin");
  }

  /**
   * Create a new Work Order.
   *
   * Kurallar:
   *   - routeTemplateId verilirse RouteStep'ler WorkOrderStep'e kopyalanır (copy-on-write snapshot).
   *     Bu durumda `steps` verilmemelidir; verilirse reddedilir.
   *   - routeTemplateId verilmezse `steps` zorunlu.
   *   - `orderLineAllocations` verilirse her satır için overbooking kontrolü yapılır.
   *   - type=ORDER_PRODUCTION ise en az bir sipariş bağı zorunlu.
   *   - batchNumber verilmezse otomatik üretilir (B-YYMMDD-NNN).
   */
  async create(
    data: WorkOrderCreateInput,
    userId?: string
  ): Promise<ApiResponse<WorkOrder>> {
    const type = (data.type as WorkOrder["type"]) ?? "ORDER_PRODUCTION";

    // ── Rota adımlarını hazırla (şablondan veya raw'dan) ────────────────────
    let finalSteps: { stationId: string; notes: string | null }[] = [];

    if (data.routeTemplateId) {
      if (data.steps && data.steps.length > 0) {
        throw AppError.badRequest(
          "Aynı anda hem routeTemplateId hem steps veremezsiniz. Birini seçin."
        );
      }
      const template = await prisma.route.findUnique({
        where: { id: data.routeTemplateId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!template) {
        throw AppError.notFound("Rota şablonu bulunamadı");
      }
      if (!template.isActive) {
        throw AppError.badRequest("Pasif bir rota şablonu kullanılamaz");
      }
      if (template.steps.length === 0) {
        throw AppError.badRequest("Rota şablonunda adım yok");
      }
      finalSteps = template.steps.map((s) => ({
        stationId: s.stationId,
        notes:     s.defaultNotes ?? null,
      }));
    } else {
      if (!data.steps || data.steps.length === 0) {
        throw AppError.badRequest(
          "En az bir rota adımı (steps) veya bir routeTemplateId gerekli"
        );
      }
      finalSteps = data.steps.map((s) => ({
        stationId: s.stationId,
        notes:     s.notes ?? null,
      }));
    }

    // ── Sipariş bağları + tahsis miktarları (3.2) ───────────────────────────
    let allocations: { orderLineId: string; allocatedQty: number }[] = [];
    if (data.orderLineAllocations && data.orderLineAllocations.length > 0) {
      allocations = data.orderLineAllocations.map((a) => ({
        orderLineId: a.orderLineId,
        allocatedQty: a.allocatedQty ?? 0,
      }));
    } else if (data.orderLineIds && data.orderLineIds.length > 0) {
      // Geriye uyumluluk
      allocations = data.orderLineIds.map((id) => ({ orderLineId: id, allocatedQty: 0 }));
    }

    if (type === "ORDER_PRODUCTION" && allocations.length === 0) {
      throw AppError.badRequest(
        "ORDER_PRODUCTION tipindeki iş emri en az bir sipariş satırına bağlanmalıdır"
      );
    }

    // ── Dyehouse doğrulama (3.3) ────────────────────────────────────────────
    if (data.dyehouseCompanyId) {
      const dyehouse = await prisma.customer.findUnique({
        where: { id: data.dyehouseCompanyId },
        select: { id: true, type: true, isActive: true },
      });
      if (!dyehouse || !dyehouse.isActive) {
        throw AppError.badRequest("Boyahane firması bulunamadı veya pasif");
      }
      if (dyehouse.type !== "SUBCONTRACTOR" && dyehouse.type !== "DYEHOUSE") {
        throw AppError.badRequest(
          "Boyahane alanı sadece Fason (SUBCONTRACTOR) veya Boyahane (DYEHOUSE) tipindeki firmalardan seçilebilir"
        );
      }
    }

    // ── batchNumber (R11 generator) ─────────────────────────────────────────
    const batchNumber = data.batchNumber && data.batchNumber.trim().length > 0
      ? data.batchNumber.trim()
      : await this.generateBatchNumber();

    const workOrder = await prisma.$transaction(async (tx) => {
      // Overbooking guard (3.2) — her orderLine için reservedQty hesapla
      if (allocations.length > 0) {
        const orderLines = await tx.orderLine.findMany({
          where: { id: { in: allocations.map((a) => a.orderLineId) } },
          include: {
            workOrderLinks: {
              where: { workOrder: { status: { not: WorkOrderStatus.CANCELLED } } },
              select: { allocatedQty: true },
            },
          },
        });

        if (orderLines.length !== allocations.length) {
          throw AppError.badRequest("Bazı sipariş satırları bulunamadı");
        }

        for (const alloc of allocations) {
          const line = orderLines.find((l) => l.id === alloc.orderLineId);
          if (!line) continue;
          if (alloc.allocatedQty < 0) {
            throw AppError.badRequest(
              `Negatif tahsis miktarı kabul edilmez (orderLine: ${line.id})`
            );
          }
          const alreadyReserved = line.workOrderLinks.reduce(
            (sum, l) => sum + (l.allocatedQty ?? 0),
            0
          );
          const remaining = line.quantity - alreadyReserved;
          if (alloc.allocatedQty > remaining + 0.0001 /* float tolerance */) {
            throw AppError.conflict(
              `Sipariş satırı ${line.id} için kalan kapasite ${remaining.toFixed(
                2
              )} — talep edilen ${alloc.allocatedQty.toFixed(2)} aşıyor (overbooking).`
            );
          }
        }
      }

      const wo = await tx.workOrder.create({
        data: {
          batchNumber,
          type,
          width:             data.width          ?? null,
          targetQuantity:    data.targetQuantity ?? null,
          recipeNo:          data.recipeNo       ?? null,
          parameters:        (data.parameters as Prisma.InputJsonValue) ?? undefined,
          status:            WorkOrderStatus.PLANNED,
          plannedStartDate:  data.plannedStartDate ? new Date(data.plannedStartDate) : null,
          plannedEndDate:    data.plannedEndDate   ? new Date(data.plannedEndDate)   : null,
          routeTemplateId:   data.routeTemplateId   ?? null,
          dyehouseCompanyId: data.dyehouseCompanyId ?? null,
          steps: {
            create: finalSteps.map((step, index) => ({
              stationId:    step.stationId,
              stepSequence: index + 1,
              notes:        step.notes,
            })),
          },
          ...(allocations.length > 0
            ? {
                orderLinks: {
                  create: allocations.map((a) => ({
                    orderLineId:  a.orderLineId,
                    allocatedQty: a.allocatedQty,
                  })),
                },
              }
            : {}),
        },
        include: {
          steps:      { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: { include: { orderLine: { include: { order: true, item: true } } } },
          routeTemplate: true,
          dyehouseCompany: true,
        },
      });

      // ── Bağlı siparişlerin durumunu IN_PRODUCTION'a çek ──────────────────
      if (allocations.length > 0) {
        const linkedLines = await tx.orderLine.findMany({
          where: { id: { in: allocations.map((a) => a.orderLineId) } },
          select: { orderId: true },
        });
        const uniqueOrderIds = [...new Set(linkedLines.map((l) => l.orderId))];

        if (uniqueOrderIds.length > 0) {
          await tx.order.updateMany({
            where: {
              id: { in: uniqueOrderIds },
              status: { in: ["PENDING", "APPROVED"] },
            },
            data: { status: "IN_PRODUCTION" },
          });
        }
      }

      return wo;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: workOrder.id,
      newData: {
        batchNumber:       workOrder.batchNumber,
        type:              workOrder.type,
        width:             workOrder.width,
        recipeNo:          workOrder.recipeNo,
        status:            workOrder.status,
        stepCount:         finalSteps.length,
        routeTemplateId:   workOrder.routeTemplateId,
        dyehouseCompanyId: workOrder.dyehouseCompanyId,
        allocationCount:   allocations.length,
      },
    });

    return {
      success: true,
      data: workOrder,
      message: `İş emri oluşturuldu: ${workOrder.batchNumber}`,
    };
  }

  /**
   * List work orders with dynamic filtering, sorting, pagination.
   */
  async findAll(req: Request): Promise<PaginatedResponse<WorkOrder>> {
    const params = parseQueryParams(req);
    const where = buildWhereClause(
      params.filters,
      ["batchNumber"],
      params.search
    );
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: { include: { orderLine: { include: { order: true, item: true } } } },
        },
      }),
      prisma.workOrder.count({ where }),
    ]);

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
   * Get single work order by ID.
   */
  async findById(id: string): Promise<ApiResponse<WorkOrder | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
        orderLinks: { include: { orderLine: { include: { order: true, item: true } } } },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    return { success: true, data: wo };
  }

  /**
   * Soft-delete: sets status = CANCELLED (WorkOrder has no isActive field).
   * Veritabanı mantığı:
   * 1. İş Emri iptal edilir.
   * 2. İş Emrine bağlı kumaş topları (currentStepId veya producedInStepId üzerinden bağlanmış) bulunur.
   * 3. İlgili topların bağı (adım bağlantıları) kopartılır ve statüleri STOCK (Ham Depo) durumuna geri çekilir.
   * Tüm bu işlemler güvenli bir transaction bloğunda gerçekleşir.
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: true,
        orderLinks: { include: { orderLine: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw AppError.badRequest("İş emri zaten iptal edilmiş");
    }
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict("Tamamlanmış iş emri iptal edilemez");
    }

    const stepIds = existing.steps.map((step) => step.id);
    const affectedOrderIds = [
      ...new Set(existing.orderLinks.map((l) => l.orderLine.orderId)),
    ];

    const { updated, revertedOrderIds } = await prisma.$transaction(async (tx) => {
      const cancelledWO = await tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.CANCELLED },
      });

      if (stepIds.length > 0) {
        await tx.roll.updateMany({
          where: {
            OR: [
              { producedInStepId: { in: stepIds } },
              { currentStepId: { in: stepIds } },
            ],
          },
          data: {
            status: RollStatus.STOCK,
            producedInStepId: null,
            currentStepId: null,
          },
        });
      }

      // WO iptal olunca tüm ACTIVE refakat kartlarını VOIDED'a çek
      await tx.travelerCard.updateMany({
        where: { workOrderId: id, status: "ACTIVE" },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidReason: "WO_CANCELLED",
        },
      });

      const reverted = await revertOrdersIfNoActiveWO(tx, affectedOrderIds, id);

      return { updated: cancelledWO, revertedOrderIds: reverted };
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { batchNumber: existing.batchNumber, status: existing.status },
      newData: {
        status: WorkOrderStatus.CANCELLED,
        revertedOrderIds,
      },
    });

    return {
      success: true,
      data: updated,
      message:
        `İş emri iptal edildi, bağlı toplar STOCK'a çekildi` +
        (revertedOrderIds.length > 0
          ? ` ve ${revertedOrderIds.length} sipariş APPROVED durumuna geri döndürüldü`
          : "") +
        `: ${existing.batchNumber}`,
    };
  }

  /**
   * Hard-delete: physically removes the work order and all related records.
   * Runs inside a transaction to maintain referential integrity.
   * Order: WorkOrderStep → WorkOrderToOrderLine → WorkOrder
   */
  /**
   * Hard-delete: physically removes the work order and all related records.
   * Runs inside a transaction to maintain referential integrity.
   *
   * R5 fix: Silmeden önce bağlı tüm topları STOCK'a geri çek
   *         (aksi halde Roll.currentStepId / producedInStepId dangling kalır).
   * R2 fix: Bu WO'nun bağlı olduğu siparişleri IN_PRODUCTION'dan APPROVED'a geri çek
   *         (başka aktif WO yoksa).
   *
   * Sıra: Roll kurtarma → Order geri çekme → WorkOrderStep → WorkOrderToOrderLine → WorkOrder
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: true,
        orderLinks: { include: { orderLine: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (existing.status === WorkOrderStatus.IN_PROGRESS) {
      throw AppError.conflict(
        "Üretimdeki iş emri kalıcı olarak silinemez. Önce iptal edin (soft-delete)."
      );
    }

    const stepIds = existing.steps.map((s) => s.id);
    const affectedOrderIds = [
      ...new Set(existing.orderLinks.map((l) => l.orderLine.orderId)),
    ];

    const revertedOrderIds = await prisma.$transaction(async (tx) => {
      if (stepIds.length > 0) {
        await tx.roll.updateMany({
          where: {
            OR: [
              { producedInStepId: { in: stepIds } },
              { currentStepId: { in: stepIds } },
            ],
          },
          data: {
            status: RollStatus.STOCK,
            producedInStepId: null,
            currentStepId: null,
          },
        });

        // RollMovement RESTRICT — ilişkili hareketleri önce sil
        await tx.rollMovement.deleteMany({
          where: { workOrderStepId: { in: stepIds } },
        });
      }

      const reverted = await revertOrdersIfNoActiveWO(tx, affectedOrderIds, id);

      // Fason belgeleri (stepId ve workOrderId RESTRICT) — önce mal kabul
      // (receipt_items cascade ile siliniyor, newRollId referansı düşüyor),
      // sonra sevk (dispatch_items cascade ile siliniyor).
      await tx.subcontractorReceipt.deleteMany({ where: { workOrderId: id } });
      await tx.subcontractorDispatch.deleteMany({ where: { workOrderId: id } });

      // Swatch (kartela) RESTRICT — iş emrine bağlı olanları sil
      await tx.swatch.deleteMany({ where: { workOrderId: id } });

      // TravelerCard RESTRICT — kart ve (cascade ile) scan'leri sil
      await tx.travelerCard.deleteMany({ where: { workOrderId: id } });
      // Manifest RESTRICT — belgeleri sil
      await tx.manifest.deleteMany({ where: { workOrderId: id } });

      await tx.workOrderStep.deleteMany({ where: { workOrderId: id } });
      await tx.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } });
      await tx.workOrder.delete({ where: { id } });

      return reverted;
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: {
        batchNumber: existing.batchNumber,
        type: existing.type,
        status: existing.status,
        stepCount: existing.steps.length,
      },
      newData: { revertedOrderIds },
    });

    return {
      success: true,
      data: existing,
      message: `İş emri kalıcı olarak silindi: ${existing.batchNumber}`,
    };
  }

  /**
   * Attach rolls to a work order by barcode scan.
   * Business Rule: Rolls must be in STOCK status.
   * Changes status to IN_PRODUCTION and links to first step.
   */
  async attachRolls(
    workOrderId: string,
    barcodes: string[],
    userId?: string
  ): Promise<ApiResponse<{ attached: number; errors: string[] }>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: { orderBy: { stepSequence: "asc" } },
      },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (wo.status !== WorkOrderStatus.PLANNED) {
      throw AppError.conflict(
        `Sadece 'Planlandı' durumundaki iş emrine top bağlanabilir (mevcut: ${wo.status}).`
      );
    }

    if (wo.steps.length === 0) {
      throw AppError.badRequest("İş emrinde rota adımı tanımlanmamış");
    }

    const firstStepId = wo.steps[0].id;

    // R10: WorkOrderType bazlı kabul edilen roll statüsleri
    // - REPAIR_REWORK: tamamlanmış/sevke hazır topu tekrar işlemeye alabilir.
    // - Diğerleri: sadece STOCK'tan başlar.
    const acceptedRollStatuses: RollStatus[] =
      wo.type === "REPAIR_REWORK"
        ? [RollStatus.STOCK, RollStatus.PRODUCED, RollStatus.READY_FOR_SHIP]
        : [RollStatus.STOCK];

    const attached: { id: string; barcode: string; prevStatus: RollStatus; qtyIn: number }[] = [];
    const errorMessages: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const barcode of barcodes) {
        // R3: Atomik güncelleme — findUnique+update yerine updateMany filtreli.
        const roll = await tx.roll.findUnique({ where: { barcode } });
        if (!roll) {
          errorMessages.push(`${barcode}: Barkod bulunamadı`);
          continue;
        }

        const updateResult = await tx.roll.updateMany({
          where: {
            id: roll.id,
            status: { in: acceptedRollStatuses },
          },
          data: {
            status: RollStatus.IN_PRODUCTION,
            producedInStepId: firstStepId,
            currentStepId: firstStepId,
          },
        });

        if (updateResult.count === 0) {
          errorMessages.push(
            `${barcode}: Top uygun durumda değil (mevcut: ${roll.status}, beklenen: ${acceptedRollStatuses.join("/")})`
          );
          continue;
        }

        // 3.4 — RollMovement: topun ilk adıma girişini kaydet
        await tx.rollMovement.create({
          data: {
            rollId:          roll.id,
            workOrderStepId: firstStepId,
            qtyIn:           roll.currentQty,
            weightIn:        roll.weightKg,
            operatorId:      userId ?? null,
          },
        });

        attached.push({
          id: roll.id,
          barcode,
          prevStatus: roll.status,
          qtyIn: roll.currentQty,
        });
      }
    });

    // R8 fix: Audit recordId artık roll.id (UUID), barcode meta-data olarak newData'ya gidiyor.
    for (const r of attached) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: r.id,
        oldData: { status: r.prevStatus },
        newData: {
          status: "IN_PRODUCTION",
          workOrderId,
          firstStepId,
          barcode: r.barcode,
          qtyIn: r.qtyIn,
        },
      });
    }

    return {
      success: true,
      data: {
        attached: attached.length,
        errors: errorMessages,
      },
      message: `${attached.length} top iş emrine bağlandı`,
    };
  }

  /**
   * Topları İş Emrinden (Sepetten) Çıkarma
   * Sepet mantığı için eklendi: Yanlış bağlanan stok topların rotasını ve durumunu temizler.
   */
  async detachRolls(workOrderId: string, rollIds: string[], userId?: string): Promise<ApiResponse<any>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { steps: true },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    // R4: Sepet mantığı — sadece PLANNED durumdayken top çıkarılabilir.
    if (wo.status !== WorkOrderStatus.PLANNED) {
      throw AppError.conflict(
        `Sadece 'Planlandı' durumundaki iş emirlerinden top çıkarılabilir (mevcut: ${wo.status}).`
      );
    }

    const stepIds = wo.steps.map(s => s.id);
    if (stepIds.length === 0) {
      throw AppError.badRequest("İş emrinin adımları bulunamadı.");
    }

    const detached: { id: string; barcode: string }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const rollId of rollIds) {
        const roll = await tx.roll.findUnique({ where: { id: rollId } });
        if (!roll) continue;

        await tx.roll.update({
          where: { id: rollId },
          data: {
            status: RollStatus.STOCK,
            producedInStepId: null,
            currentStepId: null,
          },
        });

        // 3.4 — Açık RollMovement kayıtlarını DETACH notuyla kapat
        await tx.rollMovement.updateMany({
          where: {
            rollId,
            workOrderStepId: { in: stepIds },
            exitedAt: null,
          },
          data: {
            exitedAt: new Date(),
            qtyOut: roll.currentQty,
            weightOut: roll.weightKg,
            notes: "DETACHED_FROM_WO",
          },
        });

        detached.push({ id: rollId, barcode: roll.barcode });
      }
    });

    // R8 fix: audit recordId = UUID
    for (const r of detached) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: r.id,
        oldData: { status: "IN_PRODUCTION", workOrderId },
        newData: { status: "STOCK", workOrderId: null, barcode: r.barcode },
      });
    }

    return {
      success: true,
      data: { detached: detached.length },
      message: `${detached.length} top iş emrinden başarıyla çıkarıldı.`,
    };
  }

  /**
   * İş Emrini Kilitle (Üretime Al)
   * Sepetteki (PLANNED) siparişi onaylayıp IN_PROGRESS durumuna sokar, top eklemeye/çıkarmaya kapatır.
   */
  async lockWorkOrder(workOrderId: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }
    if (wo.status !== WorkOrderStatus.PLANNED) {
      throw AppError.badRequest("Sadece 'Planlandı' durumundaki iş emirleri kilitlenebilir/başlatılabilir.");
    }

    const updated = await prisma.workOrder.update({
      where: { id: workOrderId },
      data: { status: WorkOrderStatus.IN_PROGRESS },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      oldData: { status: wo.status },
      newData: { status: WorkOrderStatus.IN_PROGRESS },
    });

    return {
      success: true,
      data: updated,
      message: "İş emri kilitlendi ve üretime (IN_PROGRESS) alındı.",
    };
  }

  /**
   * Sepetteki (Bağlanmış) Topları Getir
   */
  async getAttachedRolls(workOrderId: string): Promise<ApiResponse<any[]>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { steps: true },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    const stepIds = wo.steps.map((s) => s.id);
    if (stepIds.length === 0) {
      return { success: true, data: [] };
    }

    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { producedInStepId: { in: stepIds } },
          { currentStepId: { in: stepIds } },
        ],
      },
      include: { item: true, variant: true },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: rolls };
  }

  /**
   * Generate Traveler Card (Refakat Kartı) data for a work order.
   * Contains work order info, route steps, and linked order info.
   */
  async getTravelCard(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
        orderLinks: {
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true } },
                item: true,
              },
            },
          },
        },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    const travelCard = {
      batchNumber: wo.batchNumber,
      type: wo.type,
      width: wo.width,
      recipeNo: wo.recipeNo,
      status: wo.status,
      parameters: wo.parameters,
      route: wo.steps.map((step) => ({
        sequence: step.stepSequence,
        stationCode: step.station.code,
        stationName: step.station.name,
        stationType: step.station.type,
        status: step.status,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      })),
      linkedOrders: wo.orderLinks.map((link) => ({
        orderNumber: link.orderLine.order.orderNumber,
        customerName: link.orderLine.order.customer.name,
        itemName: link.orderLine.item.name,
        requestedQty: link.orderLine.quantity,
      })),
      createdAt: wo.createdAt,
    };

    return { success: true, data: travelCard };
  }

  /**
   * Generate Manifest / Çeki Listesi data.
   */
  async getManifest(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
        dyehouseCompany: true,
        orderLinks: {
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true } },
                item: true,
              },
            },
          },
        },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { producedInStepId: { in: wo.steps.map((s) => s.id) } },
          { currentStepId: { in: wo.steps.map((s) => s.id) } },
        ],
      },
      include: { item: true },
    });

    // 3.3 — destination öncelikle WorkOrder.dyehouseCompany; yoksa ilk istasyon (geriye uyum)
    const destination = wo.dyehouseCompany
      ? {
          kind: "DYEHOUSE" as const,
          companyCode: wo.dyehouseCompany.code,
          companyName: wo.dyehouseCompany.name,
        }
      : wo.steps[0]
      ? {
          kind: "STATION" as const,
          stationCode: wo.steps[0].station.code,
          stationName: wo.steps[0].station.name,
        }
      : null;

    const manifest = {
      batchNumber: wo.batchNumber,
      type: wo.type,
      width: wo.width,
      recipeNo: wo.recipeNo,
      totalRolls: rolls.length,
      totalMeterage: rolls.reduce((sum, r) => sum + r.currentQty, 0),
      totalWeight: rolls.reduce((sum, r) => sum + (r.weightKg ?? 0), 0),
      rolls: rolls.map((r) => ({
        barcode: r.barcode,
        itemName: r.item.name,
        currentQty: r.currentQty,
        weightKg: r.weightKg,
        status: r.status,
      })),
      destination,
    };

    return { success: true, data: manifest };
  }

  /**
   * 3.5 — Çeki Listesi kalıcı belge (Manifest) oluştur.
   * Mevcut WO'nun anlık durumunu snapshot'layıp Manifest tablosuna yazar.
   * Aynı WO için birden fazla manifest basılabilir (reprint mantığı — eski belgeler korunur).
   */
  async createManifest(
    workOrderId: string,
    userId?: string,
    notes?: string
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    const preview = await this.getManifest(workOrderId);
    if (!preview.success || !preview.data) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    // Manifest no: M-YYMMDD-NNN
    const now = new Date();
    const prefix =
      "M-" +
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "-";

    const last = await prisma.manifest.findFirst({
      where: { manifestNo: { startsWith: prefix } },
      orderBy: { manifestNo: "desc" },
      select: { manifestNo: true },
    });
    const seq = last
      ? parseInt(last.manifestNo.split("-").pop() ?? "0", 10) + 1
      : 1;
    const manifestNo = `${prefix}${String(seq).padStart(3, "0")}`;

    const manifest = await prisma.manifest.create({
      data: {
        manifestNo,
        workOrderId,
        printedById: userId ?? null,
        snapshot: preview.data as Prisma.InputJsonValue,
        notes: notes ?? null,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "MANIFEST",
      recordId: manifest.id,
      newData: { manifestNo, workOrderId },
    });

    return {
      success: true,
      data: {
        id: manifest.id,
        manifestNo: manifest.manifestNo,
        printedAt: manifest.printedAt,
        snapshot: manifest.snapshot,
      },
      message: `Çeki listesi oluşturuldu: ${manifestNo}`,
    };
  }

  /**
   * 3.5 — İş emrinin geçmiş tüm manifest belgeleri.
   */
  async listManifests(workOrderId: string): Promise<ApiResponse<unknown>> {
    const manifests = await prisma.manifest.findMany({
      where: { workOrderId },
      orderBy: { printedAt: "desc" },
      include: {
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });
    return { success: true, data: manifests };
  }

  /**
   * List work orders that are PLANNED and ready for roll attachment.
   * These are work orders created by planning but not yet started.
   */
  async findAvailableForAttach(): Promise<ApiResponse<WorkOrder[]>> {
    const workOrders = await prisma.workOrder.findMany({
      where: {
        status: "PLANNED",
      },
      include: {
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
          take: 1,
        },
        orderLinks: {
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true } },
                item: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: workOrders,
    };
  }
}
