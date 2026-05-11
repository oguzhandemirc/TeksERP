// =============================================================================
// TeksERP - Packaging Queue Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PackagingQueueStatus } from "@prisma/client";
import { PackagingQueueService } from "../services/packaging-queue.service";
import "../types/express-augment";

const listQuerySchema = z.object({
  status: z
    .union([z.nativeEnum(PackagingQueueStatus), z.literal("ALL")])
    .optional(),
});

const addSchema = z.object({
  rollId: z.string().uuid("Geçersiz rulo ID"),
  plannedOrderId: z.string().uuid("Geçersiz sipariş ID").nullable().optional(),
  priority: z.number().int().optional(),
  note: z.string().max(500).optional().nullable(),
});

const bulkAddSchema = z.object({
  items: z
    .array(
      z.object({
        rollId: z.string().uuid(),
        plannedOrderId: z.string().uuid().nullable().optional(),
        note: z.string().max(500).optional().nullable(),
      })
    )
    .min(1, "En az bir rulo gerekli")
    .max(200, "Tek seferde en fazla 200 rulo"),
});

const updatePlannedOrderSchema = z.object({
  plannedOrderId: z.string().uuid().nullable(),
});

const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        priority: z.number().int(),
      })
    )
    .min(1, "En az bir kayıt gerekli"),
});

const removeSchema = z.object({
  cancelReason: z.string().max(500).optional().nullable(),
});

const availableQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const urgentSchema = z.object({
  isUrgent: z.boolean(),
});

const candidatesQuerySchema = z.object({
  onlyMatching: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  search: z.string().trim().min(1).max(100).optional(),
});

const assignRollsSchema = z.object({
  rollIds: z.array(z.string().uuid()).min(1, "En az bir rulo seçin").max(200),
  note: z.string().max(500).optional().nullable(),
});

export class PackagingQueueController {
  private service: PackagingQueueService;

  constructor() {
    this.service = new PackagingQueueService();
    this.getQueue = this.getQueue.bind(this);
    this.addToQueue = this.addToQueue.bind(this);
    this.bulkAdd = this.bulkAdd.bind(this);
    this.updatePlannedOrder = this.updatePlannedOrder.bind(this);
    this.reorder = this.reorder.bind(this);
    this.remove = this.remove.bind(this);
    this.takeNext = this.takeNext.bind(this);
    this.getAvailable = this.getAvailable.bind(this);
    this.takeById = this.takeById.bind(this);
    this.setUrgent = this.setUrgent.bind(this);
    this.getOrderCandidates = this.getOrderCandidates.bind(this);
    this.assignRollsToOrder = this.assignRollsToOrder.bind(this);
  }

  /** GET /api/packaging-queue/orders/:orderId/candidates */
  async getOrderCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { onlyMatching, search } = candidatesQuerySchema.parse(req.query);
      const result = await this.service.getOrderCandidates(req.params.orderId as string, {
        onlyMatching,
        search,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/packaging-queue/orders/:orderId/assign-rolls */
  async assignRollsToOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rollIds, note } = assignRollsSchema.parse(req.body);
      const result = await this.service.assignRollsToOrder(
        req.params.orderId as string,
        rollIds,
        note ?? null,
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/packaging-queue/bulk — planner toplu rulo ekler */
  async bulkAdd(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = bulkAddSchema.parse(req.body);
      const result = await this.service.bulkAdd(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/packaging-queue/:id/planned-order — atanan siparişi değiştir */
  async updatePlannedOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { plannedOrderId } = updatePlannedOrderSchema.parse(req.body);
      const result = await this.service.updatePlannedOrder(
        req.params.id as string,
        plannedOrderId,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/packaging-queue/:id/urgent — acil toggle */
  async setUrgent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { isUrgent } = urgentSchema.parse(req.body);
      const result = await this.service.setUrgent(
        req.params.id as string,
        isUrgent,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/packaging-queue/available — operatör için sayfalı bekleyen liste */
  async getAvailable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit, offset } = availableQuerySchema.parse(req.query);
      const result = await this.service.getAvailable({ limit, offset });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/packaging-queue/:id/take — operatör belirli kaydı alır */
  async takeById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.takeById(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/packaging-queue?status= */
  async getQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status } = listQuerySchema.parse(req.query);
      const result = await this.service.getQueue({ status });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/packaging-queue */
  async addToQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = addSchema.parse(req.body);
      const result = await this.service.addToQueue(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/packaging-queue/reorder */
  async reorder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reorderSchema.parse(req.body);
      const result = await this.service.reorder(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/packaging-queue/:id */
  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = removeSchema.parse(req.body ?? {});
      const result = await this.service.removeFromQueue(
        { id: req.params.id as string, cancelReason: body.cancelReason },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/packaging-queue/take-next */
  async takeNext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.takeNext(req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
