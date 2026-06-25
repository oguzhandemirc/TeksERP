// =============================================================================
// TeksERP - Printer Model & Label Format Profile Services
// =============================================================================
// BaseService + create/update override ile validateRefs (product-recipe.service
// deseni). Bare BaseController Zod taşımadığından sayısal/FK hijyeni serviste
// yapılır: set-once master-data'da sıfır/negatif geometri veya pasif default-profil
// referansı tutarsız etiket üretir → en düşük değerde reddet.
// Yalnız GÖNDERİLEN alanlar denetlenir (PATCH kısmi gönderebilir).
// =============================================================================

import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";

/** Gönderildiyse pozitif tamsayı/ondalık doğrula (>0). undefined → atla. */
function assertPositive(data: Record<string, unknown>, key: string, label: string): void {
  if (data[key] === undefined || data[key] === null) return;
  const n = Number(data[key]);
  if (!Number.isFinite(n) || n <= 0) throw AppError.badRequest(`${label} pozitif olmalı`);
}

/** Gönderildiyse negatif olmamalı (>=0). undefined → atla. */
function assertNonNegative(data: Record<string, unknown>, key: string, label: string): void {
  if (data[key] === undefined || data[key] === null) return;
  const n = Number(data[key]);
  if (!Number.isFinite(n) || n < 0) throw AppError.badRequest(`${label} negatif olamaz`);
}

export class PrinterModelService extends BaseService {
  private async validateRefs(data: Record<string, unknown>): Promise<void> {
    assertPositive(data, "dpi", "DPI");
    assertPositive(data, "maxWidthMm", "Maksimum baskı genişliği (mm)");
    // defaultProfileId verildiyse (null = temizle, atla) var + aktif olmalı.
    if (typeof data.defaultProfileId === "string" && data.defaultProfileId) {
      const profile = await prisma.labelFormatProfile.findFirst({
        where: { id: data.defaultProfileId, isActive: true },
        select: { id: true },
      });
      if (!profile) throw AppError.badRequest("Varsayılan etiket format profili bulunamadı veya pasif");
    }
  }

  async create(data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    await this.validateRefs(data);
    return super.create(data, userId);
  }

  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    await this.validateRefs(data);
    return super.update(id, data, userId);
  }
}

export class LabelFormatProfileService extends BaseService {
  private validateRefs(data: Record<string, unknown>): void {
    assertPositive(data, "widthMm", "Etiket genişliği (mm)");
    assertPositive(data, "heightMm", "Etiket yüksekliği (mm)");
    assertPositive(data, "dpi", "DPI");
    assertNonNegative(data, "marginMm", "Güvenlik payı (mm)");
    assertNonNegative(data, "gapMm", "Etiket arası boşluk (mm)");
  }

  async create(data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    this.validateRefs(data);
    return super.create(data, userId);
  }

  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    this.validateRefs(data);
    return super.update(id, data, userId);
  }
}
