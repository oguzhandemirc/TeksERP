// =============================================================================
// TeksERP - Allocation Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AllocationService } from "../services/allocation.service";
import "../types/express-augment";

const allocateSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  orderLineId: z.string().uuid("Geçersiz sipariş satırı ID"),
  allocatedQty: z.number().positive("Tahsis miktarı pozitif olmalı"),
});

const reassignSchema = z.object({
  allocationId: z.string().uuid("Geçersiz allocation ID"),
  newOrderLineId: z.string().uuid("Geçersiz hedef sipariş satırı ID"),
  reason: z.string().min(1, "Taşıma nedeni gerekli").max(500),
});

const suggestionsQuerySchema = z.object({
  orderLineId: z.string().uuid("Geçersiz sipariş satırı ID"),
});

const pendingOrdersQuerySchema = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  customerId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  mode: z.enum(["offset", "cursor"]).optional(),
});

export class AllocationController {
  private service: AllocationService;

  constructor() {
    this.service = new AllocationService();
    this.getPendingOrders = this.getPendingOrders.bind(this);
    this.getMatchingStock = this.getMatchingStock.bind(this);
    this.allocate = this.allocate.bind(this);
    this.reassign = this.reassign.bind(this);
    this.getSuggestions = this.getSuggestions.bind(this);
  }

  /** GET /api/allocations/pending-orders */
  async getPendingOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const params = pendingOrdersQuerySchema.parse(req.query);
      const result = await this.service.getPendingOrders(params);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/allocations/matching-stock/:orderLineId */
  async getMatchingStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getMatchingStockForLine(
        req.params.orderLineId as string
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/allocations */
  async allocate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = allocateSchema.parse(req.body);
      const result = await this.service.allocateStockToOrder(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/allocations/reassign */
  async reassign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = reassignSchema.parse(req.body);
      const result = await this.service.reassignAllocation(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/allocations/suggestions?orderLineId=... */
  async getSuggestions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { orderLineId } = suggestionsQuerySchema.parse(req.query);
      const result = await this.service.getReassignSuggestions(orderLineId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
