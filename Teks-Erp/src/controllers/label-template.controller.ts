// =============================================================================
// TeksERP - Label Template Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LabelKind, PrinterLanguage } from "@prisma/client";
import { labelKindSchema } from "../config/label-kind.schema";
import { LabelTemplateService } from "../services/label-template.service";
import { buildRawCodePreview } from "../services/helpers/label-rawcode";
import "../types/express-augment";

const fieldSchema = z.object({
  key:       z.string().min(1).max(100),
  label:     z.string().max(200), // boş bırakılabilir → çıktıda yalnız değer görünür
  order:     z.number().int().positive(),
  isVisible: z.boolean(),
  isBold:    z.boolean().optional(),
  fontSize:  z.enum(["sm", "md", "lg", "xl"]).optional(),
});

// Uzman raw-code override (dil→kod). Boş/yok → o dilde otomatik üretim.
const rawCodeSchema = z
  .object({
    PPLA:        z.string().max(20000).optional(),
    PPLB:        z.string().max(20000).optional(),
    ZPL:         z.string().max(20000).optional(),
    RASTER_HTML: z.string().max(20000).optional(),
  })
  .partial();

// Şablon-başına yerleşim ayarları — null = temizle (varsayılana dön).
const lineStepMmSchema = z.number().min(0).max(20).nullable().optional();
const qrScaleSchema = z.number().int().min(2).max(15).nullable().optional();
const lengthBannerSchema = z.boolean().nullable().optional();

/** Test edilebilirlik için dışa açık (controller Zod katmanı = HTTP kontrat sınırı). */
export const createSchema = z.object({
  name:       z.string().min(1).max(200),
  // Türlü şablonda zorunlu; serbest (statik) şablonda verilmez (kind null doğar).
  // Zorunluluk servis katmanında (standalone değilse kind şart) uygulanır.
  // nullish: istemci serbest etiket için açıkça kind:null gönderebilir (undefined da geçer).
  kind:       z.nativeEnum(LabelKind).nullish(),
  isDefault:  z.boolean().optional(),
  isActive:   z.boolean().optional(),
  standalone: z.boolean().optional(),
  fields:     z.array(fieldSchema).optional(),
  rawCode:    rawCodeSchema.optional(),
  lineStepMm: lineStepMmSchema,
  qrScale:    qrScaleSchema,
  lengthBanner: lengthBannerSchema,
});

const updateSchema = z.object({
  name:       z.string().min(1).max(200).optional(),
  isDefault:  z.boolean().optional(),
  isActive:   z.boolean().optional(),
  standalone: z.boolean().optional(),
  fields:     z.array(fieldSchema).optional(),
  rawCode:    rawCodeSchema.optional(),
  lineStepMm: lineStepMmSchema,
  qrScale:    qrScaleSchema,
  lengthBanner: lengthBannerSchema,
});

const previewRawSchema = z.object({
  kind:     z.nativeEnum(LabelKind),
  language: z.nativeEnum(PrinterLanguage),
  code:     z.string().max(20000),
});

// Kanvas önizleme gövdesi (Etiket Stüdyosu v2) — hafif kabuk; eleman-düzeyi
// doğrulama servistedir (validateCanvasLayout, Türkçe mesajlar).
// NEDEN `labelKindSchema` (2026-07-31 denetimi): burada elle yazılmış LabelKind
// listesi vardı ve `as [string, ...string[]]` cast'i yüzünden çıktı tipi `string`e
// düşüyordu — yani yeni bir LabelKind eklenip liste unutulsa DERLEME de uyarmazdı,
// uç yeni türü sessizce reddederdi. Tek kaynak: config/label-kind.schema.ts.
// (PrinterLanguage aynası hâlâ elle — ayrı bulgu, bu deploy kapsamı dışı.)
const canvasPreviewSchema = z.object({
  kind: labelKindSchema,
  widthMm: z.number().min(10).max(500),
  heightMm: z.number().min(10).max(500),
  elements: z.unknown(),
  language: z.enum(["PPLA", "PPLB", "ZPL", "RASTER_HTML"] as [string, ...string[]]).optional(),
  // "Bu Bilgisayar"da seçili Cihaz Kaydı yazıcısı — dil/medya bu cihazdan çözülür.
  peripheralId: z.string().uuid().optional(),
  // Baskı adedi (test/bağımsız baskı çoğaltma) — verilmedi = 1.
  copies: z.number().int().min(1).max(100).optional(),
  // Örnek topun kalite KODU — koşullu (showIf) elemanların önizlemede nasıl
  // davrandığını görmek için. Boş metin = "kalitesi belirsiz top" senaryosu
  // (koşullu eleman basılmaz) → `.optional()` ile "gönderilmedi"den ayrılır.
  qualityGrade: z.string().max(32).optional(),
});

