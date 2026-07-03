// =============================================================================
// TeksERP - Label Template Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LabelKind, PrinterLanguage } from "@prisma/client";
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

const createSchema = z.object({
  name:       z.string().min(1).max(200),
  kind:       z.nativeEnum(LabelKind),
  isDefault:  z.boolean().optional(),
  isActive:   z.boolean().optional(),
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

export class LabelTemplateController {
  private service = new LabelTemplateService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kindRaw = req.query.kind as string | undefined;
      const kind = kindRaw && Object.values(LabelKind).includes(kindRaw as LabelKind)
        ? (kindRaw as LabelKind)
        : undefined;
      const includeInactive = req.query.includeInactive === "true";
      const result = await this.service.findAll({ kind, includeInactive });
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

  /** "Alanlar" sekmesi canlı önizlemesi — verilen alanları AKTİF DİLDE render eder. */
  fieldsPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
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
