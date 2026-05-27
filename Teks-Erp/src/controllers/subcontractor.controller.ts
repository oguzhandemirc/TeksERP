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
  /** Operatör WO ürünü vs rulo ürünü uyuşmazlığını bilinçli onayladı. */
  allowItemOverride: z.boolean().optional(),
});

const cancelDispatchSchema = z.object({
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(500),
});

const cancelReceiptSchema = z.object({
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(500),
  /** Receipt'ten doğan açık kumaş roll'larını cascade iptal et. Liste backend
   *  preview'den alınıp aynen geri gönderilmeli; eksik/fazla id → 409. */
  cascadeRollIds: z.array(z.string().uuid()).optional(),
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
  // Receipt seviyesinde uygulanan kimlik (boyahane gibi açık kumaş döndüren
  // fason için). Renk: appliesColor=true kategoride WO.targetColor otomatik;
  // özellik: appliesProperty=true kategoride WO.targetProperties otomatik.
  appliedColorId: z.string().uuid().nullish(),
  appliedPropertyIds: z.array(z.string().uuid()).optional(),
  // Fasondan gelen açık kumaş parçaları — ZORUNLU. Receipt anında her parça
  // için open-fabric Roll kaydı (barcode=null) doğar ve rotadaki bir sonraki
  // adıma (genelde Kurşun/KK2) bağlanır. Boş geçilirse KK2 ekranına ve stok
  // listelerine kart yansımaz; operatör/depo sorumluları açık kumaşı göremez.
  // İrsaliyede kaç parça/metre geldiği zaten yazıyor; receive sırasında girilir.
  newRolls: z
    .array(
      z.object({
        qty: z.number().positive("Metraj pozitif olmalı"),
        weightKg: z.number().positive().nullish(),
        notes: z.string().max(500).nullish(),
      })
    )
    .min(1, "En az bir açık kumaş parçası girilmeli (metraj zorunlu)"),
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
    this.cancelReceipt = this.cancelReceipt.bind(this);
    this.getCancelPreview = this.getCancelPreview.bind(this);
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
          appliedColorId: body.appliedColorId,
          appliedPropertyIds: body.appliedPropertyIds,
          newRolls: body.newRolls?.map((nr) => ({
            qty: nr.qty,
            weightKg: nr.weightKg ?? null,
            notes: nr.notes ?? null,
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
      const cancellableRaw = req.query.cancellable;
      const cancellable =
        cancellableRaw === "yes" || cancellableRaw === "no"
          ? (cancellableRaw as "yes" | "no")
          : undefined;
      const result = await this.service.listReceipts({
        workOrderId:     typeof req.query.workOrderId     === "string" ? req.query.workOrderId     : undefined,
        subcontractorId: typeof req.query.subcontractorId === "string" ? req.query.subcontractorId : undefined,
        page:            typeof req.query.page            === "string" ? Number(req.query.page)     : undefined,
        pageSize:        typeof req.query.pageSize        === "string" ? Number(req.query.pageSize) : undefined,
        cancellable,
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

  /** GET /api/subcontractor/receipts/:id/cancel-preview */
  async getCancelPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const result = await this.service.getCancelPreview(id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/subcontractor/receipts/:id/cancel */
  async cancelReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = cancelReceiptSchema.parse(req.body);
      const result = await this.service.cancelReceipt(
        id,
        body.reason,
        req.user?.userId,
        body.cascadeRollIds ?? [],
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

}
