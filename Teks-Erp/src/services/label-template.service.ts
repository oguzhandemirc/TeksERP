// =============================================================================
// TeksERP - Label Template Service
// =============================================================================
// Etiket standardı (alan + sıra + Türkçe başlık + bold/font) yönetimi.
// Her LabelKind için en fazla 1 isDefault=true — transaction içinde diğer
// default'lar düşürülür VE DB seddi: partial unique index
// `label_templates_one_default_per_kind` ON (kind) WHERE isDefault=true
// (migration). Eşzamanlı iki setDefault'ta kaybeden P2002 alır → 409 (aşağıda).
//
// fields validation: src/config/label-fields.ts catalog'undan.
// - Sadece izinli key'ler kabul (whitelist)
// - required=true alanlar isVisible=true olmak zorunda
// - duplicate key yasak
// - order pozitif tamsayı
// - fontSize sadece "sm"|"md"|"lg"|"xl"
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import bwipjs from "bwip-js";
import {
  LabelTemplate,
  LabelKind,
  PrinterLanguage,
  Prisma,
} from "@prisma/client";
import {
  FIELD_CATALOG,
  FONT_SIZES,
  TemplateField,
  buildDefaultFields,
  findFieldDef,
  getAllowedKeys,
  getRequiredKeys,
} from "../config/label-fields";
import { renderLabel } from "./helpers/label-renderer.registry";
import { resolveLabelFormat } from "./helpers/label-format.resolver";
import { mockPayload } from "./helpers/label-rawcode";
import { fieldDisplayValue } from "./helpers/label-field-values";
import { renderNativePreviewSvg, svgToPreviewHtml } from "./helpers/native-preview";
import { mmToDots } from "./helpers/native-label.shared";

const TABLE = "LABEL_TEMPLATE";

/**
 * "kind içinde tek default" partial unique index ihlalini (eşzamanlı setDefault/
 * create/update yarışı) 409'a çevirir. Diğer P2002'leri (örn. @@unique[kind,name]
 * isim çakışması) aynen geçirir — target'ta "default" geçip geçmediğine bakar.
 */
function rethrowDefaultConflict(e: unknown): never {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String((e.meta as { target?: unknown } | undefined)?.target ?? "")
      .toLowerCase()
      .includes("default")
  ) {
    throw AppError.conflict(
      "Bu tür için varsayılan az önce değişti — sayfayı yenileyip tekrar deneyin."
    );
  }
  throw e;
}

/** Uzman raw-code override (dil→kod). Boş string'ler temizlenir = o dilde otomatik. */
export type RawCodeMap = Partial<Record<"PPLA" | "PPLB" | "ZPL" | "RASTER_HTML", string>>;

export interface LabelTemplateInput {
  name: string;
  kind: LabelKind;
  isDefault?: boolean;
  isActive?: boolean;
  /** Boş geçilirse catalog'dan default field listesi üretilir. */
  fields?: TemplateField[];
  rawCode?: RawCodeMap;
}

export interface LabelTemplateUpdateInput {
  name?: string;
  isDefault?: boolean;
  isActive?: boolean;
  fields?: TemplateField[];
  rawCode?: RawCodeMap;
}

/** Boş/whitespace dil değerlerini at → { } = tüm diller otomatik üretim. */
function normalizeRawCode(rc: RawCodeMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rc)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

export class LabelTemplateService {
  // ---------------------------------------------------------------------------
  // READS
  // ---------------------------------------------------------------------------

  async findAll(opts?: {
    kind?: LabelKind;
    includeInactive?: boolean;
  }): Promise<ApiResponse<LabelTemplate[]>> {
    const rows = await prisma.labelTemplate.findMany({
      where: {
        ...(opts?.kind ? { kind: opts.kind } : {}),
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    });
    return { success: true, data: rows };
  }

  async findById(id: string): Promise<ApiResponse<LabelTemplate>> {
    const row = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!row) throw AppError.notFound("Template bulunamadı");
    return { success: true, data: row };
  }

