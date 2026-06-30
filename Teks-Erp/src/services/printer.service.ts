// =============================================================================
// TeksERP - Printer Model & Label Format Profile Services
// =============================================================================
// BaseService + create/update override ile validateRefs (product-recipe.service
// deseni). Bare BaseController Zod taşımadığından sayısal/FK hijyeni serviste
// yapılır: set-once master-data'da sıfır/negatif geometri veya pasif default-profil
// referansı tutarsız etiket üretir → en düşük değerde reddet.
// Yalnız GÖNDERİLEN alanlar denetlenir (PATCH kısmi gönderebilir).
// =============================================================================

import { PrinterLanguage } from "@prisma/client";
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { LabelService } from "./label.service";
import { renderLabel, type LabelRenderInput } from "./helpers/label-renderer.registry";
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

  /**
   * Bu profili TOP (rulo) etiketlerinin sistem-varsayılanı yap — atomik: diğer tüm
   * isRollDefault'lar düşürülür, bu true olur. Kartela (SWATCH) etkilenmez.
   */
  async setRollDefault(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.labelFormatProfile.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Boyut profili bulunamadı");
    if (!existing.isActive) throw AppError.badRequest("Pasif profil varsayılan yapılamaz");
    if (existing.isRollDefault) {
      return { success: true, data: existing, message: "Zaten top varsayılanı" };
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.labelFormatProfile.updateMany({
        where: { isRollDefault: true },
        data: { isRollDefault: false },
      });
      return tx.labelFormatProfile.update({ where: { id }, data: { isRollDefault: true } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "label_format_profiles",
      recordId: id,
      oldData: { isRollDefault: false },
      newData: { isRollDefault: true, event: "SET_ROLL_DEFAULT" },
    });

    return { success: true, data: updated, message: `${updated.name} artık top varsayılanı` };
  }

  /**
   * Test baskısı için ÖRNEK (mock) top etiketinin native komutu (PPLA/PPLB/ZPL) —
   * verilen profilin geometrisinde. Yerel yazıcıya (bu PC) doğrudan göndermek için
   * istemci bu baytları çekip `window.api.printer.send` ile basar. SADECE ÜRETİR.
   */
  async getSampleNative(
    id: string,
    language?: PrinterLanguage,
  ): Promise<ApiResponse<{ content: string; language: PrinterLanguage }>> {
    const profile = await prisma.labelFormatProfile.findUnique({ where: { id } });
    if (!profile) throw AppError.notFound("Boyut profili bulunamadı");
    // buildSampleRenderInput private — örnek payload + geometriyi tek yerde üretir;
    // dirty label.service'i DÜZENLEMEDEN runtime'da çağırıyoruz (salt okuma kullanım).
    const ls = new LabelService();
    const input = await (
      ls as unknown as { buildSampleRenderInput(p?: string | null): Promise<LabelRenderInput> }
    ).buildSampleRenderInput(id);
    const lang = language ?? input.format.language;
    const rendered = renderLabel(lang, input);
    if (rendered.language === PrinterLanguage.RASTER_HTML) {
      throw AppError.badRequest("Seçili dil native değil (HTML). PPLA/PPLB/ZPL seçin.");
    }
    return { success: true, data: { content: rendered.content, language: rendered.language } };
  }
}
