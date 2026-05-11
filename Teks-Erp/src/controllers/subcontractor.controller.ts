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
  subcontractorId: z.string().uuid(),
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçmelisiniz"),
  plateNumber: z.string().max(32).optional(),
  driverName: z.string().max(128).optional(),
  notes: z.string().max(1000).optional(),
});

const cancelDispatchSchema = z.object({
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(500),
});

const receiveSchema = z.object({
  workOrderId: z.string().uuid(),
  stepId: z.string().uuid(),
  subcontractorId: z.string().uuid(),
  manifestNo: z.string().trim().max(64).nullish(),
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
    this.cancelDispatch = this.cancelDispatch.bind(this);
    this.receive = this.receive.bind(this);
    this.pendingReturns = this.pendingReturns.bind(this);
    this.listDispatches = this.listDispatches.bind(this);
    this.getDispatch = this.getDispatch.bind(this);
    this.getDispatchPrint = this.getDispatchPrint.bind(this);
    this.listReceipts = this.listReceipts.bind(this);
    this.getReceiptPrint = this.getReceiptPrint.bind(this);
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

  /** POST /api/subcontractor/dispatches/:id/cancel */
  async cancelDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cancelDispatchSchema.parse(req.body);
      const result = await this.service.cancel(id, body.reason, req.user?.userId);
      res.status(200).json(result);
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
          subcontractorId: body.subcontractorId,
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

  /** GET /api/subcontractor/pending-returns?workOrderId=... */
  async pendingReturns(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listPendingReturns({
        workOrderId:
          typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/dispatches */
  async listDispatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listDispatches({
        workOrderId:     typeof req.query.workOrderId     === "string" ? req.query.workOrderId     : undefined,
        subcontractorId: typeof req.query.subcontractorId === "string" ? req.query.subcontractorId : undefined,
        page:            typeof req.query.page            === "string" ? Number(req.query.page)     : undefined,
        pageSize:        typeof req.query.pageSize        === "string" ? Number(req.query.pageSize) : undefined,
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

  /** GET /api/subcontractor/dispatches/:id/print */
  async getDispatchPrint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getDispatchPrintSnapshot(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts */
  async listReceipts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listReceipts({
        workOrderId:     typeof req.query.workOrderId     === "string" ? req.query.workOrderId     : undefined,
        subcontractorId: typeof req.query.subcontractorId === "string" ? req.query.subcontractorId : undefined,
        page:            typeof req.query.page            === "string" ? Number(req.query.page)     : undefined,
        pageSize:        typeof req.query.pageSize        === "string" ? Number(req.query.pageSize) : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/subcontractor/receipts/:id/print */
  async getReceiptPrint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getReceiptPrintSnapshot(req.params.id as string);
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
