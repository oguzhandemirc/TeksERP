// =============================================================================
// TeksERP - TravelerCard Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { TravelerCardService } from "../services/traveler-card.service";
import "../types/express-augment";

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
}
