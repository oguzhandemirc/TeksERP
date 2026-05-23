// =============================================================================
// TeksERP - Tambur Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { TamburService } from "../services/tambur.service";
import "../types/express-augment";

const finalizeSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  decisions: z.array(
    z.object({
      errorId: z.string().uuid("Geçersiz hata ID"),
      decision: z.enum(["CUT", "NO_CUT"], { message: "Karar CUT veya NO_CUT olmalı" }),
      qualityGrade: z.string().optional(),
    })
  ),
  voluntaryCuts: z
    .array(
      z.object({
        start: z.number().min(0, "Başlangıç 0 veya daha büyük olmalı"),
        end: z.number().positive("Bitiş pozitif olmalı"),
        qualityGrade: z.string().min(1, "Kalite seçilmelidir"),
      })
    )
    .default([]),
  foldType: z.enum(["2-KAT", "4-KAT"]).optional(),
  cutMode: z.enum(["BY_DEFECT", "FIXED_LENGTH"]).nullish(),
  cutLengthM: z.number().positive().nullish(),
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
  colorId: z.string().uuid().nullish(),
});

const reportErrorSchema = z.object({
  rollId: z.string().uuid(),
  stepId: z.string().uuid(),
  startMeter: z.number().min(0),
  endMeter: z.number().positive(),
  defectTypeId: z.string().uuid(),
});

const postProductionSplitSchema = z.object({
  rollId: z.string().uuid(),
  cutLength: z.number().positive(),
  originalKeepsLarger: z.boolean(),
});

const cutOpenFabricSchema = z.object({
  lengthMeters: z.number().positive("Kesim metresi pozitif olmalı"),
  status: z.enum(["WAREHOUSE", "SCRAP", "A1_STOCK"], {
    message: "Status WAREHOUSE | SCRAP | A1_STOCK olmalı",
  }),
  qualityGrade: z.string().max(50).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const finalizeOpenFabricSchema = z.object({
  scrapRemaining: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
  // Tambur kararı — WO planlaması override (verilmezse WO.foldType kullanılır).
  foldType: z.string().trim().max(32).optional().nullable(),
});

export class TamburController {
  private service: TamburService;

  constructor() {
    this.service = new TamburService();
    this.getPendingRolls = this.getPendingRolls.bind(this);
    this.getRollForDecision = this.getRollForDecision.bind(this);
    this.getByCardBarcode = this.getByCardBarcode.bind(this);
    this.getStep = this.getStep.bind(this);
    this.finalize = this.finalize.bind(this);
    this.allocate = this.allocate.bind(this);
    this.splitAllocate = this.splitAllocate.bind(this);
    this.createSwatch = this.createSwatch.bind(this);
    this.listSwatches = this.listSwatches.bind(this);
    this.reportError = this.reportError.bind(this);
    this.listOpenCards = this.listOpenCards.bind(this);
    this.postProductionSplit = this.postProductionSplit.bind(this);
    this.getSwatchByBarcode = this.getSwatchByBarcode.bind(this);
    this.listRecentOutputRolls = this.listRecentOutputRolls.bind(this);
    this.cutOpenFabric = this.cutOpenFabric.bind(this);
    this.finalizeOpenFabric = this.finalizeOpenFabric.bind(this);
    this.getTamburContext = this.getTamburContext.bind(this);
  }

  /** POST /api/tambur/:id/cut */
  async cutOpenFabric(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cutOpenFabricSchema.parse(req.body);
      const result = await this.service.cutOpenFabric(id, body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/tambur/:id/finalize-open-fabric */
  async finalizeOpenFabric(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = finalizeOpenFabricSchema.parse(req.body);
      const result = await this.service.finalizeOpenFabric(id, body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/tambur/context/:cardBarcode */
  async getTamburContext(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cardBarcode = req.params.cardBarcode as string;
      const result = await this.service.getTamburContext(cardBarcode);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/tambur/recent-output-rolls?workOrderId=&limit= */
  async listRecentOutputRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workOrderId =
        typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined;
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const result = await this.service.listRecentOutputRolls({
        workOrderId,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/swatches/by-barcode/:barcode */
  async getSwatchByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getSwatchByBarcode(
        (req.params.barcode as string).trim()
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/post-production-split */
  async postProductionSplit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = postProductionSplitSchema.parse(req.body);
      const result = await this.service.postProductionSplit(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/tambur/step/:stepId */
  async getStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getStep(req.params.stepId as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/tambur/report-error */
  async reportError(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reportErrorSchema.parse(req.body);
      const result = await this.service.reportError(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/tambur/open-cards */
  async listOpenCards(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listOpenCards();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
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
   * GET /api/tambur/by-card/:barcode
   */
  async getByCardBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const barcode = (req.params.barcode as string).trim();
      const result = await this.service.getByCardBarcode(barcode);
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
          colorId: body.colorId ?? null,
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
