// =============================================================================
// TeksERP - Shipping Queue Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ShippingQueueStatus } from "@prisma/client";
import { ShippingQueueService } from "../services/shipping-queue.service";
import "../types/express-augment";

const enqueueSchema = z.object({
  orderId: z.string().uuid("Geçersiz sipariş ID"),
  isUrgent: z.boolean().optional(),
  note: z.string().max(500).nullish(),
});

const listQuerySchema = z.object({
  status: z.union([z.nativeEnum(ShippingQueueStatus), z.literal("ALL")]).optional(),
  operatorId: z.string().uuid().optional(),
});

const setUrgentSchema = z.object({
  isUrgent: z.boolean(),
});

const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        priority: z.number().int().min(0),
      }),
    )
    .min(1),
});

const cancelSchema = z.object({
  reason: z.string().max(500).nullish(),
});

export class ShippingQueueController {
  private service: ShippingQueueService;

  constructor() {
    this.service = new ShippingQueueService();
    this.list = this.list.bind(this);
    this.enqueue = this.enqueue.bind(this);
    this.setUrgent = this.setUrgent.bind(this);
    this.reorder = this.reorder.bind(this);
    this.cancel = this.cancel.bind(this);
    this.takeNext = this.takeNext.bind(this);
    this.takeById = this.takeById.bind(this);
    this.release = this.release.bind(this);
    this.complete = this.complete.bind(this);
    this.getRequirements = this.getRequirements.bind(this);
  }

  /** GET /api/shipping-queue */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const params = listQuerySchema.parse(req.query);
      const result = await this.service.list(params);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/shipping-queue */
  async enqueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = enqueueSchema.parse(req.body);
      const result = await this.service.enqueue(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/shipping-queue/:id/urgent */
  async setUrgent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { isUrgent } = setUrgentSchema.parse(req.body);
      const id = req.params.id as string;
      const result = await this.service.setUrgent(id, isUrgent, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/shipping-queue/reorder */
  async reorder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { items } = reorderSchema.parse(req.body);
      const result = await this.service.reorder(items, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/shipping-queue/:id */
  async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reason } = cancelSchema.parse(req.body ?? {});
      const id = req.params.id as string;
      const result = await this.service.cancel(id, reason ?? null, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/shipping-queue/take-next */
  async takeNext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.takeNext(req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/shipping-queue/:id/take */
  async takeById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.takeById(id, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/shipping-queue/:id/release */
  async release(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.release(id, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/shipping-queue/:id/complete */
  async complete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.complete(id, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/shipping-queue/:id/requirements */
  async getRequirements(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.getRequirements(id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
