// =============================================================================
// TeksERP - Packaging (Paket/Tartı/Etiket) Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PackagingService } from "../services/packaging.service";
import "../types/express-augment";

const finalizeSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  weightKg: z.number().positive("Kilo pozitif olmalı"),
  destination: z.enum(["SHIP", "WAREHOUSE"], {
    message: "Hedef SHIP (sevkiyat) veya WAREHOUSE (depo) olmalı",
  }),
  orderLineId: z.string().uuid().nullish(),
});

export class PackagingController {
  private service: PackagingService;

  constructor() {
    this.service = new PackagingService();
    this.getPendingRolls = this.getPendingRolls.bind(this);
    this.getByCardBarcode = this.getByCardBarcode.bind(this);
    this.getByRollBarcode = this.getByRollBarcode.bind(this);
    this.simulateWeigh = this.simulateWeigh.bind(this);
    this.finalize = this.finalize.bind(this);
  }

  /** GET /api/packaging/pending-rolls */
  async getPendingRolls(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await this.service.getPendingRolls();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/packaging/by-card/:barcode */
  async getByCardBarcode(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const barcode = (req.params.barcode as string).trim();
      const result = await this.service.getByCardBarcode(barcode);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/packaging/by-roll/:barcode */
  async getByRollBarcode(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const barcode = (req.params.barcode as string).trim();
      const result = await this.service.getByRollBarcode(barcode);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/packaging/simulate-weigh/:rollId */
  async simulateWeigh(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await this.service.simulateWeigh(
        req.params.rollId as string
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/packaging/finalize */
  async finalize(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const body = finalizeSchema.parse(req.body);
      const result = await this.service.finalize(
        {
          rollId: body.rollId,
          weightKg: body.weightKg,
          destination: body.destination,
          orderLineId: body.orderLineId ?? null,
        },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
