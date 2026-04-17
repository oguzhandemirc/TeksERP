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
} from "../utils/query-parser";
import { PaginatedResponse, ApiResponse } from "../types/api.types";
import { Request } from "express";

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
   */
  async findAll(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const where = buildWhereClause(
      params.filters,
      this.config.searchFields,
      params.search
    );
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
