// =============================================================================
// TeksERP - Production Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ProductionService } from "../services/production.service";
import "../types/express-augment";

const stepActionSchema = z
  .object({
    barcode: z.string().min(1, "Barkod gerekli"),
    stationId: z.string().uuid("Geçersiz istasyon ID"),
    action: z.enum(["START", "FINISH", "SKIP"], {
      message: "action START, FINISH veya SKIP olmalı",
    }),
    newQty: z.number().positive("Yeni miktar pozitif olmalı").optional(),
    newWeight: z.number().positive("Yeni ağırlık pozitif olmalı").optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    (d) => d.action !== "SKIP" || (d.reason && d.reason.trim().length >= 3),
    { message: "SKIP action için reason zorunlu (en az 3 karakter)", path: ["reason"] }
  );

const reportErrorSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  startMeter: z.number().min(0, "Başlangıç metresi 0 veya daha büyük olmalı"),
  endMeter: z.number().positive("Bitiş metresi pozitif olmalı"),
  errorType: z.string().optional(),
});

export class ProductionController {
  private service: ProductionService;

  constructor() {
    this.service = new ProductionService();
    this.stepAction = this.stepAction.bind(this);
    this.getActiveSteps = this.getActiveSteps.bind(this);
    this.reportError = this.reportError.bind(this);
    this.getStepInfo = this.getStepInfo.bind(this);
  }

  /**
   * GET /api/production/step-info?barcode=...&stationId=...
   * Tablet üzerinde operatöre adım bilgisi (önizleme).
   */
  async getStepInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const barcode = typeof req.query.barcode === "string" ? req.query.barcode : "";
      const stationId = typeof req.query.stationId === "string" ? req.query.stationId : undefined;
      if (!barcode) {
        res.status(400).json({ success: false, message: "barcode query parametresi gerekli" });
        return;
      }
      const result = await this.service.getStepInfo(barcode, stationId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/production/step-action
   * Execute a START or FINISH action at a station.
   */
  async stepAction(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = stepActionSchema.parse(req.body);
      const result = await this.service.executeStepAction(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/production/active-steps
   * Dashboard: list all currently active production steps.
   */
  async getActiveSteps(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getActiveSteps();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/production/report-error
   * Report a defect at Kurşun (QC2) station.
   */
  async reportError(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reportErrorSchema.parse(req.body);
      const result = await this.service.reportError(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
}
