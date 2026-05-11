// =============================================================================
// TeksERP - Customer Branch Service
// =============================================================================
// Müşterinin sevk noktaları (şube/depo/mağaza adresleri).
// Sevkiyat oluştururken hedef şube olarak seçilir.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

const TABLE = "CUSTOMER_BRANCH";

export interface CustomerBranchInput {
  code?: string | null;
  name: string;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export class CustomerBranchService {
  /** Bir müşterinin tüm şubeleri (default: aktif). */
  async findByCustomer(
    customerId: string,
    opts?: { includeInactive?: boolean }
  ): Promise<ApiResponse<unknown[]>> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");

    const branches = await prisma.customerBranch.findMany({
      where: {
        customerId,
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return { success: true, data: branches };
  }

  async create(
    customerId: string,
    data: CustomerBranchInput,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, isActive: true },
    });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    if (!customer.isActive) throw AppError.badRequest("Müşteri pasif durumda");

    const created = await prisma.customerBranch.create({
      data: {
        customerId,
        code: data.code ?? null,
        name: data.name,
        address: data.address ?? null,
        city: data.city ?? null,
        district: data.district ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.contactPhone ?? null,
        notes: data.notes ?? null,
        isActive: data.isActive ?? true,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: created.id,
      newData: { customerId, ...data },
    });

    return { success: true, data: created, message: "Şube eklendi" };
  }

  async update(
    id: string,
    data: Partial<CustomerBranchInput>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const existing = await prisma.customerBranch.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Şube bulunamadı");

    const updated = await prisma.customerBranch.update({
      where: { id },
      data: {
        code: data.code === undefined ? undefined : data.code,
        name: data.name,
        address: data.address === undefined ? undefined : data.address,
        city: data.city === undefined ? undefined : data.city,
        district: data.district === undefined ? undefined : data.district,
        contactName:
          data.contactName === undefined ? undefined : data.contactName,
        contactPhone:
          data.contactPhone === undefined ? undefined : data.contactPhone,
        notes: data.notes === undefined ? undefined : data.notes,
        isActive: data.isActive,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: existing as unknown as Record<string, unknown>,
      newData: data as unknown as Record<string, unknown>,
    });

    return { success: true, data: updated, message: "Şube güncellendi" };
  }

  /** Soft delete — şubenin geçmiş sevkiyatları kalır, ileride seçilemez. */
  async deactivate(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    const existing = await prisma.customerBranch.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Şube bulunamadı");

    if (!existing.isActive) {
      return { success: true, data: { id }, message: "Şube zaten pasif" };
    }

    await prisma.customerBranch.update({
      where: { id },
      data: { isActive: false },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { isActive: true },
      newData: { isActive: false },
    });

    return { success: true, data: { id }, message: "Şube pasife alındı" };
  }
}
