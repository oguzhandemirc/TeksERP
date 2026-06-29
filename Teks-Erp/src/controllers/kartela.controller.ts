// =============================================================================
// TeksERP - Kartela (Swatch) Fason Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { KartelaService } from "../services/kartela.service";
import "../types/express-augment";

const dispatchSchema = z.object({
  subcontractorId: z.string().uuid(),
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top seçmelisiniz"),
  plateNumber: z.string().max(32).nullish(),
  driverName: z.string().max(128).nullish(),
  notes: z.string().max(1000).nullish(),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(500),
});

const measureItemSchema = z.object({
  lengthCm: z.number().positive().nullish(),
  weightKg: z.number().positive().nullish(),
});

const receiveSchema = z.object({
  subcontractorId: z.string().uuid(),
  dispatchId: z.string().uuid().nullish(),
  manifestNo: z.string().trim().max(64).nullish(),
  notes: z.string().max(1000).nullish(),
  returns: z
    .array(
      z.object({
        rollId: z.string().uuid(),
        count: z.number().int().positive("Kartela adedi pozitif tam sayı olmalı").max(1000),
        // Toplu ölçüm — bu toptan dönen tüm kartelalara uygulanır.
        bulkLengthCm: z.number().positive().nullish(),
        bulkWeightKg: z.number().positive().nullish(),
        // Tek-tek ölçüm — varsa length === count olmalı (serviste doğrulanır).
        items: z.array(measureItemSchema).optional(),
        notes: z.string().max(500).nullish(),
      })
    )
    .min(1, "En az bir dönen top girin"),
});

const markSchema = z.object({
  value: z.boolean(),
});

const qStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** Liste query'sini (offset + cursor + filtre + arama + tarih) tek noktada parse et. */
function parseListQuery(req: Request) {
  const statusRaw = qStr(req.query.status);
  const STATUSES = ["active", "open", "received", "cancelled", "all"] as const;
  type KStatus = (typeof STATUSES)[number];
  const status: KStatus | undefined = (STATUSES as readonly string[]).includes(statusRaw ?? "")
    ? (statusRaw as KStatus)
    : req.query.includeCancelled === "true"
      ? "all"
      : undefined;
  const dateFromStr = qStr(req.query.dateFrom);
  const dateToStr = qStr(req.query.dateTo);
  const dateFrom = dateFromStr ? new Date(dateFromStr) : undefined;
  const dateTo = dateToStr ? new Date(dateToStr) : undefined;
  return {
    subcontractorId: qStr(req.query.subcontractorId),
    status,
    search: qStr(req.query.search),
    dateFrom: dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : undefined,
    dateTo: dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : undefined,
    // offset
    page: qStr(req.query.page) ? Number(req.query.page) : undefined,
    pageSize: qStr(req.query.pageSize) ? Number(req.query.pageSize) : undefined,
    // cursor
    cursor: qStr(req.query.cursor),
    mode: qStr(req.query.mode),
    limit: qStr(req.query.limit) ? Number(req.query.limit) : undefined,
    withTotal: req.query.withTotal === "true",
  };
}

export class KartelaController {
  private service: KartelaService;

  constructor() {
    this.service = new KartelaService();
    this.dispatch = this.dispatch.bind(this);
    this.cancelDispatch = this.cancelDispatch.bind(this);
    this.receive = this.receive.bind(this);
    this.cancelReceipt = this.cancelReceipt.bind(this);
    this.getReceiptCancelPreview = this.getReceiptCancelPreview.bind(this);
    this.listDispatches = this.listDispatches.bind(this);
    this.getDispatch = this.getDispatch.bind(this);
    this.listReceipts = this.listReceipts.bind(this);
    this.getReceipt = this.getReceipt.bind(this);
    this.outstandingRolls = this.outstandingRolls.bind(this);
    this.getStock = this.getStock.bind(this);
    this.setRollMarked = this.setRollMarked.bind(this);
  }

  /** POST /api/kartela/dispatch */
  async dispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = dispatchSchema.parse(req.body);
      const result = await this.service.dispatch(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kartela/dispatches/:id/cancel */
  async cancelDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reason } = cancelSchema.parse(req.body);
      const result = await this.service.cancelDispatch(
        req.params.id as string,
        reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kartela/receive */
  async receive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = receiveSchema.parse(req.body);
      const result = await this.service.receive(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kartela/receipts/:id/cancel */
  async cancelReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reason } = cancelSchema.parse(req.body);
      const result = await this.service.cancelReceipt(
        req.params.id as string,
        reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/receipts/:id/cancel-preview */
  async getReceiptCancelPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getReceiptCancelPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/dispatches */
  async listDispatches(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listDispatches(parseListQuery(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/dispatches/:id */
  async getDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getDispatch(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/receipts */
  async listReceipts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listReceipts(parseListQuery(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/receipts/:id */
  async getReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getReceipt(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/outstanding — kabul worklist'i (firmadaki AT_KARTELA toplar) */
  async outstandingRolls(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.outstandingRolls({
        subcontractorId:
          typeof req.query.subcontractorId === "string" ? req.query.subcontractorId : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/stock — müsait kartelaların ürün+renk bazında sayımı (sevk picker) */
  async getStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getStock({ search: qStr(req.query.search) });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kartela/rolls/:id/mark — kartelalık işaretini set/kaldır */
  async setRollMarked(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { value } = markSchema.parse(req.body);
      const result = await this.service.setRollMarkedForKartela(
        req.params.id as string,
        value,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
