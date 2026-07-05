// =============================================================================
// TeksERP - Label Template Service
// =============================================================================
// Etiket standardı yönetimi — Etiket Stüdyosu v2: şablonlar TEK HAVUZ.
// Bağlam (LabelKind) başına varsayılan artık LabelContextDefault tablosunda
// (kind @unique = DB seddi; eşzamanlı yarışta kaybeden P2002 → 409 aşağıda).
// GEÇİŞ: eski LabelTemplate.isDefault kolonu DEPRECATED ama ÇİFT-YAZIM ile
// senkron tutulur (mobil useLabelTemplate + eski client geri uyumu) — saha
// onayı sonrası kolonla birlikte kalkar.
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
  /** Yerleşim (şablon-başına, opsiyonel; null = varsayılana dön). */
  lineStepMm?: number | null;
  qrScale?: number | null;
  lengthBanner?: boolean | null;
}

export interface LabelTemplateUpdateInput {
  name?: string;
  isDefault?: boolean;
  isActive?: boolean;
  fields?: TemplateField[];
  rawCode?: RawCodeMap;
  lineStepMm?: number | null;
  qrScale?: number | null;
  lengthBanner?: boolean | null;
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
        deletedAt: null, // KALICI silinenler hiçbir listede görünmez (pasifler görünür)
        ...(opts?.kind ? { kind: opts.kind } : {}),
        ...(opts?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    });
    return { success: true, data: rows };
  }

  async findById(id: string): Promise<ApiResponse<LabelTemplate>> {
    const row = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw AppError.notFound("Template bulunamadı");
    return { success: true, data: row };
  }

  /**
   * Bir bağlam (LabelKind) için varsayılan şablon — tek doğru kaynak
   * LabelContextDefault. Yoksa/pasifse null döner — etiket önizleme endpoint'i
   * bunu görüp catalog default'una düşer.
   */
  async findDefault(kind: LabelKind): Promise<LabelTemplate | null> {
    const def = await prisma.labelContextDefault.findUnique({
      where: { kind },
      include: { template: true },
    });
    if (!def) return null;
    const t = def.template;
    return t.isActive && t.deletedAt == null ? t : null;
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
      // isDefault=true geliyorsa eski kolonda diğerlerini düşür (çift-yazım geri uyumu).
      if (input.isDefault) {
        await tx.labelTemplate.updateMany({
          where: { kind: input.kind, isDefault: true },
          data: { isDefault: false },
        });
      }
      const row = await tx.labelTemplate.create({
        data: {
          name,
          kind: input.kind,
          isDefault: input.isDefault ?? false,
          isActive: input.isActive ?? true,
          fields: fields as unknown as Prisma.InputJsonValue,
          ...(input.rawCode ? { rawCode: normalizeRawCode(input.rawCode) as Prisma.InputJsonValue } : {}),
          lineStepMm: input.lineStepMm ?? null,
          qrScale: input.qrScale ?? null,
          lengthBanner: input.lengthBanner ?? null,
        },
      });
      // Tek doğru kaynak: bağlam varsayılanını LabelContextDefault'a yaz.
      if (input.isDefault) {
        await tx.labelContextDefault.upsert({
          where: { kind: input.kind },
          create: { kind: input.kind, templateId: row.id },
          update: { templateId: row.id },
        });
      }
      return row;
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
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş şablon düzenlenemez veya geri getirilemez");

    // kind null (havuz şablonu, F3+) → kind-whitelist'i yok; birleşik katalog
    // doğrulaması kanvas/varyant katmanında yapılır (validateElements).
    if (input.fields && existing.kind) {
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
    if (input.lineStepMm !== undefined) data.lineStepMm = input.lineStepMm;
    if (input.qrScale !== undefined) data.qrScale = input.qrScale;
    if (input.lengthBanner !== undefined) data.lengthBanner = input.lengthBanner;

    if (input.isDefault === true && !existing.kind) {
      throw AppError.badRequest(
        "Türsüz (havuz) şablonda varsayılan bu uçtan atanamaz — bağlam varsayılanları ekranını kullanın"
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      // isDefault=true'ya çekiliyorsa eski kolonda diğerlerini düşür (çift-yazım).
      if (input.isDefault === true && !existing.isDefault && existing.kind) {
        await tx.labelTemplate.updateMany({
          where: { kind: existing.kind, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      const row = await tx.labelTemplate.update({ where: { id }, data });
      // Tek doğru kaynak senkronu: LabelContextDefault.
      if (input.isDefault === true && existing.kind) {
        await tx.labelContextDefault.upsert({
          where: { kind: existing.kind },
          create: { kind: existing.kind, templateId: id },
          update: { templateId: id },
        });
      } else if (input.isDefault === false && existing.kind) {
        // Bu şablon bağlamın default'uysa kaydı kaldır (bağlam default'suz kalabilir
        // — operatör bilinçli düşürebilir, UI uyarır; eski davranışla birebir).
        await tx.labelContextDefault.deleteMany({
          where: { kind: existing.kind, templateId: id },
        });
      }
      return row;
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
   * Şablonu bağlamın (kind) varsayılanı yapar. Idempotent. Tek doğru kaynak
   * LabelContextDefault; eski isDefault kolonu çift-yazımla senkron tutulur.
   */
  async setDefault(id: string, userId?: string): Promise<ApiResponse<LabelTemplate>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş şablon default yapılamaz");
    if (!existing.isActive) throw AppError.badRequest("Pasif template default yapılamaz");
    if (!existing.kind) {
      throw AppError.badRequest(
        "Türsüz (havuz) şablonda varsayılan bu uçtan atanamaz — bağlam varsayılanları ekranını kullanın"
      );
    }
    const kind = existing.kind;
    const current = await prisma.labelContextDefault.findUnique({ where: { kind } });
    if (existing.isDefault && current?.templateId === id) {
      return { success: true, data: existing, message: "Zaten default" };
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.labelTemplate.updateMany({
        where: { kind, isDefault: true },
        data: { isDefault: false },
      });
      await tx.labelContextDefault.upsert({
        where: { kind },
        create: { kind, templateId: id },
        update: { templateId: id },
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
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş şablon pasifleştirilemez");
    const asDefault = await prisma.labelContextDefault.findFirst({ where: { templateId: id } });
    if (asDefault || existing.isDefault) {
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
   * KALICI silme — fiziksel DELETE DEĞİL (deletedAt kalıbı): satır veri bütünlüğü
   * için durur, hiçbir listede görünmez, geri getirilemez. Ad DEL- önekiyle serbest
   * kalır (kind+name unique); cihaz şablon yönlendirmeleri silinir (pivot istisnası).
   * Default şablon silinemez — önce başka şablon default yapılmalı.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<{ deleted: true }>> {
    const existing = await prisma.labelTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Template bulunamadı");
    if (existing.deletedAt) {
      return { success: true, data: { deleted: true }, message: "Zaten silinmiş" }; // idempotent
    }
    const asDefault = await prisma.labelContextDefault.findFirst({ where: { templateId: id } });
    if (asDefault || existing.isDefault) {
      throw AppError.badRequest(
        "Default template kalıcı silinemez — önce başka bir template'i default yapın"
      );
    }
    const freedName = `DEL-${Date.now().toString(36).toUpperCase()} ${existing.name}`.slice(0, 100);
    await prisma.$transaction(async (tx) => {
      await tx.peripheralTemplateRoute.deleteMany({ where: { templateId: id } });
      // Müşteri atamaları da temizlenir — öksüz atama müşteriyi sessizce default'a
      // düşürmesin (cihaz route temizliğiyle simetrik).
      await tx.customerTemplateRoute.deleteMany({ where: { templateId: id } });
      await tx.labelTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, name: freedName },
      });
    });
    await AuditService.log({
      userId, action: "DELETE", tableName: TABLE, recordId: id,
      oldData: existing as unknown as Record<string, unknown>,
      newData: { deletedAt: new Date().toISOString(), freedName },
    }).catch(() => undefined);
    return { success: true, data: { deleted: true }, message: "Şablon kalıcı olarak silindi (kayıt veri bütünlüğü için saklanır)" };
  }

  /**
   * Bu tür + dil için OTOMATİK ÜRETİLEN kodu, düzenlenebilir {{}} yer-tutuculu şablon
   * olarak döner ("Varsayılan kodu getir"). Auto çıktısındaki görünen alan değerlerini
   * ({{key}}) yer-tutucusuna geri çevirir → uzman bunu kopyalayıp/düzenleyip kaydeder.
   */
  async getDefaultCode(kind: LabelKind, language: PrinterLanguage): Promise<ApiResponse<{ code: string }>> {
    const payload = mockPayload(kind);
    const tpl = await this.findDefault(kind);
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

  /** Bu tür için önerilen VARSAYILAN tasarım — "Varsayılana dön" butonu bunu uygular.
   *  Alanlar: katalog default'u. Yerleşim: dengeli satır aralığı + QR + metraj bandı
   *  (ROLL türlerinde açık, SWATCH'ta kapalı — metraj yok). */
  getTemplateDefaults(kind: LabelKind): ApiResponse<{
    fields: TemplateField[];
    lineStepMm: number;
    qrScale: number;
    lengthBanner: boolean;
  }> {
    if (!FIELD_CATALOG[kind]) throw AppError.badRequest("Bilinmeyen LabelKind");
    return {
      success: true,
      data: {
        fields: buildDefaultFields(kind),
        lineStepMm: 1.5, // satırlar arası dengeli ek boşluk (mm)
        qrScale: 5, // okunur QR (~20mm ayak izi)
        lengthBanner: kind !== LabelKind.SWATCH, // sağ dikey metraj bandı — top'ta açık
      },
    };
  }

  /**
   * "Alanlar" sekmesi canlı önizlemesi — AKTİF DİLDE (WYSIWYG). Verilen (kaydedilmemiş)
   * alanlarla + sistem varsayılan geometrisiyle render eder. Native dil (PPLB) → görsel
   * SVG (baskıyla birebir); HTML dili → HTML; çizilemeyen native → ham komut metni.
   */
  async getFieldsPreview(
    kind: LabelKind,
    fields: TemplateField[],
    layout?: { lineStepMm?: number | null; qrScale?: number | null; lengthBanner?: boolean | null },
  ): Promise<
    ApiResponse<{
      mode: "svg" | "html" | "text";
      language: PrinterLanguage;
      content: string;
      /** Ham yazıcı kodu — "Kod" görünümü için (alan değişimi → koda etkisi görünür). */
      native: string;
    }>
  > {
    const payload = mockPayload(kind);
    // Yerleşim (satır aralığı + QR + metraj bandı) canlı önizlemeye yansısın → template'e göm.
    const template = {
      kind,
      fields,
      rawCode: null,
      lineStepMm: layout?.lineStepMm ?? null,
      qrScale: layout?.qrScale ?? null,
      lengthBanner: layout?.lengthBanner ?? null,
    } as unknown as LabelTemplate;
    const format = await resolveLabelFormat({ kind });
    const barcodeSvg = bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    const input = { payload, template, barcodeSvg, qrSvg, copies: 1, format };
    const language = format.language;
    if (language === PrinterLanguage.RASTER_HTML) {
      const html = renderLabel(language, input).content;
      return { success: true, data: { mode: "html", language, content: html, native: html } };
    }
    const native = renderLabel(language, input).content;
    const svg = renderNativePreviewSvg(language, native, mmToDots(format.widthMm, format.dpi));
    if (svg) return { success: true, data: { mode: "svg", language, content: svgToPreviewHtml(svg), native } };
    return { success: true, data: { mode: "text", language, content: native, native } };
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
