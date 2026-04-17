// =============================================================================
// TeksERP - Tambur Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { TamburService } from "../services/tambur.service";
import "../types/express-augment";

const finalizeSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  netCurrentQty: z.number().min(0, "Net miktar 0 veya daha büyük olmalı"),
  decisions: z.array(
    z.object({
      errorId: z.string().uuid("Geçersiz hata ID"),
      decision: z.enum(["CUT", "NO_CUT"], { message: "Karar CUT veya NO_CUT olmalı" }),
      qualityGrade: z.string().optional(),
    })
  ),
  foldType: z.enum(["2-KAT", "4-KAT"]).optional(),
});

const allocateSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  orderLineId: z.string().uuid("Geçersiz sipariş kalemi ID"),
  allocatedQty: z.number().positive("Tahsis miktarı pozitif olmalı"),
});

const splitAllocateSchema = z.object({
  rollId: z.string().uuid(),
  allocations: z
    .array(
      z.object({
        orderLineId: z.string().uuid().nullish(),
        targetStock: z.boolean().optional(),
        qty: z.number().positive(),
      })
    )
    .min(1),
});

const swatchSchema = z.object({
  sourceRollId: z.string().uuid(),
  length: z.number().positive(),
  width: z.number().positive().nullish(),
  count: z.number().int().positive().max(1000),
  purpose: z.string().max(255).nullish(),
  workOrderId: z.string().uuid().nullish(),
  variantId: z.string().uuid().nullish(),
});

export class TamburController {
  private service: TamburService;

  constructor() {
    this.service = new TamburService();
    this.getPendingRolls = this.getPendingRolls.bind(this);
    this.getRollForDecision = this.getRollForDecision.bind(this);
    this.finalize = this.finalize.bind(this);
    this.allocate = this.allocate.bind(this);
    this.splitAllocate = this.splitAllocate.bind(this);
    this.createSwatch = this.createSwatch.bind(this);
    this.listSwatches = this.listSwatches.bind(this);
  }

  /**
   * GET /api/tambur/pending-rolls
   */
  async getPendingRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getPendingRolls();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tambur/rolls/:rollId
   */
  async getRollForDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getRollForDecision(req.params.rollId as string);
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
   * POST /api/tambur/finalize
   */
  async finalize(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = finalizeSchema.parse(req.body);
      const result = await this.service.finalize(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/tambur/allocate
   */
  async allocate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = allocateSchema.parse(req.body);
      const result = await this.service.allocate(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/split-allocate */
  async splitAllocate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = splitAllocateSchema.parse(req.body);
      const result = await this.service.splitAllocate(
        {
          rollId: body.rollId,
          allocations: body.allocations.map((a) => ({
            orderLineId: a.orderLineId ?? null,
            targetStock: a.targetStock ?? false,
            qty: a.qty,
          })),
        },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/swatch */
  async createSwatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = swatchSchema.parse(req.body);
      const result = await this.service.createSwatch(
        {
          sourceRollId: body.sourceRollId,
          length: body.length,
          width: body.width ?? null,
          count: body.count,
          purpose: body.purpose ?? null,
          workOrderId: body.workOrderId ?? null,
          variantId: body.variantId ?? null,
        },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/swatches */
  async listSwatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listSwatches({
        workOrderId: typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined,
        itemId:      typeof req.query.itemId === "string" ? req.query.itemId : undefined,
        limit:       typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
