// =============================================================================
// TeksERP - Base Controller (Generic CRUD Endpoints)
// =============================================================================
// Master Data endpoints (Items, Customers, Stations, Routes) extend this.
// No additional backend code is needed for basic CRUD (core-architecture.md).
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { BaseService } from "../services/base.service";
import { AppError } from "../utils/app-error";

/** Safely extract a single string param from Express 5 params */
function getParamId(req: Request): string {
  const id = req.params.id;
  if (Array.isArray(id)) throw AppError.badRequest("Geçersiz ID parametresi");
  return id;
}

export class BaseController {
  protected service: BaseService;

  constructor(service: BaseService) {
    this.service = service;
    // Bind methods to preserve `this` context when used as route handlers
    this.findAll = this.findAll.bind(this);
    this.findById = this.findById.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.remove = this.remove.bind(this);
    this.hardRemove = this.hardRemove.bind(this);
  }

  /**
   * GET / — List with filtering, sorting, pagination.
   */
  async findAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findAll(req);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /:id — Find by ID.
   */
  async findById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findById(getParamId(req));
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST / — Create new record.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.create(req.body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /:id — Update existing record.
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.update(getParamId(req), req.body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /:id — Soft-delete (set isActive = false).
   */
  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.softDelete(getParamId(req), req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /:id/permanent — Hard-delete (physically remove from database).
   */
  async hardRemove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.hardDelete(getParamId(req), req.user?.userId);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