  /**
   * Bir LabelKind için aktif default template. Yoksa null döner — etiket
   * önizleme endpoint'i bunu görüp catalog default'una düşer.
   */
  async findDefault(kind: LabelKind): Promise<LabelTemplate | null> {
    return prisma.labelTemplate.findFirst({
      where: { kind, isDefault: true, isActive: true },
    });
  }

  /**
   * Frontend için: hangi alanlar var + tipleri + default başlıkları.
   * Template oluştururken UI'nın gösterdiği "alan kataloğu".
   */
  getCatalog(kind: LabelKind): ApiResponse<{ kind: LabelKind; fields: typeof FIELD_CATALOG[LabelKind] }> {
    const fields = FIELD_CATALOG[kind];
    if (!fields) throw AppError.badRequest("Bilinmeyen LabelKind");
    return { success: true, data: { kind, fields } };
  }

  // ---------------------------------------------------------------------------
  // MUTATIONS
  // ---------------------------------------------------------------------------

  async create(input: LabelTemplateInput, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const name = input.name.trim();
    if (name.length === 0) throw AppError.badRequest("Template adı boş olamaz");

    const fields = input.fields ?? buildDefaultFields(input.kind);
    validateFields(input.kind, fields);

    const created = await prisma.$transaction(async (tx) => {
      // isDefault=true geliyorsa diğerlerini düşür (kind içinde tek default).
      if (input.isDefault) {
        await tx.labelTemplate.updateMany({
          where: { kind: input.kind, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.labelTemplate.create({
        data: {
          name,
          kind: input.kind,
          isDefault: input.isDefault ?? false,
          isActive: input.isActive ?? true,
          fields: fields as unknown as Prisma.InputJsonValue,
          ...(input.rawCode ? { rawCode: normalizeRawCode(input.rawCode) as Prisma.InputJsonValue } : {}),
        },
      });
    }).catch(rethrowDefaultConflict);

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TABLE,
      recordId: created.id,
      newData: {
        name: created.name,
        kind: created.kind,
        isDefault: created.isDefault,
        fieldCount: fields.length,
      },
    });

    return { success: true, data: created, message: "Template oluşturuldu" };
  }

  async update(id: string, input: LabelTemplateUpdateInput, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");

    if (input.fields) {
      validateFields(existing.kind, input.fields);
    }

    const data: Prisma.LabelTemplateUpdateInput = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) throw AppError.badRequest("Template adı boş olamaz");
      data.name = trimmed;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.fields) data.fields = input.fields as unknown as Prisma.InputJsonValue;
    if (input.isDefault !== undefined) data.isDefault = input.isDefault;
    if (input.rawCode !== undefined) data.rawCode = normalizeRawCode(input.rawCode) as Prisma.InputJsonValue;

    const updated = await prisma.$transaction(async (tx) => {
      // isDefault=true'ya çekiliyorsa kind içindeki diğer default'ları düşür.
      if (input.isDefault === true && !existing.isDefault) {
        await tx.labelTemplate.updateMany({
          where: { kind: existing.kind, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      // isDefault=false'a düşürülüyorsa engelle: kind'da en az 1 default kalmalı
      // değil aslında — operatör hepsini default-değil yapabilir. UI'da uyarı verir.
      return tx.labelTemplate.update({ where: { id }, data });
    }).catch(rethrowDefaultConflict);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: {
        name: existing.name,
        isDefault: existing.isDefault,
        isActive: existing.isActive,
      },
      newData: {
        name: updated.name,
        isDefault: updated.isDefault,
        isActive: updated.isActive,
        fieldsChanged: !!input.fields,
      },
    });

    return { success: true, data: updated, message: "Template güncellendi" };
  }

  /**
   * Başka bir template'i kind içinde default yapar. Idempotent.
   */
  async setDefault(id: string, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (!existing.isActive) throw AppError.badRequest("Pasif template default yapılamaz");
    if (existing.isDefault) {
      return { success: true, data: existing, message: "Zaten default" };
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.labelTemplate.updateMany({
        where: { kind: existing.kind, isDefault: true },
        data: { isDefault: false },
      });
      return tx.labelTemplate.update({
        where: { id },
        data: { isDefault: true },
      });
    }).catch(rethrowDefaultConflict);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { isDefault: false },
      newData: { isDefault: true, event: "SET_DEFAULT" },
    });

