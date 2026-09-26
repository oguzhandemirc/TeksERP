// =============================================================================
// TeksERP - Kartela (Swatch) Fason Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { KartelaService } from "../services/kartela.service";
import { kartelaTimelineService } from "../services/kartela-timeline.service";
import { SWATCH_EVENT_GROUPS, type SwatchEventGroup } from "../constants/swatch-event-labels";
import { readFilterList } from "../utils/query-parser";
import { AppError } from "../utils/app-error";
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

const reduceStockSchema = z.object({
  itemId: z.string().uuid(),
  colorId: z.string().uuid().nullable(),
  count: z.number().int().positive("Adet pozitif tam sayı olmalı").max(1000),
  reason: z.string().trim().min(3, "Gerekçe en az 3 karakter").max(500),
  // İdempotency anahtarı — sayaç-bazlı düşümün replay'i ÇİFT düşüm yapardı;
  // aynı token'la 2. çağrı cached { reduced } döner (SwatchStockReduction @unique).
  clientToken: z.string().uuid("Geçersiz istemci anahtarı").optional(),
});

const reverseReductionSchema = z.object({
  reason: z.string().trim().min(3, "Gerekçe en az 3 karakter").max(500),
});

const eventsQuerySchema = z.object({
  search: z.string().max(100).optional(),
  dateFrom: z.string().max(40).optional(),
  dateTo: z.string().max(40).optional(),
  swatchId: z.string().max(40).optional(),
  group: z.union([z.string(), z.array(z.string())]).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const qStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** F296: sayısal query param — 'abc' gibi geçersizde NaN'ı Prisma'ya sızdırmadan
 *  undefined'a düşür (tarih paramlarındaki NaN-guard ile simetri). */
const qNum = (v: unknown): number | undefined => {
  const s = qStr(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

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
    page: qNum(req.query.page),
    pageSize: qNum(req.query.pageSize),
    // cursor
    cursor: qStr(req.query.cursor),
    mode: qStr(req.query.mode),
    limit: qNum(req.query.limit),
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
    this.reduceStock = this.reduceStock.bind(this);
    this.listStockReductions = this.listStockReductions.bind(this);
    this.reverseStockReduction = this.reverseStockReduction.bind(this);
    this.setRollMarked = this.setRollMarked.bind(this);
    this.listEvents = this.listEvents.bind(this);
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

  /** GET /api/kartela/events — Kartela Hareketleri (olay defteri; liste + imleç + grup sayaçları tek süzgeçten). */
  async listEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = eventsQuerySchema.parse(req.query);
      const groups = readFilterList(q.group as string | string[] | undefined);
      // Fail-closed: tanınmayan grup sessizce "hepsi" sayılmaz.
      const unknownGroups = groups.filter((g) => !(SWATCH_EVENT_GROUPS as readonly string[]).includes(g));
      if (unknownGroups.length) throw AppError.badRequest(`Tanınmayan olay grubu: ${unknownGroups.join(", ")}`);
      const page = await kartelaTimelineService.list(
        { search: q.search, dateFrom: q.dateFrom, dateTo: q.dateTo, swatchId: q.swatchId },
        { groups: groups as SwatchEventGroup[], cursor: q.cursor, limit: q.limit },
      );
      res.status(200).json({
        success: true,
        data: page.data,
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: q.limit },
        groups: page.groups,
      });
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/stock — müsait kartelaların ürün+renk bazında sayımı (sevk picker) */
  async getStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getStock({
        search: qStr(req.query.search),
        itemId: qStr(req.query.itemId),
        colorId: qStr(req.query.colorId),
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kartela/stock/reduce — bir ürün+renk grubundan N kartelayı elle stoktan düş */
  async reduceStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reduceStockSchema.parse(req.body);
      const result = await this.service.reduceStock(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/kartela/stock/reductions — stok düşüm geçmişi (geri alınabilirlik dahil) */
  async listStockReductions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listStockReductions({
        itemId: qStr(req.query.itemId),
        colorId: qStr(req.query.colorId),
        cursor: qStr(req.query.cursor),
        limit: qNum(req.query.limit),
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/kartela/stock/reductions/:id/reverse — düşümün stornosu */
  async reverseStockReduction(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { reason } = reverseReductionSchema.parse(req.body);
      const result = await this.service.reverseStockReduction(
        req.params.id as string,
        reason,
        req.user?.userId
      );
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
