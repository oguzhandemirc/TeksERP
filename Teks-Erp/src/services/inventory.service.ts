// =============================================================================
// TeksERP - Inventory Service
// =============================================================================
// Handles initial goods receipt (Ham Mal Girişi / QC1) and inventory queries.
// Business Rule: Rolls default to STOCK status. IN_PRODUCTION or SHIPPED
// rolls are excluded from inventory queries unless explicitly filtered.
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
  isCursorRequested,
  applyDateRange,
} from "../utils/query-parser";

const ROLL_DATE_FIELDS = ["createdAt"] as const;

function readList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.length > 0) {
    return value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function readNumberRange(
  min: string | string[] | undefined,
  max: string | string[] | undefined
): { gte?: number; lte?: number } | null {
  const range: { gte?: number; lte?: number } = {};
  const lo = typeof min === "string" ? parseFloat(min) : NaN;
  const hi = typeof max === "string" ? parseFloat(max) : NaN;
  if (Number.isFinite(lo)) range.gte = lo;
  if (Number.isFinite(hi)) range.lte = hi;
  return Object.keys(range).length > 0 ? range : null;
}
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import type { CursorPaginatedResponse } from "./base.service";
import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  Prisma,
  Roll,
  RollStatus,
  RollOperationType,
  RollEntrySource,
  ItemType,
  WorkOrderStatus,
} from "@prisma/client";
import {
  findDerivedItemOrThrow,
  getItemDerivedAttributes,
} from "./helpers/item-derive.helper";
import {
  ensureWorkOrderInProgress,
  openMovementForNextStep,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";

export type RollHistoryEventKind =
  | "CREATED"
  | "MOVEMENT_IN"
  | "MOVEMENT_OUT"
  | "OPERATION"
  | "SUBCONTRACTOR_DISPATCH"
  | "SUBCONTRACTOR_RECEIPT"
  | "SHIPPED";

export interface RollHistoryEvent {
  kind: RollHistoryEventKind;
  subKind?: string;
  at: string;
  title: string;
  stationName: string | null;
  details: Record<string, unknown>;
  operatorName: string | null;
}

export interface RollHistoryPayload {
  roll: {
    id: string;
    barcode: string;
    status: RollStatus;
    initialQty: number;
    currentQty: number;
    weightKg: number | null;
    item: { id: string; code: string; name: string; itemType: string } | null;
    variant: { id: string; code: string; name: string } | null;
  };
  events: RollHistoryEvent[];
}

function operationLabel(type: RollOperationType): string {
  switch (type) {
    case "KURSUN_APPLIED":
      return "Kurşun Uygulandı";
    case "QC2_COMPLETED":
      return "QC2 Tamamlandı";
    case "TAMBUR_PROCESSED":
      return "Tambur İşlendi";
    case "PACKAGED":
      return "Paketlendi";
    case "SUBCONTRACTOR_SENT":
      return "Fasona Gönderildi";
    case "SUBCONTRACTOR_RETURNED":
      return "Fasondan Döndü";
    default:
      return type;
  }
}

/**
 * Generate a unique barcode string: TEKS-YYYYMMDD-XXXX
 */
function generateBarcode(): string {
  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const randomPart = uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();
  return `TEKS-${datePart}-${randomPart}`;
}

export class InventoryService {
  /**
   * Initial goods receipt — creates a new Roll.
   *
   * - `workOrderId` verilmezse: klasik STOCK girişi (sonra attach-rolls ile bağlanır).
   * - `workOrderId` verilirse: aynı transaction'da WO'nun ilk step'ine bağlanır
   *   (IN_PRODUCTION + currentStepId/producedInStepId = firstStepId). INTERNAL ilk
   *   step için RollMovement açılır (KK1 girişi). EXTERNAL ilk step için movement
   *   sevk anında açılır (attach-rolls ile aynı semantik).
   *
   * Yalnız PLANNED iş emirlerine bağlama yapılabilir.
   */
  async createInitialEntry(
    data: {
      itemId:        string;
      variantId?:    string | null;
      initialQty:    number;
      weightKg?:     number;
      qualityGrade?: string;
      width?:        number;  // En (cm)
      workOrderId?:  string | null;
    },
    userId?: string
  ): Promise<ApiResponse<Roll>> {
    // Verify item exists
    const item = await prisma.item.findUnique({ where: { id: data.itemId } });
    if (!item) {
      throw AppError.notFound("Ürün (Item) bulunamadı");
    }

    // Verify variant if provided
    if (data.variantId) {
      const variant = await prisma.itemVariant.findUnique({ where: { id: data.variantId } });
      if (!variant) {
        throw AppError.notFound("Varyant bulunamadı");
      }
      if (variant.itemId !== data.itemId) {
        throw AppError.badRequest("Varyant seçilen ürüne ait değil");
      }
    }

    // WO sağlandıysa: validasyon + ilk + sonraki step bilgisi.
    let attach: {
      workOrderId: string;
      firstStepId: string;
      firstStepIsExternal: boolean;
      nextStepId: string | null;
      nextStepIsExternal: boolean;
    } | null = null;
    if (data.workOrderId) {
      const wo = await prisma.workOrder.findUnique({
        where: { id: data.workOrderId },
        include: {
          steps: {
            orderBy: { stepSequence: "asc" },
            include: { station: { select: { type: true } } },
          },
        },
      });
      if (!wo) throw AppError.notFound("İş emri bulunamadı");
      // PLANNED ve IN_PROGRESS kabul: KK1'de seri top girişi yapılır, ilk top
      // sonrası WO IN_PROGRESS'e çekilir ama operatör başka top eklemeye devam
      // edebilmeli (iptal edilenler yeniden girilecek vb.).
      if (
        wo.status !== WorkOrderStatus.PLANNED &&
        wo.status !== WorkOrderStatus.IN_PROGRESS
      ) {
        throw AppError.conflict(
          `Bu durumdaki iş emrine top bağlanamaz (${wo.status}). Sadece PLANNED veya IN_PROGRESS.`,
        );
      }
      if (wo.steps.length === 0) {
        throw AppError.badRequest("İş emrinde rota adımı yok");
      }
      const firstStep = wo.steps[0];
      const nextStep = wo.steps[1] ?? null;
      attach = {
        workOrderId: wo.id,
        firstStepId: firstStep.id,
        firstStepIsExternal: firstStep.station.type === "EXTERNAL",
        nextStepId: nextStep?.id ?? null,
        nextStepIsExternal: nextStep?.station.type === "EXTERNAL",
      };
    }

    const barcode = generateBarcode();

    // Ham kumaş (RAW_FABRIC) içeride dokunarak üretilir → PRODUCTION.
    // Diğer item tipleri (yarn, consumable, vb) tedarikçiden gelir → SUPPLIER_RECEIPT.
    // CUSTOMER_SUPPLIED yolu service-production endpoint'inde set edilir, burada değil.
    const entrySource: RollEntrySource =
      item.itemType === ItemType.RAW_FABRIC
        ? RollEntrySource.PRODUCTION
        : RollEntrySource.SUPPLIER_RECEIPT;

    const roll = await prisma.$transaction(async (tx) => {
      const created = await tx.roll.create({
        data: {
          barcode,
          itemId:       data.itemId,
          variantId:    data.variantId ?? null,
          initialQty:   data.initialQty,
          currentQty:   data.initialQty,
          weightKg:     data.weightKg ?? null,
          status:       attach ? RollStatus.IN_PRODUCTION : RollStatus.STOCK,
          qualityGrade: data.qualityGrade ?? "1.KALITE",
          width:        data.width ?? null,
          entrySource,
          createdById:  userId ?? null,
          currentStepId:    attach?.firstStepId ?? null,
          producedInStepId: attach?.firstStepId ?? null,
        },
        include: {
          item: true,
          variant: true,
          createdBy: { select: { id: true, username: true, fullName: true } },
        },
      });

      if (attach) {
        if (attach.firstStepIsExternal) {
          // EXTERNAL ilk step (örn: rota boyahane ile başlıyor): roller henüz
          // fasonda değil, sevk anında movement açılır. currentStepId firstStep'te
          // kalır (attachRolls semantiği ile aynı).
        } else {
          // INTERNAL ilk step (örn: KK1 — ham mal kabul). Bu istasyon "intake-only"
          // davranışı: girişin kendisi işleme. Aynı transaction'da auto-finish ile
          // sonraki step'e ilerlet ki operatör hemen Fason Sevk'ten dispatch yapabilsin.
          //   - First step movement: qtyIn = qtyOut = initialQty (passed-through audit)
          //   - Next INTERNAL step varsa: openMovementForNextStep ile ilerlet
          //   - Next EXTERNAL step varsa: currentStepId next'e atanır, movement yok
          //     (sevk anında movement açılır)
          //   - Next step yoksa: top PRODUCED → currentStepId=null
          const now = new Date();
          await tx.rollMovement.create({
            data: {
              rollId: created.id,
              workOrderStepId: attach.firstStepId,
              qtyIn: data.initialQty,
              qtyOut: data.initialQty,
              weightIn: data.weightKg ?? null,
              weightOut: data.weightKg ?? null,
              exitedAt: now,
              operatorId: userId ?? null,
              notes: "AUTO_INTAKE",
            },
          });

          if (attach.nextStepId) {
            if (attach.nextStepIsExternal) {
              // EXTERNAL sonraki step: movement açma, sadece currentStepId taşı.
              // Sevk endpoint'i bu durumu görüp dispatch sırasında movement açar.
              await tx.roll.update({
                where: { id: created.id },
                data: { currentStepId: attach.nextStepId },
              });
              await recomputeStepStatus(tx, attach.nextStepId);
            } else {
              await openMovementForNextStep(tx, {
                rollId: created.id,
                nextStepId: attach.nextStepId,
                qty: data.initialQty,
                weight: data.weightKg ?? null,
                userId: userId ?? null,
                notes: `AUTO_FROM_STEP:${attach.firstStepId}`,
              });
            }
          } else {
            // Tek-adımlı WO: KK1 son adım da → top üretim hattından çıktı.
            await tx.roll.update({
              where: { id: created.id },
              data: { currentStepId: null, status: RollStatus.PRODUCED },
            });
          }

          await recomputeStepStatus(tx, attach.firstStepId);
          await ensureWorkOrderInProgress(tx, attach.workOrderId);
        }
      }

      return created;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        barcode:       roll.barcode,
        itemId:        roll.itemId,
        variantId:     roll.variantId,
        initialQty:    roll.initialQty,
        currentQty:    roll.currentQty,
        weightKg:      roll.weightKg,
        status:        roll.status,
        entrySource:   roll.entrySource,
        workOrderId:   attach?.workOrderId ?? null,
        firstStepId:   attach?.firstStepId ?? null,
      },
    });

    return {
      success: true,
      data: roll,
      message: attach
        ? `Top oluşturuldu ve iş emrine bağlandı. Barkod: ${roll.barcode}`
        : `Top oluşturuldu. Barkod: ${roll.barcode}`,
    };
  }

  /**
   * List rolls with dynamic filtering, sorting, pagination.
   * Business Rule: By default only STOCK rolls are returned.
   * Other statuses must be explicitly requested via filter[status].
   *
   * İki mod (geri uyumlu):
   *   - Offset: ?page=1&pageSize=50 — eski sayfalama, küçük tablo gibi.
   *   - Cursor: ?mode=cursor&limit=50 — büyük tablo (30k+) için sabit hız.
   */
  async findAllRolls(
    req: Request
  ): Promise<PaginatedResponse<Roll> | CursorPaginatedResponse<Roll>> {
    const params = parseQueryParams(req);
    const f = params.filters;

    // Base where: buildWhereClause sadece düz Roll alanları için. Nested ilişki
    // filtreleri (item.isDerived, item.colorId, item.properties...) ve range
    // alanları (width, currentQty) aşağıda explicit compose ediliyor — generic
    // helper'a relation bilgisi sızdırmamak için.
    const where = buildWhereClause(f, ["barcode"], params.search);
    applyDateRange(where, params, ROLL_DATE_FIELDS);

    // --- Status: statusIn[] > status > default STOCK ---
    const statusIn = readList(f["statusIn"]);
    delete where.statusIn;
    if (statusIn.length > 0) {
      where.status = { in: statusIn as RollStatus[] };
    } else if (f["status"] === "ALL") {
      delete where.status;
    } else if (!f["status"]) {
      where.status = RollStatus.STOCK;
    }

    // --- ownerType: müşteri malı vs fabrika stoğu ---
    const ownerType = f["ownerType"] as string | undefined;
    if (ownerType === "CUSTOMER") {
      where.ownerCustomerId = { not: null };
    } else if (ownerType === "FACTORY") {
      where.ownerCustomerId = null;
    }
    delete where.ownerType;

    // --- Item nested: isDerived / baseItemId / colorId / propertyIds (AND-every) ---
    const itemFilter: Record<string, unknown> = {};

    const isDerivedRaw = f["isDerived"];
    delete where.isDerived;
    if (isDerivedRaw === "true" || isDerivedRaw === "false") {
      itemFilter.isDerived = isDerivedRaw === "true";
    }

    const baseItemId = typeof f["baseItemId"] === "string" ? f["baseItemId"] : null;
    delete where.baseItemId;
    if (baseItemId) {
      // Hem ham item'ın kendi top'larını hem de o ham'dan türetilmiş tüm
      // item'ların top'larını getir — kullanıcı "patos" seçtiğinde "patos +
      // patos-mavi-yanmaz" hepsi gelsin.
      itemFilter.OR = [{ id: baseItemId }, { baseItemId }];
    }

    const colorId = typeof f["colorId"] === "string" ? f["colorId"] : null;
    delete where.colorId;
    if (colorId) {
      itemFilter.colorId = colorId;
    }

    const propertyIds = readList(f["propertyIds"]);
    delete where.propertyIds;
    // AND-every: seçilen tüm özellikleri fiilen taşıyan toplar (RollProperty).
    if (propertyIds.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        ...propertyIds.map((pid) => ({
          properties: { some: { propertyId: pid } },
        })),
      ];
    }

    if (Object.keys(itemFilter).length > 0) {
      where.item = itemFilter;
    }

    // --- Width range (Roll.width) ---
    delete where.widthMin;
    delete where.widthMax;
    const widthRange = readNumberRange(f["widthMin"], f["widthMax"]);
    if (widthRange) where.width = widthRange;

    // --- Qty range (Roll.currentQty) ---
    delete where.qtyMin;
    delete where.qtyMax;
    const qtyRange = readNumberRange(f["qtyMin"], f["qtyMax"]);
    if (qtyRange) where.currentQty = qtyRange;

    const include = {
      item: {
        include: {
          color: { select: { id: true, code: true, name: true, hex: true } },
          baseItem: { select: { id: true, code: true, name: true } },
        },
      },
      variant: true,
      ownerCustomer: true,
      operations: { select: { operationType: true } },
      createdBy: { select: { id: true, username: true, fullName: true } },
      properties: {
        select: {
          propertyId: true,
          property: { select: { id: true, code: true, name: true } },
        },
      },
    } as const;

    // CURSOR MODE — dinamik sortBy desteği (utils/cursor.ts dynamic API).
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";

      const sortBy = params.sortBy || "createdAt";
      const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, sortBy, sortOrder)] }
        : where;

      const [items, totalEstimate] = await Promise.all([
        prisma.roll.findMany({
          where: cursorWhereClause,
          orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
          take: limit + 1,
          include,
        }),
        wantTotal ? prisma.roll.count({ where }) : Promise.resolve(undefined),
      ]);

      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, sortBy) : null;

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

    // OFFSET MODE (legacy, küçük gezinmelerde)
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.roll.findMany({
        where,
        orderBy,
        skip,
        take,
        include,
      }),
      prisma.roll.count({ where }),
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
   * Get a single roll by ID with all relations.
   */
  async findRollById(id: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      include: {
        item: { include: { color: true } },
        variant: true,
        ownerCustomer: true,
        errors: true,
        operations: {
          select: {
            id: true,
            operationType: true,
            createdAt: true,
            operator: { select: { id: true, fullName: true, username: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        properties: { include: { property: true } },
        allocations: {
          include: {
            orderLine: {
              include: { order: true },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Get a roll by its barcode.
   */
  async findRollByBarcode(barcode: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { barcode },
      include: {
        item: true,
        variant: true,
        ownerCustomer: true,
        errors: true,
        allocations: {
          include: {
            orderLine: {
              include: { order: true },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Barkod bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Get a roll's full lifecycle history — station movements, discrete operations,
   * subcontractor dispatches/receipts and shipment — merged into one chronological timeline.
   */
  async getRollHistory(id: string): Promise<ApiResponse<RollHistoryPayload | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true,
        barcode: true,
        status: true,
        initialQty: true,
        currentQty: true,
        weightKg: true,
        entrySource: true,
        qualityGrade: true,
        parentRollId: true,
        createdAt: true,
        item: { select: { id: true, code: true, name: true, itemType: true } },
        variant: { select: { id: true, code: true, name: true } },
        // Topu sisteme kim açtı — KK1, fason kabul, Tambur split (parent oluşturucu)
        createdBy: { select: { id: true, username: true, fullName: true } },
        // Parent (kaynak) top — TAMBUR_SPLIT için "kimden ayrıldı" bilgisi.
        // FK indexed, +1 LEFT JOIN; sadece detay sayfasında çağrılan endpoint.
        parent: {
          select: {
            id: true,
            barcode: true,
            qualityGrade: true,
            producedInStep: {
              select: {
                stepSequence: true,
                station: { select: { code: true, name: true } },
                workOrder: { select: { id: true, batchNumber: true } },
              },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    const [movements, operations, dispatchItems, receiptItems, shipmentItems] =
      await Promise.all([
        prisma.rollMovement.findMany({
          where: { rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { enteredAt: "asc" },
        }),
        prisma.rollOperation.findMany({
          where: { rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorDispatchItem.findMany({
          where: { rollId: id },
          include: {
            dispatch: {
              include: {
                subcontractor: { select: { id: true, code: true, name: true } },
                dispatchedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorReceiptItem.findMany({
          where: { newRollId: id },
          include: {
            receipt: {
              include: {
                subcontractor: { select: { id: true, code: true, name: true } },
                receivedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.shipmentItem.findMany({
          where: { rollId: id },
          include: {
            shipment: {
              include: {
                customer: { select: { id: true, code: true, name: true } },
                shippedBy: {
                  select: { id: true, username: true, fullName: true },
                },
              },
            },
          },
        }),
      ]);

    const events: RollHistoryEvent[] = [];

    // Top'un sisteme nasıl girdiğine göre başlık — itemType'tan değil entrySource'tan türer.
    const entryTitle = ((): string => {
      switch (roll.entrySource) {
        case RollEntrySource.PRODUCTION:
          return "Ham Kumaş Üretimi (Giriş)";
        case RollEntrySource.CUSTOMER_SUPPLIED:
          return "Müşteri Malı Kabul (Hizmet Üretimi)";
        case RollEntrySource.TAMBUR_SPLIT:
          return "Tambur Kesimi (Yeni Parça)";
        case RollEntrySource.SUPPLIER_RECEIPT:
        default:
          return "Mal Kabul (Giriş)";
      }
    })();

    // Parent referansı — split rolünün kaynağını izlenebilir kıl.
    // TAMBUR_SPLIT için zorunlu, diğerlerinde de parent varsa eklenir.
    const parentInfo = roll.parent
      ? {
          parentRollId: roll.parent.id,
          parentBarcode: roll.parent.barcode,
          parentQualityGrade: roll.parent.qualityGrade,
          parentWorkOrder: roll.parent.producedInStep?.workOrder
            ? {
                id: roll.parent.producedInStep.workOrder.id,
                batchNumber: roll.parent.producedInStep.workOrder.batchNumber,
              }
            : null,
          parentProducedStation: roll.parent.producedInStep?.station
            ? {
                code: roll.parent.producedInStep.station.code,
                name: roll.parent.producedInStep.station.name,
                stepSequence: roll.parent.producedInStep.stepSequence,
              }
            : null,
        }
      : null;

    events.push({
      kind: "CREATED",
      at: roll.createdAt.toISOString(),
      title: entryTitle,
      stationName: null,
      details: {
        barcode: roll.barcode,
        initialQty: roll.initialQty,
        weightKg: roll.weightKg,
        itemCode: roll.item?.code,
        itemName: roll.item?.name,
        itemType: roll.item?.itemType,
        entrySource: roll.entrySource,
        qualityGrade: roll.qualityGrade,
        ...(parentInfo ? { parent: parentInfo } : {}),
      },
      operatorName: roll.createdBy?.fullName ?? roll.createdBy?.username ?? null,
    });

    for (const m of movements) {
      events.push({
        kind: "MOVEMENT_IN",
        at: m.enteredAt.toISOString(),
        title: `${m.step?.station?.name ?? "İstasyon"} – Giriş`,
        stationName: m.step?.station?.name ?? null,
        details: {
          qtyIn: m.qtyIn,
          weightIn: m.weightIn,
          notes: m.notes,
        },
        operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
      });
      if (m.exitedAt) {
        events.push({
          kind: "MOVEMENT_OUT",
          at: m.exitedAt.toISOString(),
          title: `${m.step?.station?.name ?? "İstasyon"} – Çıkış`,
          stationName: m.step?.station?.name ?? null,
          details: {
            qtyOut: m.qtyOut,
            weightOut: m.weightOut,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn,
            notes: m.notes,
          },
          operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
        });
      }
    }

    for (const op of operations) {
      events.push({
        kind: "OPERATION",
        subKind: op.operationType,
        at: op.createdAt.toISOString(),
        title: operationLabel(op.operationType),
        stationName: op.step?.station?.name ?? null,
        details: {
          metadata: op.metadata,
        },
        operatorName: op.operator?.fullName ?? op.operator?.username ?? null,
      });
    }

    for (const di of dispatchItems) {
      events.push({
        kind: "SUBCONTRACTOR_DISPATCH",
        at: di.dispatch.dispatchedAt.toISOString(),
        title: `Fasona Sevk: ${di.dispatch.subcontractor?.name ?? "-"}`,
        stationName: null,
        details: {
          dispatchNo: di.dispatch.dispatchNo,
          subcontractorCode: di.dispatch.subcontractor?.code,
          subcontractorName: di.dispatch.subcontractor?.name,
          dispatchedQty: di.dispatchedQty,
          dispatchedWeight: di.dispatchedWeight,
          plateNumber: di.dispatch.plateNumber,
          driverName: di.dispatch.driverName,
        },
        operatorName:
          di.dispatch.dispatchedBy?.fullName ??
          di.dispatch.dispatchedBy?.username ??
          null,
      });
    }

    for (const ri of receiptItems) {
      events.push({
        kind: "SUBCONTRACTOR_RECEIPT",
        at: ri.receipt.receivedAt.toISOString(),
        title: `Fasondan Kabul: ${ri.receipt.subcontractor?.name ?? "-"}`,
        stationName: null,
        details: {
          receiptNo: ri.receipt.receiptNo,
          manifestNo: ri.receipt.manifestNo,
          subcontractorCode: ri.receipt.subcontractor?.code,
          subcontractorName: ri.receipt.subcontractor?.name,
          notes: ri.notes,
        },
        operatorName:
          ri.receipt.receivedBy?.fullName ??
          ri.receipt.receivedBy?.username ??
          null,
      });
    }

    for (const si of shipmentItems) {
      const when = si.shipment.shippedAt ?? si.shipment.createdAt;
      events.push({
        kind: "SHIPPED",
        at: when.toISOString(),
        title:
          si.shipment.status === "SHIPPED"
            ? `Sevk Edildi: ${si.shipment.customer?.name ?? "-"}`
            : `İrsaliyeye Eklendi: ${si.shipment.customer?.name ?? "-"}`,
        stationName: null,
        details: {
          shipmentNumber: si.shipment.shipmentNumber,
          shipmentStatus: si.shipment.status,
          customerCode: si.shipment.customer?.code,
          customerName: si.shipment.customer?.name,
          shippedQty: si.shippedQty,
          shippedWeight: si.shippedWeight,
        },
        // Sadece finalize edilmiş (SHIPPED) sevkler için operator gösterilir.
        // PREPARING aşamasında shippedById null olur.
        operatorName:
          si.shipment.status === "SHIPPED"
            ? (si.shipment.shippedBy?.fullName ??
              si.shipment.shippedBy?.username ??
              null)
            : null,
      });
    }

    // Sort: first by timestamp, then by kind order (MOVEMENT_OUT before MOVEMENT_IN
    // before OPERATION) to correctly represent process flow when timestamps coincide.
    // Stable sort preserves original relative order for equal keys.
    // Eşit timestamp'te doğal süreç sırası:
    // istasyondan çıkış → o istasyondaki işlem/karar → sonraki istasyona giriş
    const kindOrder: Record<string, number> = {
      MOVEMENT_OUT: 0,
      OPERATION: 1,
      MOVEMENT_IN: 2,
      SUBCONTRACTOR_DISPATCH: 3,
      SUBCONTRACTOR_RECEIPT: 4,
      SHIPPED: 5,
      CREATED: 6,
    };
    events.sort((a, b) => {
      if (a.at < b.at) return -1;
      if (a.at > b.at) return 1;
      return (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9);
    });

    return {
      success: true,
      data: {
        roll: {
          id: roll.id,
          barcode: roll.barcode,
          status: roll.status,
          currentQty: roll.currentQty,
          initialQty: roll.initialQty,
          weightKg: roll.weightKg,
          item: roll.item,
          variant: roll.variant,
        },
        events,
      },
    };
  }

  /**
   * Soft-delete (Operatör İptali / Yanlış Giriş): topu CANCELLED'a çeker.
   * Bu fire (SCRAP) DEĞİL — sadece operatör kaydı geri alıyor. Gerçek fire
   * (kalite reddi vb.) için Tambur akışı SCRAP set eder.
   *
   * **İzin verilen statüler:** STOCK, IN_PRODUCTION, PRODUCED, READY_FOR_SHIP,
   * A1_STOCK, WAREHOUSE, RETURNED_FROM_SUBCONTRACTOR.
   *
   * **Blok:**
   * - SHIPPED — müşteride, geri alınamaz
   * - SCRAP / CANCELLED — zaten kapalı (idempotent başarı döner)
   * - AT_SUBCONTRACTOR — fasonda; önce mal kabul yapılmalı
   * - Açık bir SubcontractorDispatch'e bağlı top
   *
   * Yan etkiler:
   * - Açık RollMovement'lar kapatılır (qtyOut=0, not "CANCELLED")
   * - currentStepId temizlenir
   * - Etkilenen step'lerin status'u recompute edilir
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (
      existing.status === RollStatus.CANCELLED ||
      existing.status === RollStatus.SCRAP
    ) {
      return {
        success: true,
        data: existing,
        message: `Top zaten iptal/hurda: ${existing.barcode}`,
      };
    }
    if (existing.status === RollStatus.SHIPPED) {
      throw AppError.conflict(
        "Sevk edilmiş top iptal edilemez (müşteride)",
      );
    }
    if (existing.status === RollStatus.AT_SUBCONTRACTOR) {
      throw AppError.conflict(
        "Fasondaki top iptal edilemez — önce fason mal kabul yapın",
      );
    }

    // Açık fason sevkiyatına bağlı mı?
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: {
        rollId: id,
        dispatch: { cancelledAt: null },
      },
      select: { id: true, dispatchId: true },
    });
    if (openDispatch) {
      throw AppError.conflict(
        "Bu top açık bir fason sevkiyatına bağlı — önce sevki iptal et veya kabul yap",
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Açık RollMovement'ları topla — sonra status recompute için step ID'leri lazım
      const openMovements = await tx.rollMovement.findMany({
        where: { rollId: id, exitedAt: null },
        select: { id: true, workOrderStepId: true },
      });
      const affectedStepIds = new Set<string>();
      for (const m of openMovements) affectedStepIds.add(m.workOrderStepId);
      if (existing.currentStepId) affectedStepIds.add(existing.currentStepId);

      // Açık movement'ları kapat
      if (openMovements.length > 0) {
        await tx.rollMovement.updateMany({
          where: { rollId: id, exitedAt: null },
          data: {
            exitedAt: new Date(),
            qtyOut: 0,
            weightOut: 0,
            notes: "CANCELLED",
          },
        });
      }

      // Top: CANCELLED + currentStepId temizle
      const r = await tx.roll.update({
        where: { id },
        data: {
          status: RollStatus.CANCELLED,
          currentStepId: null,
        },
      });

      // Etkilenen step'lerin status'unu recompute et
      for (const stepId of affectedStepIds) {
        await recomputeStepStatus(tx, stepId);
      }

      return r;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: id,
      oldData: {
        status: existing.status,
        currentStepId: existing.currentStepId,
      },
      newData: {
        status: RollStatus.CANCELLED,
        cancelled: true,
      },
    });

    return {
      success: true,
      data: updated,
      message: `Top iptal edildi: ${existing.barcode}`,
    };
  }

  /**
   * Hard-delete: physically removes the roll from the database.
   * Only STOCK or SCRAP rolls can be deleted.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({
      where: { id },
      include: { errors: true, allocations: true, shipmentItems: true },
    });

    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (
      existing.status !== RollStatus.STOCK &&
      existing.status !== RollStatus.SCRAP &&
      existing.status !== RollStatus.CANCELLED
    ) {
      throw AppError.badRequest(
        "Sadece STOCK / SCRAP / CANCELLED durumundaki toplar kalıcı olarak silinebilir",
      );
    }

    await prisma.$transaction(async (tx) => {
      // Delete related records first
      await tx.rollError.deleteMany({ where: { rollId: id } });
      await tx.orderAllocation.deleteMany({ where: { rollId: id } });
      await tx.shipmentItem.deleteMany({ where: { rollId: id } });
      // Delete the roll
      await tx.roll.delete({ where: { id } });
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ROLL",
      recordId: id,
      oldData: {
        barcode: existing.barcode,
        status: existing.status,
        currentQty: existing.currentQty,
      },
      newData: null,
    });

    return {
      success: true,
      data: existing,
      message: `Top kalıcı olarak silindi: ${existing.barcode}`,
    };
  }

  /**
   * Manuel kimlik override (hibrit mod) — operatör fason kabul sonrası bir
   * rulonun rengini/özelliklerini elle düzeltebilir. Senaryolar:
   *   - Boyahane mavi vermesi gereken 10 ruloda 2'si yanmazlık tutmamış →
   *     o 2 ruloya yanmazlık atanmaz (manuel kaldır).
   *   - Bir rulo bonus olarak ekstra özellik kazandı → operatör manuel ekler.
   *
   * Replace semantics: gönderilen colorId + propertyIds yeni TAM listedir.
   * Mevcut Roll.itemId'sinden baseItemId türetilir; baz item korunur.
   */
  async applyManualProperties(
    rollId: string,
    data: { colorId: string | null; propertyIds: string[] },
    userId?: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, itemId: true, status: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status === RollStatus.SCRAP || roll.status === RollStatus.CANCELLED) {
      throw AppError.badRequest("Hurda/iptal edilmiş topun kimliği değiştirilemez");
    }

    // Catalog doğrulamaları (varsa)
    if (data.colorId) {
      const c = await prisma.color.findUnique({
        where: { id: data.colorId },
        select: { isActive: true },
      });
      if (!c || !c.isActive) {
        throw AppError.badRequest("Renk bulunamadı veya pasif");
      }
    }
    const dedupedProps = [...new Set(data.propertyIds)];
    if (dedupedProps.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedProps }, isActive: true },
        select: { id: true },
      });
      if (props.length !== dedupedProps.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await getItemDerivedAttributes(tx, roll.itemId);

      // 1) Renk değişikliği → Roll.itemId'yi farklı bir final Item'a (PATOS-MAVI
      //    → PATOS-KIRMIZI) taşı. Yeni renk için ürün tanımlı olmalı.
      let derived;
      try {
        derived = await findDerivedItemOrThrow(tx, {
          baseItemId: current.baseItemId,
          colorId: data.colorId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw AppError.badRequest(msg);
      }

      if (derived.itemId !== roll.itemId) {
        await tx.roll.update({
          where: { id: rollId },
          data: { itemId: derived.itemId },
        });
      }

      // 2) Roll.properties replace
      await tx.rollProperty.deleteMany({ where: { rollId } });
      if (dedupedProps.length > 0) {
        await tx.rollProperty.createMany({
          data: dedupedProps.map((propertyId) => ({ rollId, propertyId })),
        });
      }

      await tx.systemLog.create({
        data: {
          userId: userId ?? null,
          action: "UPDATE",
          tableName: "ROLL_ITEM_MANUAL_OVERRIDE",
          recordId: rollId,
          oldData: { itemId: roll.itemId, colorId: current.colorId } as Prisma.InputJsonValue,
          newData: {
            itemId: derived.itemId,
            itemCode: derived.itemCode,
            colorId: data.colorId,
            propertyIds: dedupedProps,
          } as Prisma.InputJsonValue,
        },
      });

      return derived;
    });

    return {
      success: true,
      data: {
        rollId,
        itemId: result.itemId,
        itemCode: result.itemCode,
        itemName: result.itemName,
        colorId: data.colorId,
        propertyIds: dedupedProps,
      },
      message: `Top kimliği güncellendi: ${result.itemName}`,
    };
  }
}
