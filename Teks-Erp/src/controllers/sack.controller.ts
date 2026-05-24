// =============================================================================
// TeksERP - Sack (Çuval) Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { SackService } from "../services/sack.service";
import "../types/express-augment";

const createSackSchema = z.object({
  customerId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

const updateCustomerSchema = z.object({
  sackId: z.string().uuid(),
  customerId: z.string().uuid(),
});

const weighSackSchema = z.object({
  sackId: z.string().uuid(),
  weightKg: z.number().nonnegative(),
});

// assign-roll roll-level tartı YAPMAZ. Operatör çuvalı doldurduktan sonra
// `POST /api/sacks/weigh` ile çuval brütünü tek seferde girer; tartı çuval
// seviyesinde (Sack.weightKg). Bu nedenle body'de weightKg artık yok —
// strict() ile yanlışlıkla gönderilen weightKg/netWeightKg/grossWeightKg
// silently strip yerine 400 verir.
const assignRollSchema = z
  .object({
    rollId: z.string().uuid(),
    sackId: z.string().uuid(),
    orderLineId: z.string().uuid().nullish(),
  })
  .strict();

const removeRollSchema = z.object({
  rollId: z.string().uuid(),
});

const assignSwatchSchema = z.object({
  swatchId: z.string().uuid(),
  sackId: z.string().uuid(),
  weightKg: z.number().nonnegative().nullish(),
});

const removeSwatchSchema = z.object({
  swatchId: z.string().uuid(),
});

export class SackController {
  private service: SackService;

  constructor() {
    this.service = new SackService();
    this.create = this.create.bind(this);
    this.remove = this.remove.bind(this);
    this.updateCustomer = this.updateCustomer.bind(this);
    this.weigh = this.weigh.bind(this);
    this.assignRoll = this.assignRoll.bind(this);
    this.removeRoll = this.removeRoll.bind(this);
    this.assignSwatch = this.assignSwatch.bind(this);
    this.removeSwatch = this.removeSwatch.bind(this);
    this.getSack = this.getSack.bind(this);
    this.listByCustomer = this.listByCustomer.bind(this);
    this.listAllOpen = this.listAllOpen.bind(this);
    this.getPool = this.getPool.bind(this);
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createSackSchema.parse(req.body);
      const result = await this.service.createSack(body, req.user?.userId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.deleteSack(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async updateCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = updateCustomerSchema.parse(req.body);
      const result = await this.service.updateSackCustomer(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async weigh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = weighSackSchema.parse(req.body);
      const result = await this.service.weighSack(body, req.user?.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async assignRoll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = assignRollSchema.parse(req.body);
      const result = await this.service.assignRollToSack(
        {
          rollId: body.rollId,
          sackId: body.sackId,
          orderLineId: body.orderLineId ?? null,
        },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async removeRoll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = removeRollSchema.parse(req.body);
      const result = await this.service.removeRollFromSack(
        body.rollId,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async assignSwatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = assignSwatchSchema.parse(req.body);
      const result = await this.service.assignSwatchToSack(
        {
          swatchId: body.swatchId,
          sackId: body.sackId,
          weightKg: body.weightKg ?? null,
        },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async removeSwatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = removeSwatchSchema.parse(req.body);
      const result = await this.service.removeSwatchFromSack(
        body.swatchId,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getSack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getSack(req.params.id as string);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async listByCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = req.query.customerId as string;
      if (!customerId) {
        res.status(400).json({ success: false, message: "customerId zorunlu" });
        return;
      }
      const result = await this.service.listOpenSacksByCustomer(customerId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async listAllOpen(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.listAllOpenSacks();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getPool(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId =
        typeof req.query.customerId === "string" ? req.query.customerId : undefined;
      const result = await this.service.getPool({ customerId });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
