// =============================================================================
// TeksERP - Subcontractor (Fason) Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { SubcontractorService } from "../services/subcontractor.service";
import "../types/express-augment";

const dispatchSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  companyId: z.string().uuid(),
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçmelisiniz"),
  plateNumber: z.string().max(32).optional(),
  driverName: z.string().max(128).optional(),
  notes: z.string().max(1000).optional(),
});

const receiveSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  companyId: z.string().uuid(),
  manifestNo: z.string().trim().min(2, "İrsaliye numarası zorunlu").max(64),
  returns: z
    .array(
      z.object({
        rollId: z.string().uuid(),
        notes: z.string().max(500).nullish(),
      })
    )
    .min(1, "En az bir dönüş kaydı girin"),
  notes: z.string().max(1000).optional(),
});

export class SubcontractorController {
  private service: SubcontractorService;

  constructor() {
    this.service = new SubcontractorService();
    this.dispatch = this.dispatch.bind(this);
    this.receive = this.receive.bind(this);
    this.pendingReturns = this.pendingReturns.bind(this);
    this.listDispatches = this.listDispatches.bind(this);
    this.getDispatch = this.getDispatch.bind(this);
    this.listReceipts = this.listReceipts.bind(this);
    this.getReceipt = this.getReceipt.bind(this);
  }

  /** POST /api/subcontractor/dispatch */
  async dispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = dispatchSchema.parse(req.body);
      const result = await this.service.dispatch(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/receive */
  async receive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = receiveSchema.parse(req.body);
      const result = await this.service.receive(
        {
          workOrderId: body.workOrderId,
          stepId: body.stepId,
          companyId: body.companyId,
          manifestNo: body.manifestNo,
          notes: body.notes,
          returns: body.returns.map((r) => ({
            rollId: r.rollId,
            notes: r.notes ?? null,
          })),
        },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/pending-returns */
  async pendingReturns(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listPendingReturns();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches */
  async listDispatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listDispatches({
        workOrderId: typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined,
        companyId:   typeof req.query.companyId   === "string" ? req.query.companyId   : undefined,
        limit:       typeof req.query.limit       === "string" ? Number(req.query.limit) : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches/:id */
  async getDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getDispatch(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts */
  async listReceipts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listReceipts({
        workOrderId: typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined,
        companyId:   typeof req.query.companyId   === "string" ? req.query.companyId   : undefined,
        limit:       typeof req.query.limit       === "string" ? Number(req.query.limit) : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts/:id */
  async getReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getReceipt(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