// Boyut varyantı gövdeleri — eleman-düzeyi doğrulama serviste (validateCanvasLayout).
const variantCreateSchema = z.object({
  name: z.string().max(60).optional(),
  widthMm: z.number().min(10).max(500),
  heightMm: z.number().min(10).max(500),
  copyFromVariantId: z.string().uuid().nullable().optional(),
  elements: z.unknown().optional(),
});

const variantUpdateSchema = z.object({
  name: z.string().max(60).optional(),
  widthMm: z.number().min(10).max(500).optional(),
  heightMm: z.number().min(10).max(500).optional(),
  elements: z.unknown().optional(),
});

// Bağlam varsayılanı ("bu tür etikette hangi şablon") — kind tek kaynaktan gelir
// (bkz. config/label-kind.schema.ts); elle liste tutulmaz.
const contextDefaultSchema = z.object({
  kind: labelKindSchema,
  templateId: z.string().uuid().nullable(),
});

// İçe aktarma zarfı — eleman-düzeyi doğrulama serviste (validateCanvasLayout).
const importSchema = z.object({
  template: z.object({
    name: z.string().min(1).max(200),
    kind: z.nativeEnum(LabelKind).nullish(),
    standalone: z.boolean().optional(),
    fields: z.array(fieldSchema).optional(),
    rawCode: rawCodeSchema.optional(),
    lineStepMm: lineStepMmSchema,
    qrScale: qrScaleSchema,
    lengthBanner: lengthBannerSchema,
  }),
  variants: z.array(
    z.object({
      name: z.string().max(60).optional(),
      widthMm: z.number().min(10).max(500),
      heightMm: z.number().min(10).max(500),
      isPrimary: z.boolean().optional(),
      elements: z.unknown(),
    }),
  ),
});

