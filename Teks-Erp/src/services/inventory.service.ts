// =============================================================================
// TeksERP - Inventory Service
// =============================================================================
// Handles initial goods receipt (Ham Mal Girişi / QC1) and inventory queries.
// Business Rule: Rolls default to STOCK status. IN_PRODUCTION rolls
// are excluded from inventory queries unless explicitly filtered.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse, QueryParams } from "../types/api.types";
import { resolveQualityGradeId } from "./helpers/quality-grade.helper";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
  resolveSortBy,
} from "../utils/query-parser";

const ROLL_DATE_FIELDS = ["createdAt"] as const;
// Rolls listesinde sıralanabilir kolonlar (UI SortableHeader'larıyla eşleşir) +
// createdAt/id kararlı tie-break. Whitelist dışı sortBy → createdAt'e düşer
// (bilinmeyen kolon 500'ünü ve indekssiz keyfi sortu engeller).
const ROLL_SORTABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "barcode",
  "currentQty",
  "initialQty",
  "width",
  "qualityGrade",
  "status",
] as const;

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
  StationKind,
  StepStatus,
  WorkOrderStatus,
  ShipmentStatus,
} from "@prisma/client";
import {
  ensureWorkOrderInProgress,
  openMovementForNextStep,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";
import { copyStationCapabilitiesToRoll } from "./helpers/station-capability-transfer.helper";

export interface RollStats {
  totalCount: number;
  /** Filtreye uyan tüm rolların `currentQty` toplamı — metre. */
  totalQty: number;
  /** Filtreye uyan tüm rolların `weightKg` toplamı — kg (null'lar atlanır). */
  totalWeight: number;
  /** RollStatus → adet. Filtreye uyan status'ler için 0+ döner; eşleşmeyen status hiç yer almaz. */
  byStatus: Record<string, number>;
  /** qualityGrade kodu → adet (A1, FIRE, 1.KALITE, …). */
  byQuality: Record<string, number>;
}

export type RollHistoryEventKind =
  | "CREATED"
  | "MOVEMENT_IN"
  | "MOVEMENT_OUT"
  | "OPERATION"
  | "SUBCONTRACTOR_DISPATCH"
  | "SUBCONTRACTOR_RECEIPT";

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
    /// Açık kumaş Roll'larında NULL olabilir (etiket basılmaz).
    barcode: string | null;
    status: RollStatus;
    initialQty: number;
    currentQty: number;
    weightKg: number | null;
    item: { id: string; code: string; name: string; itemType: string } | null;
    color: { id: string; code: string; name: string; hex: string | null } | null;
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
   * Initial goods receipt — creates a new Roll in STOCK status.
   *
   * Fabrikaya gelen ham kumaş girişi: barkod + temel meta veri. Top hep STOCK'a
   * düşer; iş emrine bağlama daha sonra `attach-rolls` ile yapılır.
   */
  async createInitialEntry(
    data: {
      itemId: string;
      colorId?: string | null;
      initialQty: number;
      weightKg?: number;
      qualityGrade?: string;
      width?: number | null;  // En (cm) — opsiyonel, ölçülmediyse null
      propertyIds?: string[];
      /**
       * Opsiyonel client-üretimi barkod. Offline KK1 girişi için mobil tarafta
       * üretilir (generateBarcode ile aynı format: TEKS-YYYYMMDD-XXXXXXXX).
       * Verilmezse backend üretir (default davranış). Verilirse retry/dedup
       * doğal anchor olarak Roll.barcode @unique kullanılır — aynı barkodla
       * 2. çağrı cached Roll döner.
       */
      clientBarcode?: string;
    },
    userId?: string
  ): Promise<ApiResponse<Roll>> {
    // Verify item exists
    const item = await prisma.item.findUnique({ where: { id: data.itemId } });
    if (!item) {
      throw AppError.notFound("Ürün (Item) bulunamadı");
    }

    // Renk verilmişse: var ve aktif olmalı + Item'ın allowed listesindeyse listede
    if (data.colorId) {
      const color = await prisma.color.findUnique({
        where: { id: data.colorId },
        select: { id: true, isActive: true },
      });
      if (!color || !color.isActive) {
        throw AppError.notFound("Renk bulunamadı veya pasif");
      }
      const allowedCount = await prisma.itemAllowedColor.count({
        where: { itemId: data.itemId },
      });
      if (allowedCount > 0) {
        const inAllowed = await prisma.itemAllowedColor.findUnique({
          where: { itemId_colorId: { itemId: data.itemId, colorId: data.colorId } },
        });
        if (!inAllowed) {
          throw AppError.badRequest(
            "Seçilen renk bu ürüne uygulanabilir renk listesinde değil",
          );
        }
      }
    }

    // Özellikler: dedupe, var ve aktif olmalı + Item'ın allowed listesindeyse listede
    const dedupedProps = [...new Set(data.propertyIds ?? [])];
    if (dedupedProps.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedProps }, isActive: true },
        select: { id: true },
      });
      if (props.length !== dedupedProps.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
      const allowedPropCount = await prisma.itemAllowedProperty.count({
        where: { itemId: data.itemId },
      });
      if (allowedPropCount > 0) {
        const inAllowed = await prisma.itemAllowedProperty.findMany({
          where: { itemId: data.itemId, propertyId: { in: dedupedProps } },
          select: { propertyId: true },
        });
        if (inAllowed.length !== dedupedProps.length) {
          throw AppError.badRequest(
            "Seçilen özelliklerden biri bu ürüne uygulanabilir listesinde değil",
          );
        }
      }
    }

    // Barkod: client verdiyse onu kullan (offline retry idempotency), yoksa üret.
    // Client format validasyonu: TEKS-YYYYMMDD-XXXXXXXX (uppercase hex 8 char).
    if (data.clientBarcode && !/^TEKS-\d{8}-[0-9A-F]{8}$/.test(data.clientBarcode)) {
      throw AppError.badRequest(
        "Geçersiz client-üretimi barkod formatı (beklenen: TEKS-YYYYMMDD-XXXXXXXX)",
      );
    }
    const barcode = data.clientBarcode ?? generateBarcode();

    // Tüm item tipleri (fabric, yarn, consumable, vb) tedarikçiden gelir → SUPPLIER_RECEIPT.
    const entrySource: RollEntrySource = RollEntrySource.SUPPLIER_RECEIPT;

    const qualityGradeCode = data.qualityGrade ?? "1.KALITE";
    const qualityGradeId = await resolveQualityGradeId(qualityGradeCode);

    // Renkli manuel giriş = hazır/işlenmiş kumaş (dışarıdan boyalı/işlemli geldi),
    // doğrudan depoya gider. Renksiz giriş = ham kumaş, üretim akışına girecek
    // (STOCK'ta bekler, KK1/Kurşun/Tambur'da işlenir).
    const initialStatus =
      data.colorId != null ? RollStatus.WAREHOUSE : RollStatus.STOCK;

    let roll: Awaited<ReturnType<typeof prisma.roll.create>>;
    try {
      roll = await prisma.$transaction(async (tx) => {
        const created = await tx.roll.create({
          data: {
            barcode,
            itemId: data.itemId,
            colorId: data.colorId ?? null,
            initialQty: data.initialQty,
            currentQty: data.initialQty,
            weightKg: data.weightKg ?? null,
            status: initialStatus,
            qualityGrade: qualityGradeCode,
            qualityGradeId,
            width: data.width ?? null,
            entrySource,
            createdById: userId ?? null,
          },
          include: {
            item: true,
            color: true,
            createdBy: { select: { id: true, username: true, fullName: true } },
          },
        });
        if (dedupedProps.length > 0) {
          await tx.rollProperty.createMany({
            data: dedupedProps.map((propertyId) => ({ rollId: created.id, propertyId })),
          });
        }
        return created;
      });
    } catch (err) {
      // Offline retry idempotency: aynı clientBarcode ile 2. çağrı geldi.
      // Roll.barcode @unique → P2002 → mevcut Roll'u dön (audit log atılmaz,
      // ilk çağrıda zaten yazılmış).
      if (
        data.clientBarcode &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.roll.findUnique({
          where: { barcode },
          include: {
            item: true,
            color: true,
            createdBy: { select: { id: true, username: true, fullName: true } },
          },
        });
        if (existing) {
          return {
            success: true,
            data: existing,
            message: `Top zaten kayıtlı (idempotent retry). Barkod: ${existing.barcode}`,
          };
        }
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        barcode: roll.barcode,
        itemId: roll.itemId,
        colorId: roll.colorId,
        initialQty: roll.initialQty,
        currentQty: roll.currentQty,
        weightKg: roll.weightKg,
        status: roll.status,
        entrySource: roll.entrySource,
        propertyIds: dedupedProps,
      },
    });

    return {
      success: true,
      data: roll,
      message: `Top oluşturuldu. Barkod: ${roll.barcode}`,
    };
  }

  /**
   * Roll listesi + istatistiklerin paylaştığı tek filtre kaynağı.
   * findAllRolls (liste) ve getRollStats (özet) bu metodu çağırır —
   * filtre eşleşmediğinde istatistik listeden sapar.
   */
  private buildRollWhere(params: QueryParams): Record<string, unknown> {
    const f = params.filters;

    // Base where: buildWhereClause sadece düz Roll alanları için. Nested ilişki
    // filtreleri (item.isDerived, item.colorId, item.properties...) ve range
    // alanları (width, currentQty) aşağıda explicit compose ediliyor — generic
    // helper'a relation bilgisi sızdırmamak için.
    // Search'i `buildWhereClause`'a vermiyoruz; ruloyu sadece barkoda göre değil,
    // bağlı kumaş adı/kodu üzerinden de aramak için OR'u explicit kuruyoruz.
    const where = buildWhereClause(f, ["barcode"]);
    applyDateRange(where, params, ROLL_DATE_FIELDS);

    const search = params.search?.trim();
    if (search) {
      // Barkod: TAM eşleşme (unique index seek). `contains`/`startsWith` ILIKE
      // en_US.UTF-8 collation'da barcode unique indeksini KULLANAMAZ — 300k satırda
      // ölçüldü: contains ~21-87ms (seq scan), equals ~0.3ms (index scan). Barkod
      // okutulur/yapıştırılır (tam değer); ortasından substring araması gerçek bir
      // saha akışı değil. Ürün adı/kodu küçük master tabloda kaldığı için contains
      // olarak kalır → "patos" gibi fuzzy ürün araması bozulmadan çalışır.
      where.OR = [
        { barcode: search },
        { item: { name: { contains: search, mode: "insensitive" } } },
        { item: { code: { contains: search, mode: "insensitive" } } },
      ];
    }

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

    // --- Roll-level renk + processingStatus filtreleri ---
    const colorIdFilter = typeof f["colorId"] === "string" ? f["colorId"] : null;
    delete where.colorId;
    if (colorIdFilter) {
      where.colorId = colorIdFilter;
    }

    const processingStatus = f["processingStatus"] as string | undefined;
    delete where.processingStatus;
    if (processingStatus === "raw") {
      where.colorId = null;
    } else if (processingStatus === "processed") {
      where.colorId = { not: null };
      where.status = {
        notIn: [
          RollStatus.WAREHOUSE,
          RollStatus.TAMBUR_CONSUMED,
          RollStatus.SUBCONTRACTOR_CONSUMED,
          RollStatus.SCRAP,
        ],
      };
    } else if (processingStatus === "open_fabric") {
      where.barcode = null;
      where.status = RollStatus.IN_PRODUCTION;
    } else if (processingStatus === "finished") {
      where.status = RollStatus.WAREHOUSE;
    }

    const qualityGradeFilter =
      typeof f["qualityGrade"] === "string" ? (f["qualityGrade"] as string) : null;
    delete where.qualityGrade;
    const includeFireRaw = f["includeFire"];
    const includeFire = includeFireRaw === "true";
    delete where.includeFire;
    if (qualityGradeFilter) {
      where.qualityGrade = qualityGradeFilter;
    } else if (!includeFire) {
      where.qualityGrade = { not: "FIRE" };
    }

    const rollKind = f["rollKind"] as string | undefined;
    delete where.rollKind;
    if (rollKind === "OPEN_FABRIC") {
      where.barcode = null;
    } else if (rollKind === "WOUND_ROLL") {
      where.barcode = { not: null };
    }

    const currentStepKindRaw = f["currentStepKind"] as string | undefined;
    delete where.currentStepKind;
    if (
      currentStepKindRaw &&
      Object.values(StationKind).includes(currentStepKindRaw as StationKind)
    ) {
      where.currentStep = {
        is: { station: { kind: currentStepKindRaw as StationKind } },
      };
    }

    const rollScope = f["rollScope"] as string | undefined;
    delete where.rollScope;
    if (rollScope === "RAW_STOCK") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: null },
        { status: RollStatus.STOCK },
      ];
    } else if (rollScope === "PRODUCTION_ACTIVE") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: { not: null } },
        {
          status: {
            notIn: [
              RollStatus.WAREHOUSE,
              RollStatus.A1_STOCK,
              RollStatus.SCRAP,
              RollStatus.CANCELLED,
              RollStatus.TAMBUR_CONSUMED,
              RollStatus.SUBCONTRACTOR_CONSUMED,
              RollStatus.RETURNED_FROM_SUBCONTRACTOR,
            ],
          },
        },
      ];
    } else if (rollScope === "FINISHED_STOCK") {
      where.status = {
        in: [RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.PRODUCED],
      };
    }

    const itemId = typeof f["itemId"] === "string" ? f["itemId"] : null;
    delete where.itemId;
    if (itemId) {
      where.itemId = itemId;
    }

    const propertyIds = readList(f["propertyIds"]);
    delete where.propertyIds;
    if (propertyIds.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        ...propertyIds.map((pid) => ({
          properties: { some: { propertyId: pid } },
        })),
      ];
    }

    delete where.widthMin;
    delete where.widthMax;
    const widthRange = readNumberRange(f["widthMin"], f["widthMax"]);
    if (widthRange) where.width = widthRange;

    delete where.qtyMin;
    delete where.qtyMax;
    const qtyRange = readNumberRange(f["qtyMin"], f["qtyMax"]);
    if (qtyRange) where.currentQty = qtyRange;

    return where;
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
    // sortBy güvenlik süzgeci — bilinmeyen kolon (500) + indekssiz keyfi sort engellenir.
    params.sortBy = resolveSortBy(params.sortBy, ROLL_SORTABLE_FIELDS);
    const where = this.buildRollWhere(params);

    const include = {
      item: { select: { id: true, code: true, name: true, itemType: true, unit: true } },
      color: { select: { id: true, code: true, name: true, hex: true } },
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
   * Roll özet istatistikleri — listenin SAYFAYA bağlı toplamlarını değil,
   * filtreye uyan TÜM rolların aggregate'ini döner. Depo/dashboard kartlarının
   * "Toplam metre / Toplam kg / Statü dağılımı / Kalite dağılımı" gibi
   * panelleri için. Filtre seti findAllRolls ile aynı (buildRollWhere paylaşılır).
   */
  async getRollStats(req: Request): Promise<ApiResponse<RollStats>> {
    const params = parseQueryParams(req);
    const where = this.buildRollWhere(params) as Prisma.RollWhereInput;

    const [aggregate, byStatusRaw, byQualityRaw] = await Promise.all([
      prisma.roll.aggregate({
        where,
        _count: { _all: true },
        _sum: { currentQty: true, weightKg: true },
      }),
      prisma.roll.groupBy({
        where,
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.roll.groupBy({
        where,
        by: ["qualityGrade"],
        _count: { _all: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of byStatusRaw) byStatus[row.status] = row._count._all;

    const byQuality: Record<string, number> = {};
    for (const row of byQualityRaw) byQuality[row.qualityGrade] = row._count._all;

    return {
      success: true,
      data: {
        totalCount: aggregate._count._all,
        totalQty: Number(aggregate._sum.currentQty ?? 0),
        totalWeight: Number(aggregate._sum.weightKg ?? 0),
        byStatus,
        byQuality,
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
        item: true,
        color: true,
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
        // En güncel iade kaydı (iade gelmiş depo topu için not/neden).
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
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
        color: true,
        errors: true,
        // En güncel iade kaydı — Tambur/depo barkod okutmada iade notu/nedeni görünür.
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
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
   * subcontractor dispatches/receipts — merged into one chronological timeline.
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
        color: { select: { id: true, code: true, name: true, hex: true } },
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

    const [movements, operations, dispatchItems, receiptItems] =
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
      ]);

    const events: RollHistoryEvent[] = [];

    // Top'un sisteme nasıl girdiğine göre başlık — itemType'tan değil entrySource'tan türer.
    const entryTitle = ((): string => {
      switch (roll.entrySource) {
        case RollEntrySource.TAMBUR_SPLIT:
          return "Tambur Kesimi (Yeni Parça)";
        case RollEntrySource.SUPPLIER_RECEIPT:
        default:
          return "Ham Giriş";
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
      CREATED: 5,
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
          currentQty: Number(roll.currentQty),
          initialQty: Number(roll.initialQty),
          weightKg: roll.weightKg !== null ? Number(roll.weightKg) : null,
          item: roll.item,
          color: roll.color,
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
   * **İzin verilen statüler:** STOCK, IN_PRODUCTION, PRODUCED,
   * A1_STOCK, WAREHOUSE, RETURNED_FROM_SUBCONTRACTOR.
   *
   * **Blok:**
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

    // Aktif (PREPARING/READY) bir sevkiyata bağlı mı? Bağlıysa iptal edilemez —
    // önce sevkten/çuvaldan çıkarılmalı. Aksi halde iptal edilen top sevkiyatta
    // kalır, sevk çıkışında (dispatch) SHIPPED'a "diriltilir" ve karşılanmaya
    // yanlış sayılır.
    if (existing.shipmentId) {
      const ship = await prisma.shipment.findUnique({
        where: { id: existing.shipmentId },
        select: { status: true, shipmentNo: true },
      });
      if (
        ship &&
        (ship.status === ShipmentStatus.PREPARING ||
          ship.status === ShipmentStatus.READY)
      ) {
        throw AppError.conflict(
          `Bu top hazırlanan/bekleyen bir sevkiyatta (${ship.shipmentNo}) — önce sevkten çıkarın.`,
        );
      }
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
   * Arşivle: STOCK durumundaki bir topu CANCELLED'a çeker. RollError ve
   * RollMovement / RollOperation kayıtları KORUNUR — izlenebilirlik ve
   * audit için. Zaten SCRAP veya CANCELLED ise idempotent (no-op).
   *
   * NOT: Eski "hardDelete" davranışı (fiziksel DELETE + RollError purge)
   * kaldırıldı — CLAUDE.md'deki "asla fiziksel DELETE" kuralı gereği.
   * Method adı route uyumluluğu için korundu; semantik = soft archive.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({ where: { id } });

    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (
      existing.status !== RollStatus.STOCK &&
      existing.status !== RollStatus.SCRAP &&
      existing.status !== RollStatus.CANCELLED
    ) {
      throw AppError.badRequest(
        "Sadece STOCK / SCRAP / CANCELLED durumundaki toplar arşivlenebilir",
      );
    }

    // Zaten arşivli — idempotent
    if (
      existing.status === RollStatus.SCRAP ||
      existing.status === RollStatus.CANCELLED
    ) {
      return {
        success: true,
        data: existing,
        message: `Top zaten arşivli: ${existing.barcode}`,
      };
    }

    // STOCK → CANCELLED. RollError ve diğer geçmiş kayıtları aynen kalır.
    const updated = await prisma.roll.update({
      where: { id },
      data: { status: RollStatus.CANCELLED },
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
      newData: { status: RollStatus.CANCELLED, event: "ARCHIVED" },
    });

    return {
      success: true,
      data: updated,
      message: `Top arşivlendi: ${existing.barcode}`,
    };
  }

  /**
   * Manuel renk + özellik override — operatör fason kabul sonrası bir rulonun
   * rengini/özelliklerini elle düzeltebilir. Senaryolar:
   *   - Boyahane mavi vermesi gereken 10 ruloda 2'si yanmazlık tutmamış →
   *     o 2 ruloya yanmazlık atanmaz (manuel kaldır).
   *   - Bir rulo bonus olarak ekstra özellik kazandı → operatör manuel ekler.
   *
   * Replace semantics: gönderilen colorId + propertyIds yeni TAM listedir.
   * Item DEĞİŞMEZ (artık ürün kimliği renk içermiyor).
   */
  async applyManualProperties(
    rollId: string,
    data: { colorId: string | null; propertyIds: string[] },
    userId?: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, itemId: true, colorId: true, status: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status === RollStatus.SCRAP || roll.status === RollStatus.CANCELLED) {
      throw AppError.badRequest("Hurda/iptal edilmiş topun rengi/özelliği değiştirilemez");
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
      // Item allowed list (boş → serbest)
      const allowedCount = await prisma.itemAllowedColor.count({
        where: { itemId: roll.itemId },
      });
      if (allowedCount > 0) {
        const inAllowed = await prisma.itemAllowedColor.findUnique({
          where: { itemId_colorId: { itemId: roll.itemId, colorId: data.colorId } },
        });
        if (!inAllowed) {
          throw AppError.badRequest(
            "Seçilen renk bu ürüne uygulanabilir renk listesinde değil",
          );
        }
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

    await prisma.$transaction(async (tx) => {
      // 1) Roll.colorId güncelle
      if (roll.colorId !== data.colorId) {
        await tx.roll.update({
          where: { id: rollId },
          data: { colorId: data.colorId },
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
          tableName: "ROLL_MANUAL_OVERRIDE",
          recordId: rollId,
          oldData: { colorId: roll.colorId } as Prisma.InputJsonValue,
          newData: {
            colorId: data.colorId,
            propertyIds: dedupedProps,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return {
      success: true,
      data: {
        rollId,
        colorId: data.colorId,
        propertyIds: dedupedProps,
      },
      message: `Top rengi/özellikleri güncellendi`,
    };
  }

  // ===========================================================================
  // OPEN FABRIC — Kurşun/KK2'de açık kumaş Roll oluştur
  // ===========================================================================
  //
  // Senaryo: Boyahaneden açık kumaş döndü; SubcontractorReceipt oluşturuldu;
  // orijinal Roll'lar SUBCONTRACTOR_CONSUMED'a çekildi. Şimdi Kurşun/KK2
  // operatörü "yeni kumaş aç" der → bu endpoint çağrılır.
  //
  // Yeni Roll:
  //   - barcode: NULL (etiket basılmaz, fiziksel takip arabada)
  //   - colorId / properties: receipt'ten inherit
  //   - itemId: WO.targetItemId
  //   - currentStepId / producedInStepId: Kurşun/KK2 step (PROCESS_QC)
  //   - parentReceiptId: kaynak receipt referansı (lineage)
  //   - initialQty / currentQty: 0 (ölçüm kursun-finish'te yapılır)
  //
  async createOpenFabric(
    data: {
      receiptId: string;
      stepId: string; // Kurşun/KK2 (PROCESS_QC) step
      notes?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: data.receiptId },
      include: {
        appliedProperties: { select: { propertyId: true } },
        workOrder: {
          select: { id: true, status: true, targetItemId: true },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    if (receipt.cancelledAt) {
      throw AppError.badRequest("İptal edilmiş mal kabul üzerinden yeni kumaş açılamaz");
    }
    if (receipt.workOrder.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict("İş emri tamamlanmış");
    }
    if (!receipt.workOrder.targetItemId) {
      throw AppError.badRequest("İş emrinde hedef ürün (targetItem) tanımlı değil");
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: { select: { kind: true } },
      },
    });
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.workOrderId !== receipt.workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
    }
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest(
        "Açık kumaş Roll sadece PROCESS_QC (Kurşun/KK2) istasyonunda açılabilir",
      );
    }
    if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
      throw AppError.conflict(
        `Adım kapalı (${step.status}) — açık kumaş açılamaz`,
      );
    }

    const propertyIds = receipt.appliedProperties.map((p) => p.propertyId);
    const defaultQualityGradeId = await resolveQualityGradeId("1.KALITE");

    const roll = await prisma.$transaction(async (tx) => {
      const created = await tx.roll.create({
        data: {
          barcode: null,
          itemId: receipt.workOrder.targetItemId!,
          colorId: receipt.appliedColorId,
          initialQty: 0,
          currentQty: 0,
          status: RollStatus.IN_PRODUCTION,
          qualityGrade: "1.KALITE",
          qualityGradeId: defaultQualityGradeId,
          entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
          createdById: userId ?? null,
          currentStepId: step.id,
          producedInStepId: step.id,
          parentReceiptId: receipt.id,
        },
      });

      if (propertyIds.length > 0) {
        await tx.rollProperty.createMany({
          data: propertyIds.map((propertyId) => ({
            rollId: created.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // Kurşun/KK2 step'ine "girdi" — açık movement (ölçüm yok henüz; kursun-finish kapatır).
      await tx.rollMovement.create({
        data: {
          rollId: created.id,
          workOrderStepId: step.id,
          qtyIn: 0, // henüz ölçülmedi (Roll.initialQty = 0); kursun-finish'te qtyOut measured yazılır
          weightIn: null,
          operatorId: userId ?? null,
          notes: data.notes ?? `OPEN_FABRIC_FROM_RECEIPT:${receipt.receiptNo}`,
        },
      });

      await recomputeStepStatus(tx, step.id);
      await ensureWorkOrderInProgress(tx, receipt.workOrderId);

      return created;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        rollKind: "OPEN_FABRIC",
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        workOrderId: receipt.workOrderId,
        stepId: step.id,
        appliedColorId: receipt.appliedColorId,
        appliedPropertyIds: propertyIds,
      },
    });

    return {
      success: true,
      data: roll,
      message: `Açık kumaş Roll oluşturuldu (id: ${roll.id}). Kurşun/KK2 sonrası kursun-finish endpoint'i ile metraj + hata girilir.`,
    };
  }

  // ===========================================================================
  // KURSUN-FINISH — Kurşun/KK2 sonu: metraj + hata + Tambur'a ilerlet
  // ===========================================================================
  //
  // Açık kumaş Roll'unun ölçümü tamamlanır:
  //   - currentQty / initialQty = totalMeters (cihazda gözüken)
  //   - RollError'lar toplu insert (sadece startMeter zorunlu)
  //   - RollOperation: QC2_COMPLETED her zaman, KURSUN_APPLIED istasyonun
  //     KURSUN yeteneği varsa
  //   - İstasyonun propertyCapabilities listesi Roll'a RollProperty olarak kopyalanır
  //   - Kurşun/KK2 movement'ı kapatılır (qtyOut=totalMeters, exitedAt=now)
  //   - Sonraki step (Tambur) için RollMovement açılır + Roll.currentStepId güncellenir
  //
  async kursunFinish(
    rollId: string,
    data: {
      /**
       * Opsiyonel. Yeni model: açık kumaş Roll fason kabulden zaten metrajlı
       * doğar (irsaliye değeri). KK2'de ölçüm yapılmadığı için `totalMeters`
       * verilmezse mevcut `currentQty` kullanılır. Boya'da fire/çekme varsa
       * operatör bunu manuel girebilir.
       */
      totalMeters?: number;
      /**
       * Opsiyonel batch hata kaydı. Yeni akışta operatör hataları KK2 ekranında
       * "Hata Ekle" ile tek tek girer (reportError endpoint'i); burası genelde
       * boş gönderilir. Verilirse RollError olarak eklenir.
       */
      errors?: Array<{
        startMeter: number;
        defectTypeId?: string | null;
      }>;
      notes?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; totalMeters: number; nextStepId: string | null }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        currentStep: {
          include: {
            station: { select: { kind: true } },
            workOrder: {
              include: {
                steps: {
                  orderBy: { stepSequence: "asc" },
                  select: { id: true, stepSequence: true, status: true },
                },
              },
            },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.barcode) {
      throw AppError.badRequest(
        "Bu Roll açık kumaş değil (barkodlu top); kursun-finish sadece açık kumaş Roll'larında çağrılır",
      );
    }
    // Idempotency: aynı çağrı offline sync replay'inde 2. kez gelirse roll
    // PROCESS_QC'yi çoktan bırakmış olur. Geçmiş bir PROCESS_QC step'inde
    // QC2_COMPLETED RollOperation'ı varsa "zaten yapıldı" diye success dön
    // (duplicate movement/RollError yaratma riski yok — bu noktada zaten
    // ileri taşınmış).
    if (
      !roll.currentStep ||
      roll.currentStep.station.kind !== StationKind.PROCESS_QC
    ) {
      const priorFinish = await prisma.rollOperation.findFirst({
        where: {
          rollId,
          operationType: RollOperationType.QC2_COMPLETED,
          step: { station: { kind: StationKind.PROCESS_QC } },
        },
        select: { id: true, workOrderStepId: true },
      });
      if (priorFinish) {
        return {
          success: true,
          data: {
            rollId,
            totalMeters: Number(roll.currentQty),
            nextStepId: roll.currentStepId,
          },
          message:
            "Roll PROCESS_QC adımını zaten bitirmiş (idempotent retry).",
        };
      }
      if (!roll.currentStep) {
        throw AppError.badRequest("Roll bir step'te değil");
      }
      throw AppError.badRequest(
        `Roll PROCESS_QC step'inde değil (mevcut: ${roll.currentStep.station.kind})`,
      );
    }

    // totalMeters opsiyonel — verilmezse mevcut currentQty (fason kabulden gelen
    // irsaliye değeri) kullanılır. Verilirse pozitif olmalı.
    if (data.totalMeters !== undefined && !(data.totalMeters > 0)) {
      throw AppError.badRequest("Toplam metraj pozitif olmalı");
    }
    const totalMeters = data.totalMeters ?? Number(roll.currentQty);
    if (totalMeters <= 0) {
      throw AppError.badRequest(
        "Roll metrajı sıfır — fason kabulde açık kumaş metresi girilmedi mi?",
      );
    }

    // Hata validasyonu — sadece nokta (startMeter)
    const errors = data.errors ?? [];
    for (const e of errors) {
      if (e.startMeter < 0 || e.startMeter > totalMeters) {
        throw AppError.badRequest(
          `Hata metresi (${e.startMeter}) 0 ile ${totalMeters} arasında olmalı`,
        );
      }
    }

    // DefectType doğrulamaları (varsa)
    const defectIds = [...new Set(errors.map((e) => e.defectTypeId).filter((x): x is string => !!x))];
    if (defectIds.length > 0) {
      const found = await prisma.defectType.findMany({
        where: { id: { in: defectIds } },
        select: { id: true, name: true },
      });
      if (found.length !== defectIds.length) {
        throw AppError.badRequest("Bazı hata tipleri bulunamadı");
      }
    }
    const defectMap = new Map<string, string>();
    if (defectIds.length > 0) {
      const found = await prisma.defectType.findMany({
        where: { id: { in: defectIds } },
        select: { id: true, name: true },
      });
      for (const d of found) defectMap.set(d.id, d.name);
    }

    const allSteps = roll.currentStep.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === roll.currentStepId);
    const nextStep = currentIndex < allSteps.length - 1 ? allSteps[currentIndex + 1] : null;

    const stepId = roll.currentStep.id;
    const stationId = roll.currentStep.stationId;
    const woId = roll.currentStep.workOrderId;

    // Kurşun yeteneği per-station: istasyona KURSUN özelliği atanmışsa
    // KURSUN_APPLIED log'u atılır + RollProperty(KURSUN) otomatik kazanılır.
    const hasKursunCap = await prisma.stationProperty.findFirst({
      where: { stationId, property: { code: "KURSUN" } },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      // 1) Roll metraj güncelle
      await tx.roll.update({
        where: { id: rollId },
        data: {
          initialQty: totalMeters,
          currentQty: totalMeters,
        },
      });

      // 2) RollError'lar toplu insert
      if (errors.length > 0) {
        await tx.rollError.createMany({
          data: errors.map((e) => ({
            rollId,
            startMeter: e.startMeter,
            defectTypeId: e.defectTypeId ?? null,
            errorType: e.defectTypeId ? defectMap.get(e.defectTypeId) ?? null : null,
            detectedAtStepId: stepId,
            detectedByUserId: userId ?? null,
          })),
        });
      }

      // 3) RollOperation: QC2_COMPLETED (her zaman) + KURSUN_APPLIED (istasyonda
      //    KURSUN özelliği yetenek olarak atanmışsa). Eskiden ikisi de koşulsuzdu;
      //    per-roll Kurşun toggle'ı kaldırıldı, kurşun artık istasyon yeteneği.
      const ops: Prisma.RollOperationCreateManyInput[] = [
        {
          rollId,
          workOrderStepId: stepId,
          operationType: RollOperationType.QC2_COMPLETED,
          operatorId: userId ?? null,
          metadata: {
            totalMeters: totalMeters,
            errorCount: errors.length,
            notes: data.notes ?? null,
          } as Prisma.InputJsonValue,
        },
      ];
      if (hasKursunCap) {
        ops.push({
          rollId,
          workOrderStepId: stepId,
          operationType: RollOperationType.KURSUN_APPLIED,
          operatorId: userId ?? null,
          metadata: { totalMeters: totalMeters } as Prisma.InputJsonValue,
        });
      }
      await tx.rollOperation.createMany({ data: ops, skipDuplicates: true });

      // 3b) İstasyon yetenekleri (propertyCapabilities) Roll'a kopyalanır.
      await copyStationCapabilitiesToRoll(tx, { stationId, rollId });

      // 4) Kurşun/KK2 movement'ı kapat (qtyOut = ölçülen toplam metre)
      await tx.rollMovement.updateMany({
        where: {
          rollId,
          workOrderStepId: stepId,
          exitedAt: null,
        },
        data: {
          qtyOut: totalMeters,
          exitedAt: new Date(),
        },
      });

      // 5) Sonraki step (Tambur) için movement aç + Roll.currentStepId.
      // Status IN_PRODUCTION — Tambur cutOpenFabric bunu zorunlu kılar.
      if (nextStep) {
        await openMovementForNextStep(tx, {
          rollId,
          nextStepId: nextStep.id,
          qty: totalMeters,
          weight: null,
          userId: userId ?? null,
          notes: `KURSUN_FINISHED:${stepId}`,
          rollStatus: RollStatus.IN_PRODUCTION,
        });
      } else {
        // Sonraki step yok — son step'ten çıkış. Açık kumaşın Tambur'a girmesi
        // beklenir, son step PROCESS_QC ise sistem hatası — yine de Roll'u
        // PRODUCED'a çek ve currentStepId=null yap.
        await tx.roll.update({
          where: { id: rollId },
          data: {
            status: RollStatus.PRODUCED,
            currentStepId: null,
          },
        });
      }

      await recomputeStepStatus(tx, stepId);
      await ensureWorkOrderInProgress(tx, woId);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: {
        kursunFinished: true,
        totalMeters: totalMeters,
        errorCount: errors.length,
        nextStepId: nextStep?.id ?? null,
      },
    });

    return {
      success: true,
      data: {
        rollId,
        totalMeters: totalMeters,
        nextStepId: nextStep?.id ?? null,
      },
      message: nextStep
        ? `Kurşun/KK2 tamamlandı (${totalMeters} mt). Roll Tambur step'ine ilerletildi.`
        : `Kurşun/KK2 tamamlandı (${totalMeters} mt). Sonraki step yok — Roll PRODUCED.`,
    };
  }
}
