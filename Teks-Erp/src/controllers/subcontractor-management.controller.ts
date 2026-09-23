// =============================================================================
// TeksERP - Subcontractor Management Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  SubcontractorCategoryService,
  SubcontractorManagementService,
} from "../services/subcontractor-management.service";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import "../types/express-augment";

// ─── Subcontractor Schemas ──────────────────────────────────────────────────

// Kod OPSİYONEL: boş/verilmemişse sunucu üretir (`ensureSubCode` → FSN/KAT serisi). Zorunlu tutmak panelin
// kodsuz "Yeni" kaydını 400'e düşürüyordu (K20, 2026-09-23 — servis bekçisi controller'ı görmüyordu).
const createSubcontractorSchema = z.object({
  code: z.string().trim().max(64, "Kod en fazla 64 karakter olabilir").optional(),
  name: z.string().trim().min(1, "Fason adı boş bırakılamaz").max(255, "Fason adı en fazla 255 karakter olabilir"),
  taxNumber: z.string().trim().max(32, "Vergi numarası en fazla 32 karakter olabilir").nullish(),
  phone: z.string().trim().max(32, "Telefon en fazla 32 karakter olabilir").nullish(),
  address: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir").nullish(),
  isFavorite: z.boolean().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  // Fason = carinin rolü: bağlı cari (uuid) ya da null (bağsız). Tip/tekillik kuralı serviste.
  customerId: z.string().uuid("Cari kimliği geçersiz").nullable().optional(),
});

const updateSubcontractorSchema = z.object({
  code: z.string().trim().min(1, "Kod boş bırakılamaz").max(64, "Kod en fazla 64 karakter olabilir").optional(),
  name: z.string().trim().min(1, "Fason adı boş bırakılamaz").max(255, "Fason adı en fazla 255 karakter olabilir").optional(),
  taxNumber: z.string().trim().max(32, "Vergi numarası en fazla 32 karakter olabilir").nullish(),
  phone: z.string().trim().max(32, "Telefon en fazla 32 karakter olabilir").nullish(),
  address: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir").nullish(),
  isActive: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
  customerId: z.string().uuid("Cari kimliği geçersiz").nullable().optional(),
});

// ─── Category Schemas ───────────────────────────────────────────────────────

const createCategorySchema = z.object({
  code: z.string().trim().max(64, "Kod en fazla 64 karakter olabilir").optional(),
  name: z.string().trim().min(1, "Kategori adı boş bırakılamaz").max(128, "Kategori adı en fazla 128 karakter olabilir"),
  // Panel boş açıklamayı `null` gönderir (güncelleme şemasıyla aynı sözleşme).
  description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir").nullish().transform((v) => v ?? undefined),
  appliesColor: z.boolean().optional(),
  appliesProperty: z.boolean().optional(),
});

const updateCategorySchema = z.object({
  code: z.string().trim().min(1, "Kod boş bırakılamaz").max(64, "Kod en fazla 64 karakter olabilir").optional(),
  name: z.string().trim().min(1, "Kategori adı boş bırakılamaz").max(128, "Kategori adı en fazla 128 karakter olabilir").optional(),
  description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir").nullish(),
  isActive: z.boolean().optional(),
  appliesColor: z.boolean().optional(),
  appliesProperty: z.boolean().optional(),
});

// ─── Controllers ────────────────────────────────────────────────────────────

export class SubcontractorManagementController {
  private service = new SubcontractorManagementService();

  findAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.findAll(req));
    } catch (e) {
      next(e);
    }
  };
  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.findById(assertValidUuid(req.params.id)));
    } catch (e) {
      next(e);
    }
  };
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createSubcontractorSchema.parse(req.body);
      res.status(201).json(await this.service.create(body, req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateSubcontractorSchema.parse(req.body);
      res.json(await this.service.update(assertValidUuid(req.params.id), body, req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.remove(assertValidUuid(req.params.id), req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
}

export class SubcontractorCategoryController {
  private service = new SubcontractorCategoryService();

  findAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.findAll(req));
    } catch (e) {
      next(e);
    }
  };
  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.findById(assertValidUuid(req.params.id)));
    } catch (e) {
      next(e);
    }
  };
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createCategorySchema.parse(req.body);
      res.status(201).json(await this.service.create(body, req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = updateCategorySchema.parse(req.body);
      res.json(await this.service.update(assertValidUuid(req.params.id), body, req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.remove(assertValidUuid(req.params.id), req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
}