export class LabelTemplateController {
  private service = new LabelTemplateService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindRaw = req.query.kind as string | undefined;
      const kind = kindRaw && Object.values(LabelKind).includes(kindRaw as LabelKind)
        ? (kindRaw as LabelKind)
        : undefined;
      const includeInactive = req.query.includeInactive === "true";
      // ?standalone=true → baskı seçicisi (yalnız serbest); ?assignable=true → atama
      // seçicileri (serbest OLMAYAN). Yalnız "true" string'i açar (aksi = undefined).
      const standalone = req.query.standalone === "true" ? true : undefined;
      const assignable = req.query.assignable === "true" ? true : undefined;
      const result = await this.service.findAll({ kind, includeInactive, standalone, assignable });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.findById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  catalog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindRaw = req.params.kind as string;
      if (!Object.values(LabelKind).includes(kindRaw as LabelKind)) {
        res.status(400).json({ success: false, message: "Geçersiz LabelKind" });
        return;
      }
      const result = this.service.getCatalog(kindRaw as LabelKind);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** "Varsayılana dön" — bu tür için önerilen alanlar + yerleşim (metraj bandı dahil). */
  defaults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindRaw = req.params.kind as string;
      if (!Object.values(LabelKind).includes(kindRaw as LabelKind)) {
        res.status(400).json({ success: false, message: "Geçersiz LabelKind" });
        return;
      }
      res.status(200).json(this.service.getTemplateDefaults(kindRaw as LabelKind));
    } catch (e) { next(e); }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createSchema.parse(req.body);
      const result = await this.service.create(body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateSchema.parse(req.body);
      const result = await this.service.update(req.params.id as string, body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Uzman raw-code önizlemesi — sahte veri + verilen kodu ikame edip ham çıktıyı döner. */
  previewRaw = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, language, code } = previewRawSchema.parse(req.body);
      const { content, contentType } = buildRawCodePreview(kind, language, code);
      res.status(200).type(contentType).send(content);
    } catch (e) { next(e); }
  };

  /** Canlı önizleme — İKİ gövde kabul eder:
   *  v2 (kanvas): { kind, widthMm, heightMm, elements, language? } — Etiket Stüdyosu.
   *  v1 (akış):   { kind, fields, lineStepMm?, qrScale?, lengthBanner? } — eski editör
   *  gövdesi geçiş boyunca çalışmaya devam eder. */
  fieldsPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.body && typeof req.body === "object" && "elements" in req.body) {
        const body = canvasPreviewSchema.parse(req.body);
        const result = await this.service.getCanvasPreview({
          // cast GEREKMEZ — labelKindSchema doğrudan LabelKind döndürür.
          kind: body.kind,
          widthMm: body.widthMm,
          heightMm: body.heightMm,
          elements: body.elements,
          language: body.language as PrinterLanguage | undefined,
          peripheralId: body.peripheralId,
          copies: body.copies,
          qualityGrade: body.qualityGrade,
        });
        res.status(200).json(result);
        return;
      }
      const { kind, fields, lineStepMm, qrScale, lengthBanner } = z
        .object({
          kind: z.nativeEnum(LabelKind),
          fields: z.array(fieldSchema),
          lineStepMm: lineStepMmSchema,
          qrScale: qrScaleSchema,
          lengthBanner: lengthBannerSchema,
        })
        .parse(req.body);
      const result = await this.service.getFieldsPreview(kind, fields, { lineStepMm, qrScale, lengthBanner });
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  /** Bu tür+dil için otomatik üretilen kodu {{}} yer-tutuculu şablon olarak döner. */
  defaultCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, language } = z
        .object({ kind: z.nativeEnum(LabelKind), language: z.nativeEnum(PrinterLanguage) })
        .parse({ kind: req.query.kind, language: req.query.language });
      const result = await this.service.getDefaultCode(kind, language);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setDefault = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.setDefault(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- Dışa/İçe aktar + çoğalt (JSON zarf) ----

  exportTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await this.service.exportTemplate(req.params.id as string));
    } catch (e) { next(e); }
  };

  importTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = importSchema.parse(req.body);
      const result = await this.service.importTemplate(body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  duplicate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.duplicateTemplate(req.params.id as string, req.user?.userId);
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  // ---- Boyut varyantları (Etiket Stüdyosu v2) ----

  listVariants = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await this.service.listVariants(req.params.id as string));
    } catch (e) { next(e); }
  };

  createVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = variantCreateSchema.parse(req.body);
      const result = await this.service.createVariant(req.params.id as string, body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) { next(e); }
  };

  updateVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = variantUpdateSchema.parse(req.body);
      const result = await this.service.updateVariant(req.params.variantId as string, body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  deleteVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.deleteVariant(req.params.variantId as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  setPrimaryVariant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.setPrimaryVariant(req.params.variantId as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  // ---- Bağlam varsayılanları + birleşik katalog ----

  listContextDefaults = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await this.service.listContextDefaults());
    } catch (e) { next(e); }
  };

  setContextDefault = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = contextDefaultSchema.parse(req.body);
      const result = await this.service.setContextDefault(
        // cast GEREKMEZ — labelKindSchema doğrudan LabelKind döndürür.
        body.kind,
        body.templateId,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  unifiedCatalog = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(this.service.getUnifiedCatalogResponse());
    } catch (e) { next(e); }
  };

  /** Bakım sembolü kataloğu — editör ikon paleti (kategoriler + anahtar/başlık/SVG). */
  iconCatalog = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(this.service.getIconCatalog());
    } catch (e) { next(e); }
  };

  deactivate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.deactivate(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };

  hardDelete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.hardDelete(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) { next(e); }
  };
}
