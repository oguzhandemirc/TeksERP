// =============================================================================
// TeksERP - Base Controller (Generic CRUD Endpoints)
// =============================================================================
// Master Data endpoints (Items, Customers, Stations, Routes) extend this.
// No additional backend code is needed for basic CRUD (bkz. Teks-Erp/CLAUDE.md + ARCHITECTURE.md §8.1).
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { BaseService } from "../services/base.service";
import { AppError } from "../utils/app-error";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";

/** Safely extract `:id` param and doğrula UUID format. */
function getParamId(req: Request): string {
  const id = req.params.id;
  if (Array.isArray(id)) throw AppError.badRequest("Geçersiz ID parametresi");
  return assertValidUuid(id, "id");
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
    this.similarNames = this.similarNames.bind(this);
  }

  /**
   * GET /similar-names?name=... — mükerreri ÖNLEMEK için benzer kayıt listesi.
   *
   * ⚠️ HİÇBİR ŞEYİ ENGELLEMEZ, karar vermez, yazmaz. Arayüz kullanıcı adı
   * yazarken çağırır ve "şunlar zaten var" diye gösterir. Kaydetmeyi engelleyen
   * tek şey `assertNameNotDuplicate`tir (birebir aynı ad → 409) ve o ayrı yerde.
   *
   * ⚠️ Yol `/:id`den ÖNCE tanımlanmalı, yoksa Express "similar-names"i id sanar
   * ve `uuid-param` middleware'i 400 döndürür.
   *
   * `?excludeId=` düzenleme ekranı içindir: kaydın kendisi "benzer" diye
   * gösterilmemeli. `?scope=` kapsamlı tekillikte (makine → istasyon,
   * şube → müşteri) aramayı o kapsamla sınırlar.
   */
  async similarNames(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const name = typeof req.query.name === "string" ? req.query.name : "";
      const excludeId = typeof req.query.excludeId === "string" ? req.query.excludeId : undefined;
      const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
      const data = await this.service.findSimilarNames(name, {
        ...(excludeId ? { excludeId } : {}),
        ...(scope ? { scopeValue: scope } : {}),
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
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
