// =============================================================================
// TeksERP - Customer Variant Alias Service
// =============================================================================
// Aynı desen her müşteride farklı isimle geçebilir (patos ↔ selop).
// Paketleme/etiket basımında müşterinin kendi ismiyle basılması için lookup
// yapılır. Hedef müşteri üretim türüne göre çözülür:
//   - ORDER_PRODUCTION       → WorkOrder.orderLinks → Order.customerId
//   - STOCK_PRODUCTION       → OrderAllocation zinciri (sevk için bağlandıysa)
//   - SERVICE_PRODUCTION     → Roll.ownerCustomerId
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { Prisma } from "@prisma/client";

export interface CustomerVariantAliasDto {
  id: string;
  customerId: string;
  variantId: string;
  customerLabel: string;
  customerCode: string | null;
  isActive: boolean;
  variant: {
    id: string;
    code: string;
    name: string;
    item: { id: string; code: string; name: string };
  };
}

export interface AliasResolution {
  customerId: string | null;
  customerName: string | null;
  variantId: string | null;
  internalCode: string | null;
  internalName: string | null;
  customerLabel: string | null;
  customerCode: string | null;
  /** Müşteri adı yerine basılabilecek tercih edilen etiket (alias ?? internalName). */
  displayLabel: string | null;
}

