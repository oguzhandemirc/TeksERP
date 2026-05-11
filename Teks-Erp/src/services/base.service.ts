// =============================================================================
// TeksERP - Base Service (Generic CRUD with Prisma)
// =============================================================================
// Provides reusable CRUD operations for any Prisma model.
// Master Data controllers (Item, Customer, Station, etc.) use this directly.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import { PaginatedResponse, ApiResponse } from "../types/api.types";
import { Request } from "express";

export interface CursorPaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    /** İstemci için yaklaşık toplam (count). Sayma maliyetli olabilir; opsiyonel. */
    totalEstimate?: number;
  };
}

// Prisma delegate type helper — allows us to call .findMany, .create etc. dynamically
type PrismaDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  findUnique: (args: Record<string, unknown>) => Promise<unknown | null>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<unknown>;
  count: (args: Record<string, unknown>) => Promise<number>;
};

export interface BaseServiceConfig {
  modelName: string; // Prisma model name (e.g., "item", "customer")
  tableName: string; // For SystemLog (e.g., "ITEM", "CUSTOMER")
  searchFields?: string[]; // Fields to search via ?search= param
  /** `?dateField=...&dateFrom=...&dateTo=...` için kabul edilen kolonlar. */
  dateFields?: readonly string[];
  defaultInclude?: Record<string, unknown>; // Default relations to include
  nestedCreateFields?: string[]; // Array fields to wrap in { create: [...] } for Prisma nested writes
}

export class BaseService {
  protected delegate: PrismaDelegate;
  protected config: BaseServiceConfig;

  constructor(config: BaseServiceConfig) {
    this.config = config;
    // Access the Prisma delegate dynamically: prisma["item"], prisma["customer"], etc.
    this.delegate = (prisma as unknown as Record<string, PrismaDelegate>)[config.modelName];

    if (!this.delegate) {
      throw new Error(`Prisma model '${config.modelName}' not found.`);
    }
  }

  /**
   * List with dynamic filtering, sorting, pagination, and search.
   *
   * İki modda çalışır (geri uyumlu):
   *   - **Offset mode** (default): `?page=1&pageSize=50` → eski sayfalama,
   *     küçük tablolar için uygun, sayfa atlatma destekler.
   *   - **Cursor mode**: `?cursor=<token>&limit=50` (veya `?mode=cursor`) →
   *     büyük tablolar için sabit hız, "Daha Fazla Yükle" pattern.
   *
   * İstemci cursor parametresi gönderirse otomatik cursor mode'a geçer.
   */
  async findAll(req: Request): Promise<PaginatedResponse<unknown> | CursorPaginatedResponse<unknown>> {
    if (isCursorRequested(req)) {
      return this.findAllCursor(req);
    }
    return this.findAllOffset(req);
  }

  protected async findAllOffset(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const where = buildWhereClause(
      params.filters,
      this.config.searchFields,
      params.search
    );
    applyDateRange(where, params, this.config.dateFields ?? []);
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy,
        skip,
        take,
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude }
          : {}),
      }),
      this.delegate.count({ where }),
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
   * Cursor pagination ile listele.
   * - Birincil sıralama: `params.sortBy` (default `createdAt`), `sortOrder` ile.
   *   Tie-breaker: `id` aynı yönde — sayfalar arası kararlı.
   * - filter[]/search aynı çalışır.
   * - count opsiyonel: `?withTotal=true` parametresiyle açılır (sayma maliyeti).
   * - Cursor token'ı sortBy değerini içerir; sortBy değişirse istemci cursor'ı
   *   sıfırlamalı (`useDataTable` zaten sortBy değişiminde refetch ediyor).
   */
  protected async findAllCursor(req: Request): Promise<CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const rawLimit = parseInt(req.query.limit as string, 10) || 50;
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const wantTotal = req.query.withTotal === "true";

    const sortBy = params.sortBy || "createdAt";
    const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";

    const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);

    const baseWhere = buildWhereClause(
      params.filters,
      this.config.searchFields,
      params.search
    );
    applyDateRange(baseWhere, params, this.config.dateFields ?? []);
    const where = cursor
      ? { AND: [baseWhere, dynamicCursorWhere(cursor, sortBy, sortOrder)] }
      : baseWhere;

    // limit + 1 çekiyoruz; fazla 1 varsa hasMore=true
    const [items, totalEstimate] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
        take: limit + 1,
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude }
          : {}),
      }),
      wantTotal ? this.delegate.count({ where: baseWhere }) : Promise.resolve(undefined),
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

  /**
   * Find single record by ID.
   */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const record = await this.delegate.findUnique({
      where: { id },
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    });

    if (!record) {
      return { success: false, data: null, message: "Kayıt bulunamadı" };
    }

    return { success: true, data: record };
  }

  /**
   * Create a new record.
   */
  async create(
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // Transform nested array fields to Prisma's { create: [...] } format
    const prismaData = { ...data };
    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        if (Array.isArray(prismaData[field])) {
          prismaData[field] = { create: prismaData[field] };
        }
      }
    }

    const record = await this.delegate.create({
      data: prismaData,
      ...(this.config.defaultInclude ? { include: this.config.defaultInclude } : {}),
    }) as Record<string, unknown>;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: record.id as string,
      newData: data,
    });

    return { success: true, data: record, message: "Kayıt oluşturuldu" };
  }

  /**
   * Update an existing record.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // Fetch old data for audit
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    const updated = await this.delegate.update({
      where: { id },
      data,
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: data,
    });

    return { success: true, data: updated, message: "Kayıt güncellendi" };
  }

  /**
   * Soft-delete: set isActive = false (no physical DELETE).
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    const updated = await this.delegate.update({
      where: { id },
      data: { isActive: false },
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude }
        : {}),
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: { isActive: false },
    });

    return { success: true, data: updated, message: "Kayıt pasife alındı" };
  }

  /**
   * Hard-delete: physically remove the record from the database.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const oldRecord = await this.delegate.findUnique({ where: { id } });

    if (!oldRecord) {
      return { success: false, data: null, message: "Kayıt bulunamadı" };
    }

    await this.delegate.delete({ where: { id } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as Record<string, unknown> | null,
      newData: null,
    });

    return { success: true, data: oldRecord, message: "Kayıt kalıcı olarak silindi" };
  }
}
