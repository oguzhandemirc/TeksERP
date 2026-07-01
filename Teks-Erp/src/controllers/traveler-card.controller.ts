// =============================================================================
// TeksERP - TravelerCard Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { TravelerCardService } from "../services/traveler-card.service";
import { normalizeTravelerCardConfig } from "../services/system-setting.service";
import "../types/express-augment";

/** Refakat kartı önizlemesi — admin'in düzenlediği taslak içerik ayarı. */
const travelerCardConfigSchema = z
  .object({
    companyName: z.string().optional(),
    addressLine: z.string().optional(),
    phone: z.string().optional(),
    pageSize: z.enum(["A4", "A5"]).optional(),
    margins: z
      .object({
        top: z.number(),
        right: z.number(),
        bottom: z.number(),
        left: z.number(),
      })
      .partial()
      .optional(),
    showOperationGrid: z.boolean().optional(),
    showNotes: z.boolean().optional(),
    showOrders: z.boolean().optional(),
    showProperties: z.boolean().optional(),
    specFields: z
      .object({
        color: z.boolean(),
        width: z.boolean(),
        targetQuantity: z.boolean(),
        targetWeight: z.boolean(),
        foldType: z.boolean(),
        startDate: z.boolean(),
        endDate: z.boolean(),
      })
      .partial()
      .optional(),
    footerNote: z.string().optional(),
  })
  .partial();

const sampleHtmlSchema = z.object({ config: travelerCardConfigSchema.optional() });

const reprintSchema = z.object({
  reason: z.string().trim().min(3, "Gerekçe en az 3 karakter olmalı").max(500),
});

const voidSchema = z.object({
  reason: z.string().trim().min(3, "Gerekçe en az 3 karakter olmalı").max(500),
});

const scanSchema = z.object({
  barcode:   z.string().trim().min(1),
  stationId: z.string().uuid(),
  scanType:  z.enum(["ARRIVAL", "DEPARTURE", "INFO"]),
  notes:     z.string().max(500).optional(),
  deviceId:  z.string().max(128).optional(),
});

export class TravelerCardController {
  private service: TravelerCardService;

  constructor() {
    this.service = new TravelerCardService();
    this.print        = this.print.bind(this);
    this.reprint      = this.reprint.bind(this);
    this.voidCard     = this.voidCard.bind(this);
    this.scan         = this.scan.bind(this);
    this.findByBarcode = this.findByBarcode.bind(this);
    this.getHistory   = this.getHistory.bind(this);
    this.getCardHtml  = this.getCardHtml.bind(this);
    this.getSampleHtml = this.getSampleHtml.bind(this);
    this.list         = this.list.bind(this);
  }

  /** GET /api/traveler-cards */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.list(req);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/work-orders/:id/traveler-cards */
  async print(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.print(req.params.id as string, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/work-orders/:id/traveler-cards/reprint */
  async reprint(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reprintSchema.parse(req.body);
      const result = await this.service.reprint(
        req.params.id as string,
        body.reason,
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/traveler-cards/:id/void */
  async voidCard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = voidSchema.parse(req.body);
      const result = await this.service.voidCard(
        req.params.id as string,
        body.reason,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/traveler-cards/scan */
  async scan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = scanSchema.parse(req.body);
      const result = await this.service.scan(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/traveler-cards/by-barcode/:barcode */
  async findByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.findByBarcode(req.params.barcode as string);
      if (!result.success) {
        res.status(404).json(result);
        return;
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/work-orders/:id/traveler-cards/history */
  async getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getHistory(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/traveler-cards/:id/html — tek-kaynak refakat kartı HTML'i (text/html) */
  async getCardHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const html = await this.service.getCardHtml(req.params.id as string);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/traveler-cards/sample-html — Belge Şablonu önizlemesi (örnek veri + taslak config) */
  async getSampleHtml(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { config } = sampleHtmlSchema.parse(req.body ?? {});
      // normalize → eksik/kısmi alanlar (margins/specFields) güvenli default'a çözülür.
      const html = await this.service.renderSampleHtml(
        normalizeTravelerCardConfig((config ?? {}) as Record<string, unknown>),
      );
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  }
}