    return { success: true, data: updated, message: `${updated.name} artık default` };
  }

  /**
   * Soft delete: isActive=false. Default template silinemez (önce başka birini
   * default yapmak gerekir).
   */
  async deactivate(id: string, userId?: string): Promise<ApiResponse<{ deactivated: true }>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (existing.isDefault) {
      throw AppError.badRequest(
        "Default template pasifleştirilemez — önce başka bir template'i default yapın"
      );
    }
    if (!existing.isActive) {
      return { success: true, data: { deactivated: true }, message: "Zaten pasif" };
    }

    await prisma.labelTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TABLE,
      recordId: id,
      oldData: { isActive: true },
      newData: { isActive: false, event: "DEACTIVATE" },
    });

    return { success: true, data: { deactivated: true }, message: "Template pasifleştirildi" };
  }

  /**
   * Bu tür + dil için OTOMATİK ÜRETİLEN kodu, düzenlenebilir {{}} yer-tutuculu şablon
   * olarak döner ("Varsayılan kodu getir"). Auto çıktısındaki görünen alan değerlerini
   * ({{key}}) yer-tutucusuna geri çevirir → uzman bunu kopyalayıp/düzenleyip kaydeder.
   */
  async getDefaultCode(kind: LabelKind, language: PrinterLanguage): Promise<ApiResponse<{ code: string }>> {
    const payload = mockPayload(kind);
    const tpl = await prisma.labelTemplate.findFirst({ where: { kind, isDefault: true, isActive: true } });
    // rawCode'u sıyır → otomatik üretim (şablonun alanlarıyla); değerler fieldDisplayValue
    // formatında çıkar → aşağıdaki geri-çevirme birebir eşleşir.
    const template = tpl ? ({ ...tpl, rawCode: null } as LabelTemplate) : null;
    const format = await resolveLabelFormat({ kind });
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    let code = renderLabel(language, { payload, template, barcodeSvg, qrSvg, copies: 1, format }).content;
    // Görünen değer → {{key}} (uzun değer önce ki alt-dize çakışması olmasın).
    const pairs = [...getAllowedKeys(kind)]
      .map((k) => [k, fieldDisplayValue(payload, k).value] as const)
      .filter(([, v]) => v && v.trim().length > 1)
      .sort((a, b) => b[1].length - a[1].length);
    for (const [k, v] of pairs) code = code.split(v).join(`{{${k}}}`);
    return { success: true, data: { code } };
  }

  /**
   * "Alanlar" sekmesi canlı önizlemesi — AKTİF DİLDE (WYSIWYG). Verilen (kaydedilmemiş)
   * alanlarla + sistem varsayılan geometrisiyle render eder. Native dil (PPLB) → görsel
   * SVG (baskıyla birebir); HTML dili → HTML; çizilemeyen native → ham komut metni.
   */
  async getFieldsPreview(
    kind: LabelKind,
    fields: TemplateField[],
  ): Promise<ApiResponse<{ mode: "svg" | "html" | "text"; language: PrinterLanguage; content: string }>> {
    const payload = mockPayload(kind);
    const template = { kind, fields, rawCode: null } as unknown as LabelTemplate;
    const format = await resolveLabelFormat({ kind });
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    const input = { payload, template, barcodeSvg, qrSvg, copies: 1, format };
    const language = format.language;
    if (language === PrinterLanguage.RASTER_HTML) {
      return { success: true, data: { mode: "html", language, content: renderLabel(language, input).content } };
    }
    const native = renderLabel(language, input).content;
    const svg = renderNativePreviewSvg(language, native, mmToDots(format.widthMm, format.dpi));
    if (svg) return { success: true, data: { mode: "svg", language, content: svgToPreviewHtml(svg) } };
    return { success: true, data: { mode: "text", language, content: native } };
  }
}

