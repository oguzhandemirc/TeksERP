// =============================================================================
// TeksERP - Customer Service (extends BaseService)
// =============================================================================
// Overrides:
//   - create / update: taxNumber format kontrolü (VKN/TCKN + esnek yabancı VAT)
// =============================================================================

import { BaseService, BaseServiceConfig } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { validateName, validateCode } from "../lib/string-validators";
import prisma from "../lib/prisma";
import { OrderStatus } from "@prisma/client";

/**
 * VKN (10 hane), TCKN (11 hane) ve yabancı VAT/EIN (12-15 hane) için ortak
 * format. Sadece sayı; harf içeren AB VAT'ları (örn. "DE123456789") henüz
 * destek dışı — gerekirse `^[A-Z]{0,2}\d{10,15}$` gibi genişletilebilir.
 * Boş (null/undefined/"") kabul edilir — schema'da `String?` zaten optional.
 */
const TAX_NUMBER_REGEX = /^\d{10,15}$/;

export class CustomerService extends BaseService {
  constructor(config: BaseServiceConfig) {
    super(config);
  }

  /**
   * taxNumber boş değilse 10-15 hane sayı olmalı.
   * Trim'i çağıran üst katmandan beklemiyoruz; burada da temizliyoruz.
   */
  private validateTaxNumber(raw: unknown): string | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (typeof raw !== "string") {
      throw AppError.badRequest("Vergi numarası metin olmalı");
    }
    const trimmed = raw.trim();
    if (trimmed === "") return null; // boş → null'a çevir
    if (!TAX_NUMBER_REGEX.test(trimmed)) {
      throw AppError.badRequest(
        "Vergi numarası 10-15 hane sayı olmalı (VKN: 10, TCKN: 11)"
      );
    }
    return trimmed;
  }

  /**
   * Name + code (create'te zorunlu, update'te varsa). Trim + max length
   * paylaşımlı validator'dan.
   */
  private applyStringFields(data: Record<string, unknown>, isCreate: boolean): void {
    const code = validateCode(data.code, {
      label: "Müşteri kodu",
      required: isCreate,
    });
    if (code !== undefined) data.code = code;
    const name = validateName(data.name, {
      label: "Müşteri adı",
      required: isCreate,
    });
    if (name !== undefined) data.name = name;
  }

  async create(
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    this.applyStringFields(data, true);
    const validated = this.validateTaxNumber(data.taxNumber);
    if (validated !== undefined) {
      data.taxNumber = validated;
    }
    return super.create(data, userId);
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    this.applyStringFields(data, false);
    const validated = this.validateTaxNumber(data.taxNumber);
    if (validated !== undefined) {
      data.taxNumber = validated;
    }
    return super.update(id, data, userId);
  }

  /**
   * M-26: AÇIK siparişi olan müşteri pasifleştirilemez — yoksa pasif müşterinin
   * siparişleri MRP'de talep olarak yaşamaya devam eder, planlamacı pasif
   * müşteri için üretim açar, sevkiyat FIFO bu satırlara tahsis eder.
   * "Yıkıcı işlemde somut liste" kuralı: bloklanırken sipariş no'ları döner.
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const openOrders = await prisma.order.findMany({
      where: {
        customerId: id,
        status: { in: [OrderStatus.PENDING, OrderStatus.APPROVED, OrderStatus.PARTIAL_SHIPPED] },
      },
      select: { orderNumber: true },
      take: 20,
    });
    if (openOrders.length > 0) {
      const list = openOrders.map((o) => o.orderNumber).join(", ");
      throw AppError.conflict(
        `Müşterinin açık siparişleri var: ${list}${openOrders.length === 20 ? ", …" : ""}. ` +
          `Önce siparişleri kapatın/iptal edin, sonra müşteriyi pasife alın.`
      );
    }
    return super.softDelete(id, userId);
  }

  /**
   * F203: kalıcı silme guard'ı — bağımlı kayıt varsa ham FK (P2003) yerine anlamlı
   * 409. Tümü prisma.* (tx DIŞI) → Promise.all serbest (kural yalnız tx.* için).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
    if (!existing) return { success: false, data: null, message: "Müşteri bulunamadı" };

    const [orderCount, shipmentCount, returnCount, branchCount] = await Promise.all([
      prisma.order.count({ where: { customerId: id } }),
      prisma.shipment.count({ where: { customerId: id } }),
      prisma.rollReturn.count({ where: { customerId: id } }),
      prisma.customerBranch.count({ where: { customerId: id } }),
    ]);

    const blockers: string[] = [];
    if (orderCount > 0) blockers.push(`${orderCount} sipariş`);
    if (shipmentCount > 0) blockers.push(`${shipmentCount} sevkiyat`);
    if (returnCount > 0) blockers.push(`${returnCount} iade`);
    if (branchCount > 0) blockers.push(`${branchCount} şube`);

    if (blockers.length > 0) {
      throw AppError.conflict(
        `Müşteriye bağlı kayıtlar var (${blockers.join(", ")}) — kalıcı silinemez. ` +
          `Müşteriyi pasife alın.`,
      );
    }
    return super.hardDelete(id, userId);
  }
}
