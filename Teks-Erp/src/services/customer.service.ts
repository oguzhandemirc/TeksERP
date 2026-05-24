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
}
