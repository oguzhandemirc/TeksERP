// =============================================================================
// TeksERP - Color (Renk Kataloğu) Service
// =============================================================================
// Renk kataloğu artık firmaya (müşteriye) özel atama taşır: bir renk bir veya
// birden fazla müşteriye atanabilir. Atama M:N olarak mevcut CustomerColorAlias
// tablosunda tutulur (satır = atama, alias = o müşterinin renge verdiği isim;
// renk tarafından atarken alias default olarak renk adıyla doldurulur, müşteri
// panelinden override edilebilir).
//
// Aktif/pasif = renk geneli (Color.isActive). Atama bazında aktif/pasif YOK.
// =============================================================================

import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

const TABLE_ALIAS = "CUSTOMER_COLOR_ALIAS";

export class ColorService extends BaseService {
  /**
   * Color create — standart CRUD (BaseService) + `customerIds` müşteri ataması.
   * customerIds payload'dan ayrılır (yoksa Prisma bilinmeyen alan hatası verir),
   * renk oluşturulduktan sonra atamalar senkronlanır.
   */
  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const { customerIds, rest } = splitCustomerIds(data);

    const res = await super.create(rest, userId);
    const color = res.data as { id: string } | null;

    if (color && customerIds !== undefined) {
      await this.syncCustomerAssignments(color.id, customerIds, userId);
      (res.data as Record<string, unknown>).customerIds = dedupe(customerIds);
    }

    return res;
  }

  /**
   * Color update — standart CRUD + `customerIds` senkron. customerIds tanımsızsa
   * atamalara DOKUNULMAZ (restore'un `{ isActive: true }` PATCH'i atamaları
   * silmesin diye kritik).
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const { customerIds, rest } = splitCustomerIds(data);

    // rest boşsa gereksiz audit/no-op update üretme — mevcut kaydı çek.
    const res =
      Object.keys(rest).length > 0
        ? await super.update(id, rest, userId)
        : await super.findById(id);

    const color = res.data as { id: string } | null;

    if (color && customerIds !== undefined) {
      await this.syncCustomerAssignments(color.id, customerIds, userId);
      (res.data as Record<string, unknown>).customerIds = dedupe(customerIds);
    }

    return res;
  }

  /**
   * findById — renge atanmış müşteri id'lerini ekler (edit formu prefill için).
   */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    const res = await super.findById(id);
    if (res.success && res.data) {
      const rows = await prisma.customerColorAlias.findMany({
        where: { colorId: id },
        select: { customerId: true },
      });
      (res.data as Record<string, unknown>).customerIds = rows.map((r) => r.customerId);
    }
    return res;
  }

  // ===========================================================================
  // Müşteri atama senkronu — replace semantiği. Atama = renk↔müşteri bağı;
  // alias (müşterideki özel ad) YAZILMAZ (null kalır). Var olan custom alias'lı
  // satırlar (Müşteri panelinden girilmiş) korunur — sadece bağ eklenir/silinir.
  // ===========================================================================
  private async syncCustomerAssignments(
    colorId: string,
    rawCustomerIds: string[],
    userId?: string,
  ): Promise<void> {
    const customerIds = dedupe(rawCustomerIds);

    if (customerIds.length > 0) {
      const found = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true },
      });
      if (found.length !== customerIds.length) {
        throw AppError.badRequest("Bazı müşteriler bulunamadı");
      }
    }

    const existing = await prisma.customerColorAlias.findMany({
      where: { colorId },
      select: { customerId: true },
    });
    const existingSet = new Set(existing.map((e) => e.customerId));
    const targetSet = new Set(customerIds);

    const toAdd = customerIds.filter((cid) => !existingSet.has(cid));
    const toRemove = existing
      .map((e) => e.customerId)
      .filter((cid) => !targetSet.has(cid));

    if (toAdd.length === 0 && toRemove.length === 0) return;

    await prisma.$transaction(async (tx) => {
      // pg adapter: tx içinde Promise.all yasak — seri çalıştır.
      if (toRemove.length > 0) {
        await tx.customerColorAlias.deleteMany({
          where: { colorId, customerId: { in: toRemove } },
        });
      }
      if (toAdd.length > 0) {
        await tx.customerColorAlias.createMany({
          data: toAdd.map((customerId) => ({
            customerId,
            colorId,
            alias: null,
          })),
        });
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE_ALIAS,
      recordId: colorId,
      newData: { colorId, added: toAdd, removed: toRemove },
    });
  }
}

// =============================================================================
// Local helpers
// =============================================================================

function splitCustomerIds(data: Record<string, unknown>): {
  customerIds: string[] | undefined;
  rest: Record<string, unknown>;
} {
  const rest = { ...data };
  const raw = rest.customerIds;
  delete rest.customerIds;
  const customerIds = Array.isArray(raw) ? (raw as string[]) : undefined;
  return { customerIds, rest };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}
