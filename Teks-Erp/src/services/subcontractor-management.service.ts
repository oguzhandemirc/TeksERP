// =============================================================================
// TeksERP - Subcontractor Management Service
// =============================================================================
// Subcontractor (Fason firma) ve SubcontractorCategory CRUD.
// Sevk/Mal kabul işlemleri için subcontractor.service.ts'e bakın.
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

// =============================================================================
// SUBCONTRACTOR CATEGORY (Boyahane, Yıkama, Zımpara...)
// =============================================================================

export class SubcontractorCategoryService {
  async findAll(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const where = buildWhereClause(params.filters, ["code", "name"], params.search);
    const orderBy = buildOrderByClause(params.sortBy === "createdAt" ? "name" : params.sortBy, params.sortOrder === "desc" && params.sortBy === "createdAt" ? "asc" : params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.subcontractorCategory.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { _count: { select: { subcontractors: true, workOrderSteps: true } } },
      }),
      prisma.subcontractorCategory.count({ where }),
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

  async findById(id: string): Promise<ApiResponse<unknown>> {
    const cat = await prisma.subcontractorCategory.findUnique({
      where: { id },
      include: {
        subcontractors: {
          include: { subcontractor: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!cat) throw AppError.notFound("Kategori bulunamadı");
    return { success: true, data: cat };
  }

  async create(
    data: { code: string; name: string; description?: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const cat = await prisma.subcontractorCategory.create({ data });
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SUBCONTRACTOR_CATEGORY",
      recordId: cat.id,
      newData: { code: cat.code, name: cat.name },
    });
    return { success: true, data: cat, message: `Kategori oluşturuldu: ${cat.name}` };
  }

  async update(
    id: string,
    data: { code?: string; name?: string; description?: string | null; isActive?: boolean },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const cat = await prisma.subcontractorCategory.update({ where: { id }, data });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_CATEGORY",
      recordId: id,
      newData: data as Record<string, unknown>,
    });
    return { success: true, data: cat, message: "Kategori güncellendi" };
  }

  async remove(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    // Soft delete — bağlı subcontractor veya step varsa veriyi koruyoruz
    const cat = await prisma.subcontractorCategory.update({
      where: { id },
      data: { isActive: false },
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SUBCONTRACTOR_CATEGORY",
      recordId: id,
    });
    return { success: true, data: cat, message: "Kategori pasife alındı" };
  }
}

// =============================================================================
// SUBCONTRACTOR (Fason firma)
// =============================================================================

export class SubcontractorManagementService {
  async findAll(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);

    // Standart filtreler (isActive, code...) buildWhereClause halleder
    const where = buildWhereClause(params.filters, ["code", "name", "taxNumber"], params.search);

    // categoryId filter — relation üzerinden M:N filter
    const categoryId = params.filters["categoryId"] as string | undefined;
    if (categoryId) {
      (where as Record<string, unknown>).categories = {
        some: { categoryId },
      };
      delete (where as Record<string, unknown>).categoryId;
    }

    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.subcontractor.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          categories: { include: { category: true } },
        },
      }),
      prisma.subcontractor.count({ where }),
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

  async findById(id: string): Promise<ApiResponse<unknown>> {
    const sub = await prisma.subcontractor.findUnique({
      where: { id },
      include: {
        categories: { include: { category: true } },
      },
    });
    if (!sub) throw AppError.notFound("Fason firma bulunamadı");
    return { success: true, data: sub };
  }

  async create(
    data: {
      code: string;
      name: string;
      taxNumber?: string;
      phone?: string;
      address?: string;
      categoryIds?: string[];
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const { categoryIds = [], ...rest } = data;

    const sub = await prisma.$transaction(async (tx) => {
      const created = await tx.subcontractor.create({ data: rest });
      if (categoryIds.length > 0) {
        await tx.subcontractorToCategory.createMany({
          data: categoryIds.map((categoryId) => ({
            subcontractorId: created.id,
            categoryId,
          })),
        });
      }
      return tx.subcontractor.findUnique({
        where: { id: created.id },
        include: { categories: { include: { category: true } } },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SUBCONTRACTOR",
      recordId: sub!.id,
      newData: { code: sub!.code, name: sub!.name, categoryIds },
    });

    return { success: true, data: sub, message: `Fason firma oluşturuldu: ${sub!.name}` };
  }

  async update(
    id: string,
    data: {
      code?: string;
      name?: string;
      taxNumber?: string | null;
      phone?: string | null;
      address?: string | null;
      isActive?: boolean;
      categoryIds?: string[]; // verilirse mevcut kategoriler tamamen değişir
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const { categoryIds, ...rest } = data;

    const sub = await prisma.$transaction(async (tx) => {
      await tx.subcontractor.update({ where: { id }, data: rest });

      if (categoryIds !== undefined) {
        await tx.subcontractorToCategory.deleteMany({ where: { subcontractorId: id } });
        if (categoryIds.length > 0) {
          await tx.subcontractorToCategory.createMany({
            data: categoryIds.map((categoryId) => ({
              subcontractorId: id,
              categoryId,
            })),
          });
        }
      }

      return tx.subcontractor.findUnique({
        where: { id },
        include: { categories: { include: { category: true } } },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR",
      recordId: id,
      newData: data as Record<string, unknown>,
    });

    return { success: true, data: sub, message: "Fason firma güncellendi" };
  }

  async remove(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sub = await prisma.subcontractor.update({
      where: { id },
      data: { isActive: false },
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SUBCONTRACTOR",
      recordId: id,
    });
    return { success: true, data: sub, message: "Fason firma pasife alındı" };
  }
}
