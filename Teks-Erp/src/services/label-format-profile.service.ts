// =============================================================================
// TeksERP - Label Format Profile Service
// =============================================================================
// BaseService + create/update override ile validateRefs (product-recipe.service
// deseni). Bare BaseController Zod taşımadığından sayısal hijyen serviste yapılır:
// set-once master-data'da sıfır/negatif geometri tutarsız etiket üretir → en düşük
// değerde reddet. Yalnız GÖNDERİLEN alanlar denetlenir (PATCH kısmi gönderebilir).
// (PrinterModel kataloğu 2026-07'de kaldırıldı — yazıcı dili/profili tamamen
// PeripheralDevice üzerinde.)
// =============================================================================

import { PrinterLanguage, LabelKind } from "@prisma/client";
import bwipjs from "bwip-js";
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { LabelPayload } from "./label.service";
import { resolveLabelFormat } from "./helpers/label-format.resolver";
import { findContextDefaultTemplate } from "./helpers/label-routing.resolver";
import { renderLabel, type LabelRenderInput } from "./helpers/label-renderer.registry";
import { renderNativePreviewSvg, svgToPreviewHtml } from "./helpers/native-preview";
import { mmToDots } from "./helpers/native-label.shared";
import type { ApiResponse } from "../types/api.types";

const SAMPLE_BC = "TEKSORNEK0001";

/** Tür-duyarlı ÖRNEK payload — Ham (renksiz) / Bitmiş (renkli) / Kartela (En×Boy+Kart No). */
function samplePayload(kind: LabelKind): LabelPayload {
  const p = {
    rollId: "ornek", barcode: SAMPLE_BC, status: "WAREHOUSE", qualityGrade: "1.KALITE",
    widthCm: 150, lengthMeters: 320, weightKg: 42, markedForKartela: kind === LabelKind.SWATCH,
    itemCode: "ORNEK", itemName: "ORNEK URUN", itemNameDefault: "ORNEK URUN", itemNameSource: "DEFAULT",
    colorCode: null, colorName: null, colorNameDefault: null, colorNameSource: null,
    customerName: "ORNEK MUSTERI", customerId: null, orderNumber: "ORN-0001", orderLineId: null,
    batchNumber: "P-ORNEK-001", printedAt: new Date().toISOString(), kind,
    cardNumber: null, lengthCm: null, parentRollBarcode: null,
  } as unknown as Record<string, unknown>;
  if (kind === LabelKind.ROLL_FINISHED) {
    Object.assign(p, { colorCode: "MV", colorName: "MAVI", colorNameDefault: "MAVI", colorNameSource: "DEFAULT" });
  }
  if (kind === LabelKind.SWATCH) {
    Object.assign(p, { lengthCm: 30, cardNumber: "KRT-ORNEK-01", parentRollBarcode: SAMPLE_BC });
  }
  return p as unknown as LabelPayload;
}

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

export class LabelFormatProfileService extends BaseService {
  /** KALICI silinenler (deletedAt dolu) hiçbir listede görünmez — pasifler görünür. */
  protected extraWhere(): Record<string, unknown> {
    return { deletedAt: null };
  }

  private validateRefs(data: Record<string, unknown>): void {
    assertPositive(data, "widthMm", "Etiket genişliği (mm)");
    assertPositive(data, "heightMm", "Etiket yüksekliği (mm)");
    assertPositive(data, "dpi", "DPI");
    assertNonNegative(data, "marginMm", "Güvenlik payı (mm)");
    assertNonNegative(data, "marginTopMm", "Üst pay (mm)");
    assertNonNegative(data, "marginRightMm", "Sağ pay (mm)");
    assertNonNegative(data, "marginBottomMm", "Alt pay (mm)");
    assertNonNegative(data, "marginLeftMm", "Sol pay (mm)");
    assertNonNegative(data, "gapMm", "Etiket arası boşluk (mm)");
  }

