// =============================================================================
// TeksERP - Subcontractor Management Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  SubcontractorCategoryService,
  SubcontractorManagementService,
} from "../services/subcontractor-management.service";
import "../types/express-augment";

// ─── Subcontractor Schemas ──────────────────────────────────────────────────

const createSubcontractorSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  taxNumber: z.string().trim().max(32).optional(),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(500).optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
});

const updateSubcontractorSchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(255).optional(),
  taxNumber: z.string().trim().max(32).nullish(),
  phone: z.string().trim().max(32).nullish(),
  address: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
});

// ─── Category Schemas ───────────────────────────────────────────────────────

const createCategorySchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(500).optional(),
});

const updateCategorySchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
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
      res.json(await this.service.findById(req.params.id as string));
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
      res.json(await this.service.update(req.params.id as string, body, req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.remove(req.params.id as string, req.user?.userId));
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
      res.json(await this.service.findById(req.params.id as string));
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
      res.json(await this.service.update(req.params.id as string, body, req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await this.service.remove(req.params.id as string, req.user?.userId));
    } catch (e) {
      next(e);
    }
  };
}
