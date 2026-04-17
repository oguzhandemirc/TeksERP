// =============================================================================
// TeksERP - WorkOrder Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { WorkOrderService } from "../services/workorder.service";
import "../types/express-augment";

const createSchema = z.object({
  batchNumber:       z.string().trim().min(1).optional().nullable(),
  type:              z.enum(["ORDER_PRODUCTION", "STOCK_PRODUCTION", "SAMPLE_PRODUCTION", "REPAIR_REWORK"]).default("ORDER_PRODUCTION"),
  width:             z.number().positive("En değeri pozitif olmalı").optional().nullable(),
  targetQuantity:    z.number().positive().optional().nullable(),
  recipeNo:          z.string().max(100).optional().nullable(),
  parameters:        z.record(z.string(), z.unknown()).optional().nullable(),
  plannedStartDate:  z.string().optional().nullable(),
  plannedEndDate:    z.string().optional().nullable(),
  routeTemplateId:   z.string().uuid().optional().nullable(),
  dyehouseCompanyId: z.string().uuid().optional().nullable(),
  steps: z
    .array(z.object({
      stationId: z.string().uuid("Geçersiz istasyon ID"),
      notes:     z.string().max(500).optional().nullable(),
    }))
    .optional(),
  orderLineAllocations: z
    .array(z.object({
      orderLineId:  z.string().uuid(),
      allocatedQty: z.number().nonnegative().optional(),
    }))
    .optional(),
  orderLineIds: z.array(z.string().uuid()).optional().nullable(),
}).refine(
  (d) => Boolean(d.routeTemplateId) || (d.steps && d.steps.length > 0),
  { message: "routeTemplateId veya en az bir step gerekli", path: ["steps"] },
);

const attachRollsSchema = z.object({
  barcodes: z
    .array(z.string().min(1))
    .min(1, "En az bir barkod gerekli"),
});

const detachRollsSchema = z.object({
  rollIds: z
    .array(z.string().uuid())
    .min(1, "En az bir top (roll) id'si gerekli"),
});


export class WorkOrderController {
  private service: WorkOrderService;

  constructor() {
    this.service = new WorkOrderService();
    this.create = this.create.bind(this);
    this.findAll = this.findAll.bind(this);
    this.findById = this.findById.bind(this);
    this.attachRolls = this.attachRolls.bind(this);
    this.detachRolls = this.detachRolls.bind(this);
    this.lockWorkOrder = this.lockWorkOrder.bind(this);
    this.getAttachedRolls = this.getAttachedRolls.bind(this);
    this.getTravelCard = this.getTravelCard.bind(this);
    this.getManifest = this.getManifest.bind(this);
    this.createManifest = this.createManifest.bind(this);
    this.listManifests = this.listManifests.bind(this);
    this.softDelete = this.softDelete.bind(this);
    this.hardDelete = this.hardDelete.bind(this);
    this.findAvailableForAttach = this.findAvailableForAttach.bind(this);
  }

  /**
   * POST /api/work-orders
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createSchema.parse(req.body);
      const result = await this.service.create(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders
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
   * GET /api/work-orders/:id
   */
  async findById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findById(req.params.id as string);
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
   * PATCH /api/work-orders/:id/attach-rolls
   */
  async attachRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = attachRollsSchema.parse(req.body);
      const result = await this.service.attachRolls(
        req.params.id as string,
        body.barcodes,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/work-orders/:id/detach-rolls
   */
  async detachRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = detachRollsSchema.parse(req.body);
      const result = await this.service.detachRolls(
        req.params.id as string,
        body.rollIds,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/work-orders/:id/lock
   */
  async lockWorkOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.lockWorkOrder(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/rolls
   */
  async getAttachedRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getAttachedRolls(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }


  /**
   * GET /api/work-orders/:id/travel-card
   */
  async getTravelCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getTravelCard(req.params.id as string);
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
   * GET /api/work-orders/:id/manifest
   */
  async getManifest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getManifest(req.params.id as string);
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
   * POST /api/work-orders/:id/manifest
   * Kalıcı Çeki Listesi belgesi oluşturur.
   */
  async createManifest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;
      const result = await this.service.createManifest(
        req.params.id as string,
        req.user?.userId,
        notes
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/:id/manifests
   * Geçmiş tüm manifest belgeleri.
   */
  async listManifests(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listManifests(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/work-orders/:id
   * Soft-delete: sets status = CANCELLED
   */
  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.softDelete(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/work-orders/:id/permanent
   * Hard-delete: physically removes the record from the database
   */
  async hardDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.hardDelete(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/work-orders/available-for-attach
   * List work orders that are PLANNED and ready for roll attachment.
   */
  async findAvailableForAttach(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findAvailableForAttach();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