const aliasInclude = {
  variant: {
    include: {
      item: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.CustomerVariantAliasInclude;

function toDto(
  row: Prisma.CustomerVariantAliasGetPayload<{ include: typeof aliasInclude }>,
): CustomerVariantAliasDto {
  return {
    id: row.id,
    customerId: row.customerId,
    variantId: row.variantId,
    customerLabel: row.customerLabel,
    customerCode: row.customerCode,
    isActive: row.isActive,
    variant: {
      id: row.variant.id,
      code: row.variant.code,
      name: row.variant.name,
      item: row.variant.item,
    },
  };
}

export class CustomerVariantAliasService {
  async findByCustomer(
    customerId: string,
  ): Promise<ApiResponse<CustomerVariantAliasDto[]>> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");

    const rows = await prisma.customerVariantAlias.findMany({
      where: { customerId },
      include: aliasInclude,
      orderBy: [
        { variant: { item: { code: "asc" } } },
        { variant: { code: "asc" } },
      ],
    });
    return { success: true, data: rows.map(toDto) };
  }

  async create(
    data: {
      customerId: string;
      variantId: string;
      customerLabel: string;
      customerCode?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<CustomerVariantAliasDto>> {
    const [customer, variant] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, isActive: true },
      }),
      prisma.itemVariant.findUnique({
        where: { id: data.variantId },
        select: { id: true, isActive: true },
      }),
    ]);
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    if (!customer.isActive) throw AppError.badRequest("Müşteri pasif durumda");
    if (!variant) throw AppError.notFound("Varyant bulunamadı");
    if (!variant.isActive) throw AppError.badRequest("Varyant pasif durumda");

    const existing = await prisma.customerVariantAlias.findUnique({
      where: {
        customerId_variantId: {
          customerId: data.customerId,
          variantId: data.variantId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        "Bu müşteri için bu varyantın zaten bir karşılığı tanımlı",
      );
    }

    const created = await prisma.customerVariantAlias.create({
      data: {
        customerId: data.customerId,
        variantId: data.variantId,
        customerLabel: data.customerLabel,
        customerCode: data.customerCode ?? null,
      },
      include: aliasInclude,
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "CUSTOMER_VARIANT_ALIAS",
      recordId: created.id,
      newData: {
        customerId: created.customerId,
        variantId: created.variantId,
        customerLabel: created.customerLabel,
        customerCode: created.customerCode,
      },
    });

    return {
      success: true,
      data: toDto(created),
      message: "Müşteri desen karşılığı eklendi",
    };
  }

  async update(
    id: string,
    data: {
      customerLabel?: string;
      customerCode?: string | null;
      isActive?: boolean;
    },
    userId?: string,
  ): Promise<ApiResponse<CustomerVariantAliasDto>> {
    const existing = await prisma.customerVariantAlias.findUnique({
      where: { id },
    });
    if (!existing) throw AppError.notFound("Kayıt bulunamadı");

    const updated = await prisma.customerVariantAlias.update({
      where: { id },
      data: {
        customerLabel: data.customerLabel,
        customerCode:
          data.customerCode === undefined ? undefined : data.customerCode,
        isActive: data.isActive,
      },
      include: aliasInclude,
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "CUSTOMER_VARIANT_ALIAS",
      recordId: id,
      oldData: {
        customerLabel: existing.customerLabel,
        customerCode: existing.customerCode,
        isActive: existing.isActive,
      },
      newData: {
        customerLabel: updated.customerLabel,
        customerCode: updated.customerCode,
        isActive: updated.isActive,
      },
    });

    return {
      success: true,
      data: toDto(updated),
      message: "Müşteri desen karşılığı güncellendi",
    };
  }

  async delete(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    const existing = await prisma.customerVariantAlias.findUnique({
      where: { id },
    });
    if (!existing) throw AppError.notFound("Kayıt bulunamadı");

    await prisma.customerVariantAlias.delete({ where: { id } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "CUSTOMER_VARIANT_ALIAS",
      recordId: id,
      oldData: {
        customerId: existing.customerId,
        variantId: existing.variantId,
        customerLabel: existing.customerLabel,
      },
    });

    return { success: true, data: { id }, message: "Kayıt silindi" };
  }

  /**
   * Bir roll için hedef müşteriyi çöz, varsa varyant alias'ını bul ve
   * etikete basılabilir tek bir çıktı üret.
   *
   * Öncelik sırası:
   *   1) Hedef sipariş (orderLineId verilirse) → o siparişin müşterisi
   *   2) SERVICE_PRODUCTION → roll.ownerCustomerId
   *   3) Tahsis (OrderAllocation) varsa → ilk tahsisin siparişinin müşterisi
   *   4) WO'nun orderLinks'i tek bir müşteriye işaret ediyorsa → o müşteri
   *   5) Aksi halde müşteri = null; sadece internal ad döner.
   */
  async resolveForRoll(
    rollId: string,
    opts?: { preferredOrderLineId?: string | null },
  ): Promise<AliasResolution> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        variant: { select: { id: true, code: true, name: true } },
        ownerCustomer: { select: { id: true, name: true } },
        allocations: {
          include: {
            orderLine: {
              include: { order: { include: { customer: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        currentStep: {
          include: {
            workOrder: {
              include: {
                orderLinks: {
                  include: {
                    orderLine: {
                      include: { order: { include: { customer: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!roll) throw AppError.notFound("Top bulunamadı");

    const variantId = roll.variantId;
    const internalCode = roll.variant?.code ?? null;
    const internalName = roll.variant?.name ?? null;

    // Hedef müşteriyi çöz
    let targetCustomerId: string | null = null;
    let targetCustomerName: string | null = null;

    if (opts?.preferredOrderLineId) {
      const line =
        roll.currentStep?.workOrder.orderLinks.find(
          (l) => l.orderLineId === opts.preferredOrderLineId,
        ) ?? null;
      if (line) {
        targetCustomerId = line.orderLine.order.customer.id;
        targetCustomerName = line.orderLine.order.customer.name;
      }
    }
    if (!targetCustomerId && roll.ownerCustomer) {
      targetCustomerId = roll.ownerCustomer.id;
      targetCustomerName = roll.ownerCustomer.name;
    }
    if (!targetCustomerId && roll.allocations.length > 0) {
      const c = roll.allocations[0].orderLine.order.customer;
      targetCustomerId = c.id;
      targetCustomerName = c.name;
    }
    if (!targetCustomerId && roll.currentStep) {
      const uniqueCustomers = new Set(
        roll.currentStep.workOrder.orderLinks.map(
          (l) => l.orderLine.order.customer.id,
        ),
      );
      if (uniqueCustomers.size === 1) {
        const c = roll.currentStep.workOrder.orderLinks[0].orderLine.order.customer;
        targetCustomerId = c.id;
        targetCustomerName = c.name;
      }
    }

    // Alias lookup
    let customerLabel: string | null = null;
    let customerCode: string | null = null;
    if (targetCustomerId && variantId) {
      const alias = await prisma.customerVariantAlias.findUnique({
        where: {
          customerId_variantId: {
            customerId: targetCustomerId,
            variantId,
          },
        },
        select: { customerLabel: true, customerCode: true, isActive: true },
      });
      if (alias && alias.isActive) {
        customerLabel = alias.customerLabel;
        customerCode = alias.customerCode;
      }
    }

    return {
      customerId: targetCustomerId,
      customerName: targetCustomerName,
      variantId,
      internalCode,
      internalName,
      customerLabel,
      customerCode,
      displayLabel: customerLabel ?? internalName,
    };
  }
}
