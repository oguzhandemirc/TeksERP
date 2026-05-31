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
import { validateName, validateCode } from "../lib/string-validators";
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
    data: {
      code: string;
      name: string;
      description?: string;
      appliesColor?: boolean;
      appliesProperty?: boolean;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const existing = await prisma.subcontractorCategory.findFirst({
      where: { code: data.code },
    });
    if (existing?.isActive) {
      throw AppError.badRequest("Bu kod ile aktif kategori zaten var");
    }

    const cat = existing
      ? await prisma.subcontractorCategory.update({
          where: { id: existing.id },
          data: { ...data, isActive: true },
        })
      : await prisma.subcontractorCategory.create({ data });

    await AuditService.log({
      userId,
      action: existing ? "UPDATE" : "CREATE",
      tableName: "SUBCONTRACTOR_CATEGORY",
      recordId: cat.id,
      newData: {
        code: cat.code,
        name: cat.name,
        appliesColor: cat.appliesColor,
        appliesProperty: cat.appliesProperty,
        ...(existing ? { reactivated: true } : {}),
      },
    });
    return {
      success: true,
      data: cat,
      message: existing
        ? `Pasif kategori yeniden aktive edildi: ${cat.name}`
        : `Kategori oluşturuldu: ${cat.name}`,
    };
  }

  async update(
    id: string,
    data: {
      code?: string;
      name?: string;
      description?: string | null;
      isActive?: boolean;
      appliesColor?: boolean;
      appliesProperty?: boolean;
    },
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

/**
 * Subcontractor giriş alanları için format kontrolleri.
 * `taxNumber` regex'i `CustomerService` ile aynı (10-15 hane sayı; VKN/TCKN/
 * yabancı VAT). `phone` ve `address` için minimum gerçeklik kontrolü —
 * seed verisinde `phone:"1", address:"1"` gibi çöp değerler vardı.
 *
 * Helper'lar saf fonksiyon: hem create hem update'ten çağrılıyor. Üçü de
 * `null`'a izin verir (alan optional, schema `String?`).
 */
const SUB_TAX_REGEX = /^\d{10,15}$/;
const SUB_PHONE_REGEX = /^[+0-9 ()/-]{7,20}$/;
const SUB_ADDRESS_MIN_LENGTH = 5;

function normalizeAndValidateTaxNumber(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest("Vergi numarası metin olmalı");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!SUB_TAX_REGEX.test(trimmed)) {
    throw AppError.badRequest(
      "Vergi numarası 10-15 hane sayı olmalı (VKN: 10, TCKN: 11)"
    );
  }
  return trimmed;
}

function normalizeAndValidatePhone(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest("Telefon metin olmalı");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!SUB_PHONE_REGEX.test(trimmed)) {
    throw AppError.badRequest(
      "Telefon 7-20 karakter olmalı (sayılar, +, boşluk, parantez, tire, eğik çizgi)"
    );
  }
  return trimmed;
}

function normalizeAndValidateAddress(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw AppError.badRequest("Adres metin olmalı");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length < SUB_ADDRESS_MIN_LENGTH) {
    throw AppError.badRequest(
      `Adres en az ${SUB_ADDRESS_MIN_LENGTH} karakter olmalı`
    );
  }
  return trimmed;
}

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
      taxNumber?: string | null;
      phone?: string | null;
      address?: string | null;
      isFavorite?: boolean;
      categoryIds?: string[];
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const { categoryIds = [], ...rest } = data;
    const payload: {
      code: string;
      name: string;
      taxNumber?: string | null;
      phone?: string | null;
      address?: string | null;
      isFavorite?: boolean;
    } = { code: rest.code, name: rest.name };

    // Required + length kontrolleri (paylaşımlı validator)
    const code = validateCode(rest.code, { label: "Fason kodu", required: true });
    if (typeof code === "string") payload.code = code;
    const name = validateName(rest.name, { label: "Fason adı", required: true });
    if (typeof name === "string") payload.name = name;

    // Format validasyonları — create'te tüm 3 alan optional, ama verilirse
    // format şartı uygulanır. Boş/null gelirse null'a normalize edilir.
    const tax = normalizeAndValidateTaxNumber(rest.taxNumber);
    if (tax !== undefined) payload.taxNumber = tax;
    const phone = normalizeAndValidatePhone(rest.phone);
    if (phone !== undefined) payload.phone = phone;
    const address = normalizeAndValidateAddress(rest.address);
    if (address !== undefined) payload.address = address;
    if (typeof rest.isFavorite === "boolean") payload.isFavorite = rest.isFavorite;

    const existing = await prisma.subcontractor.findFirst({
      where: { code: payload.code },
      select: { id: true, isActive: true },
    });
    if (existing?.isActive) {
      throw AppError.badRequest("Bu kod ile aktif fason firma zaten var");
    }

    const sub = await prisma.$transaction(async (tx) => {
      let created: { id: string };
      if (existing && !existing.isActive) {
        // Reactivate: M:N kategorileri replace + diriltme + güncel veri.
        await tx.subcontractorToCategory.deleteMany({
          where: { subcontractorId: existing.id },
        });
        created = await tx.subcontractor.update({
          where: { id: existing.id },
          data: { ...payload, isActive: true },
          select: { id: true },
        });
      } else {
        created = await tx.subcontractor.create({
          data: payload,
          select: { id: true },
        });
      }
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
      action: existing ? "UPDATE" : "CREATE",
      tableName: "SUBCONTRACTOR",
      recordId: sub!.id,
      newData: {
        code: sub!.code,
        name: sub!.name,
        categoryIds,
        ...(existing ? { reactivated: true } : {}),
      },
    });

    return {
      success: true,
      data: sub,
      message: existing
        ? `Pasif fason firma yeniden aktive edildi: ${sub!.name}`
        : `Fason firma oluşturuldu: ${sub!.name}`,
    };
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
      isFavorite?: boolean;
      categoryIds?: string[]; // verilirse mevcut kategoriler tamamen değişir
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const { categoryIds, ...rest } = data;

    // Update'te her alan tamamen optional. Gönderilmemişse undefined kalır
    // (Prisma update no-op). Gönderildiyse format şartı uygulanır; sonuç
    // (string ya da null) doğrudan yazılır.
    if (rest.code !== undefined) {
      const v = validateCode(rest.code, { label: "Fason kodu", required: true });
      if (typeof v === "string") rest.code = v;
    }
    if (rest.name !== undefined) {
      const v = validateName(rest.name, { label: "Fason adı", required: true });
      if (typeof v === "string") rest.name = v;
    }
    if (rest.taxNumber !== undefined) {
      rest.taxNumber = normalizeAndValidateTaxNumber(rest.taxNumber) as string | null;
    }
    if (rest.phone !== undefined) {
      rest.phone = normalizeAndValidatePhone(rest.phone) as string | null;
    }
    if (rest.address !== undefined) {
      rest.address = normalizeAndValidateAddress(rest.address) as string | null;
    }

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