  async create(data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    delete data.deletedAt; // silinme damgası YALNIZ hardDelete'ten yazılır
    this.validateRefs(data);
    return super.create(data, userId);
  }

  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    delete data.deletedAt;
    const existing = await prisma.labelFormatProfile.findUnique({ where: { id }, select: { deletedAt: true } });
    if (existing?.deletedAt) throw AppError.badRequest("Silinmiş profil düzenlenemez veya geri getirilemez");
    this.validateRefs(data);
    return super.update(id, data, userId);
  }

  /**
   * KALICI silme — fiziksel DELETE DEĞİL (deletedAt kalıbı): satır veri bütünlüğü
   * için durur, hiçbir listede görünmez. Kod DEL- önekiyle serbest kalır; bu profili
   * kullanan cihazların referansı sökülür (sistem varsayılan profiline düşerler);
   * top-varsayılanıysa bayrak düşürülür.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const old = await prisma.labelFormatProfile.findUnique({ where: { id } });
    if (!old) return { success: false, data: null, message: "Kayıt bulunamadı" };
    if (old.deletedAt) return { success: true, data: old, message: "Kayıt zaten silinmiş" }; // idempotent
    const freedCode = `DEL-${Date.now().toString(36).toUpperCase()}-${old.code}`.slice(0, 48);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.peripheralDevice.updateMany({ where: { formatProfileId: id }, data: { formatProfileId: null } });
      return tx.labelFormatProfile.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, isRollDefault: false, code: freedCode },
      });
    });
    await AuditService.log({
      userId, action: "DELETE", tableName: "LABEL_FORMAT_PROFILE", recordId: id,
      oldData: old as unknown as Record<string, unknown>,
      newData: { deletedAt: updated.deletedAt, freedCode },
    }).catch(() => undefined);
    return { success: true, data: updated, message: "Profil kalıcı olarak silindi (kayıt veri bütünlüğü için saklanır)" };
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

  /** Tür-duyarlı ÖRNEK etiket render girdisi — o türün varsayılan şablonu + payload +
   *  profil geometrisi (kind ile). Test baskısı/önizleme tek yerden beslenir. */
  private async buildSampleInput(id: string, kind: LabelKind): Promise<LabelRenderInput> {
    const payload = samplePayload(kind);
    const template = await findContextDefaultTemplate(kind);
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: SAMPLE_BC, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: SAMPLE_BC, scale: 3, backgroundcolor: "FFFFFF" });
    const format = await resolveLabelFormat({ profileId: id, kind });
    return { payload, template, barcodeSvg, qrSvg, copies: 1, format };
  }

  /**
   * Test baskısı için ÖRNEK etiketin native komutu (PPLA/PPLB/ZPL) — verilen profil
   * geometrisi + SEÇİLEN TÜRÜN (Ham/Bitmiş/Kartela) varsayılan şablonu ile. İstemci
   * bu baytları çekip `window.api.printer.send` ile basar. SADECE ÜRETİR.
   */
  async getSampleNative(
    id: string,
    language?: PrinterLanguage,
    kind: LabelKind = LabelKind.ROLL_RAW,
  ): Promise<ApiResponse<{ content: string; language: PrinterLanguage }>> {
    const profile = await prisma.labelFormatProfile.findUnique({ where: { id } });
    if (!profile) throw AppError.notFound("Boyut profili bulunamadı");
    const input = await this.buildSampleInput(id, kind);
    const lang = language ?? input.format.language;
    const rendered = renderLabel(lang, input);
    if (rendered.language === PrinterLanguage.RASTER_HTML) {
      throw AppError.badRequest("Seçili dil native değil (HTML). PPLA/PPLB/ZPL seçin.");
    }
    return { success: true, data: { content: rendered.content, language: rendered.language } };
  }

  /** Test baskısı önizlemesi — seçilen türün örnek etiket HTML'i (profil geometrisinde). */
  async getSampleHtml(id: string, kind: LabelKind = LabelKind.ROLL_RAW): Promise<ApiResponse<{ html: string }>> {
    const profile = await prisma.labelFormatProfile.findUnique({ where: { id } });
    if (!profile) throw AppError.notFound("Boyut profili bulunamadı");
    const input = await this.buildSampleInput(id, kind);
    return { success: true, data: { html: renderLabel(PrinterLanguage.RASTER_HTML, input).content } };
  }

  /**
   * WYSIWYG önizleme — AKTİF DİLDE. Native dil (PPLB) için gerçek komutları görsele
   * çevirir (mode="svg", baskıyla birebir); çizicisi olmayan dil ya da HTML için
   * HTML motoruna düşer (mode="html", yaklaşık). Frontend content'i iframe'ler +
   * language ile rozet gösterir.
   */
  async getSamplePreview(
    id: string,
    kind: LabelKind = LabelKind.ROLL_RAW,
  ): Promise<ApiResponse<{ mode: "svg" | "html" | "text"; language: PrinterLanguage; content: string }>> {
    const profile = await prisma.labelFormatProfile.findUnique({ where: { id } });
    if (!profile) throw AppError.notFound("Boyut profili bulunamadı");
    const input = await this.buildSampleInput(id, kind);
    const language = input.format.language;
    // HTML dili → görsel HTML zaten baskının kendisi (birebir).
    if (language === PrinterLanguage.RASTER_HTML) {
      return { success: true, data: { mode: "html", language, content: renderLabel(language, input).content } };
    }
    // Native → gerçek komutları çiz (birebir). Çizilemezse (çizici yok / geçersiz
    // raw-code) HAM KOMUTU göster — yanıltıcı farklı düzen yerine "basılan tam bu".
    const native = renderLabel(language, input).content;
    const svg = renderNativePreviewSvg(language, native, mmToDots(input.format.widthMm, input.format.dpi));
    if (svg) return { success: true, data: { mode: "svg", language, content: svgToPreviewHtml(svg) } };
    return { success: true, data: { mode: "text", language, content: native } };
  }
}
