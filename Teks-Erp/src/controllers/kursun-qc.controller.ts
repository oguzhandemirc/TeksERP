// =============================================================================
// TeksERP - Kurşun + QC2 Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { KursunQcService } from "../services/kursun-qc.service";
import "../types/express-augment";

const applyKursunSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  stepId: z.string().uuid("Geçersiz adım ID"),
  notes: z.string().max(500).nullish(),
});

const completeQc2Schema = applyKursunSchema;

// Hata sadece NOKTA olarak girilir (startMeter); endMeter artık tutulmuyor.
// Tambur operatörü ekranda bu noktayı görüp fiziksel kesim kararı verir.
const reportErrorSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  stepId: z.string().uuid("Geçersiz adım ID"),
  startMeter: z.number().min(0, "Hata metresi 0 veya daha büyük olmalı"),
  defectTypeId: z.string().uuid("Hata tipi seçilmelidir"),
});

const deleteErrorSchema = z.object({
  errorId: z.string().uuid("Geçersiz hata ID"),
});

const finishStepSchema = z.object({
  stepId: z.string().uuid("Geçersiz adım ID"),
});

const reopenStepSchema = z.object({
  stepId: z.string().uuid("Geçersiz adım ID"),
});

export class KursunQcController {
  private service: KursunQcService;

  constructor() {
    this.service = new KursunQcService();
    this.getByCardBarcode = this.getByCardBarcode.bind(this);
    this.getStep = this.getStep.bind(this);
    this.listOpenCards = this.listOpenCards.bind(this);
    this.applyKursun = this.applyKursun.bind(this);
    this.undoKursun = this.undoKursun.bind(this);
    this.completeQc2 = this.completeQc2.bind(this);
    this.undoQc2 = this.undoQc2.bind(this);
    this.reportError = this.reportError.bind(this);
    this.deleteError = this.deleteError.bind(this);
    this.finishStep = this.finishStep.bind(this);
    this.reopenStep = this.reopenStep.bind(this);
  }

  /** GET /api/kursun-qc/by-card/:barcode */
  async getByCardBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getByCardBarcode(req.params.barcode as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-qc/step/:stepId */
  async getStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getStep(req.params.stepId as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kursun-qc/open-cards */
  async listOpenCards(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listOpenCards();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/apply-kursun */
  async applyKursun(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = applyKursunSchema.parse(req.body);
      const result = await this.service.applyKursun(
        { rollId: body.rollId, stepId: body.stepId, notes: body.notes ?? null },
        req.user?.userId,
        req.device?.machineId ?? null
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/undo-kursun */
  async undoKursun(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = z.object({
        rollId: z.string().uuid(),
        stepId: z.string().uuid(),
      }).parse(req.body);
      const result = await this.service.undoKursun(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/complete-qc2 */
  async completeQc2(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = completeQc2Schema.parse(req.body);
      const result = await this.service.completeQc2(
        { rollId: body.rollId, stepId: body.stepId, notes: body.notes ?? null },
        req.user?.userId,
        req.device?.machineId ?? null
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/undo-qc2 */
  async undoQc2(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = z.object({
        rollId: z.string().uuid(),
        stepId: z.string().uuid(),
      }).parse(req.body);
      const result = await this.service.undoQc2(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/report-error */
  async reportError(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reportErrorSchema.parse(req.body);
      const result = await this.service.reportError(
        {
          rollId: body.rollId,
          stepId: body.stepId,
          startMeter: body.startMeter,
          defectTypeId: body.defectTypeId,
        },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /api/kursun-qc/error */
  async deleteError(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = deleteErrorSchema.parse(req.body);
      const result = await this.service.deleteError(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/finish-step */
  async finishStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = finishStepSchema.parse(req.body);
      const result = await this.service.finishStep(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kursun-qc/reopen-step */
  async reopenStep(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reopenStepSchema.parse(req.body);
      const result = await this.service.reopenStep(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