// =============================================================================
// Validation
// =============================================================================

function validateFields(kind: LabelKind, fields: TemplateField[]): void {
  if (!Array.isArray(fields)) {
    throw AppError.badRequest("fields bir dizi olmalı");
  }
  if (fields.length === 0) {
    throw AppError.badRequest("Template'te en az 1 alan olmalı");
  }

  const allowed = getAllowedKeys(kind);
  const required = getRequiredKeys(kind);
  const seen = new Set<string>();

  for (const f of fields) {
    if (!f || typeof f !== "object") {
      throw AppError.badRequest("Geçersiz field nesnesi");
    }
    if (typeof f.key !== "string" || f.key.length === 0) {
      throw AppError.badRequest("field.key zorunlu (string)");
    }
    if (!allowed.has(f.key)) {
      throw AppError.badRequest(
        `'${f.key}' bu etiket türünde tanımlı değil. İzinli alanlar: ${[...allowed].join(", ")}`
      );
    }
    if (seen.has(f.key)) {
      throw AppError.badRequest(`Tekrarlanan alan: '${f.key}'`);
    }
    seen.add(f.key);

    // label boş olabilir (çıktıda yalnız değer görünür) — yalnız string tipi şart.
    if (typeof f.label !== "string") {
      throw AppError.badRequest(`'${f.key}' için label metin olmalı`);
    }
    if (typeof f.order !== "number" || !Number.isInteger(f.order) || f.order < 1) {
      throw AppError.badRequest(`'${f.key}' için order pozitif tamsayı olmalı`);
    }
    if (typeof f.isVisible !== "boolean") {
      throw AppError.badRequest(`'${f.key}' için isVisible boolean olmalı`);
    }
    if (f.isBold !== undefined && typeof f.isBold !== "boolean") {
      throw AppError.badRequest(`'${f.key}' için isBold boolean olmalı`);
    }
    if (f.fontSize !== undefined && !FONT_SIZES.includes(f.fontSize)) {
      throw AppError.badRequest(
        `'${f.key}' için fontSize geçersiz. İzinli: ${FONT_SIZES.join(", ")}`
      );
    }

    // required alanlar isVisible=true olmak zorunda
    if (required.has(f.key) && !f.isVisible) {
      const def = findFieldDef(kind, f.key);
      throw AppError.badRequest(
        `'${def?.defaultLabel ?? f.key}' alanı zorunlu — gizlenemez`
      );
    }
  }

  // Required alanların hepsi listede olmak zorunda
  for (const reqKey of required) {
    if (!seen.has(reqKey)) {
      const def = findFieldDef(kind, reqKey);
      throw AppError.badRequest(
        `Zorunlu alan eksik: '${def?.defaultLabel ?? reqKey}'`
      );
    }
  }

  // Scanner-okur en az bir alan zorunlu: barkod VEYA QR kodu görünür olmalı.
  // Aksi halde basılan etiket fabrika içi takip edilemez — fiziksel iz kalmaz.
  const hasBarcode = fields.some((f) => f.key === "barcode" && f.isVisible);
  const hasQr = fields.some((f) => f.key === "qrCode" && f.isVisible);
  if (!hasBarcode && !hasQr) {
    throw AppError.badRequest(
      "Barkod veya QR kodundan en az biri görünür olmalı (taranabilir alan zorunlu)"
    );
  }
}
