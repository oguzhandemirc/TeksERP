// =============================================================================
// TeksERP - Label Template Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { LabelKind } from "@prisma/client";
import { LabelTemplateService } from "../services/label-template.service";
import "../types/express-augment";

const fieldSchema = z.object({
  key:       z.string().min(1).max(100),
  label:     z.string().min(1).max(200),
  order:     z.number().int().positive(),
  isVisible: z.boolean(),
  isBold:    z.boolean().optional(),
  fontSize:  z.enum(["sm", "md", "lg", "xl"]).optional(),
});

const createSchema = z.object({
  name:      z.string().min(1).max(200),
  kind:      z.nativeEnum(LabelKind),
  isDefault: z.boolean().optional(),
  isActive:  z.boolean().optional(),
  fields:    z.array(fieldSchema).optional(),
});

const updateSchema = z.object({
  name:      z.string().min(1).max(200).optional(),
  isDefault: z.boolean().optional(),
  isActive:  z.boolean().optional(),
  fields:    z.array(fieldSchema).optional(),
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
}
