// =============================================================================
// TeksERP - Shipping Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ShipmentStatus } from "@prisma/client";
import { ShippingService } from "../services/shipping.service";
import "../types/express-augment";

const preparePackageSchema = z.object({
  rollIds: z.array(z.string().uuid()).min(1, "En az bir top gerekli"),
  packageId: z.string().min(1, "Paket ID (barkod) gerekli"),
  grossWeightKg: z.number().positive("Brüt kilo pozitif olmalı"),
});

const createShipmentSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  branchId: z.string().uuid("Geçersiz şube ID").optional().nullable(),
  driverName: z.string().optional(),
  plateNumber: z.string().optional(),
  carrier: z.string().optional(),
  priority: z.number().int().optional(),
  plannedDate: z.string().datetime().optional().nullable(),
  plannedOrderIds: z.array(z.string().uuid()).optional(),
});

const updatePlanSchema = z.object({
  priority: z.number().int().optional(),
  plannedDate: z.string().datetime().nullable().optional(),
});

const addPlannedOrderSchema = z.object({
  orderId: z.string().uuid("Geçersiz sipariş ID"),
  note: z.string().max(500).optional(),
});

const listShipmentsQuerySchema = z.object({
  status: z.nativeEnum(ShipmentStatus).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().optional(),
  mode: z.enum(["offset", "cursor"]).optional(),
  withTotal: z.coerce.boolean().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  dateField: z.enum(["createdAt", "shippedAt", "plannedDate"]).optional(),
  sortBy: z
    .enum([
      "shipmentNumber",
      "createdAt",
      "shippedAt",
      "plannedDate",
      "carrier",
      "status",
    ])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

const readyOrdersQuerySchema = z.object({
  q: z.string().max(200).optional(),
  customerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().optional(),
  mode: z.enum(["offset", "cursor"]).optional(),
});

const sackAssignSchema = z.object({
  shipmentId: z.string().uuid(),
  sackId: z.string().uuid(),
});

const addItemsSchema = z.object({
  rollIds: z.array(z.string().min(1)).min(1, "En az bir top gerekli"),
});

const assignOrphanRollSchema = z.object({
  orderLineId: z.string().uuid("Geçersiz sipariş satırı ID"),
});

const bindToOrdersSchema = z.object({
  bindings: z
    .array(
      z.object({
        rollId: z.string().uuid("Geçersiz top ID"),
        orderLineId: z.string().uuid("Geçersiz sipariş satırı ID"),
        allocatedQty: z.number().positive("Tahsis miktarı pozitif olmalı"),
      })
    )
    .min(1, "En az bir bağlama girişi gerekli"),
});

export class ShippingController {
  private service: ShippingService;

  constructor() {
    this.service = new ShippingService();
    this.getReadyOrders = this.getReadyOrders.bind(this);
    this.getReadyFasonRolls = this.getReadyFasonRolls.bind(this);
    this.getOrphanReadyRolls = this.getOrphanReadyRolls.bind(this);
    this.assignOrphanRoll = this.assignOrphanRoll.bind(this);
    this.preparePackage = this.preparePackage.bind(this);
    this.createShipment = this.createShipment.bind(this);
    this.addItems = this.addItems.bind(this);
    this.finalize = this.finalize.bind(this);
    this.bindToOrders = this.bindToOrders.bind(this);
    this.listShipments = this.listShipments.bind(this);
    this.getShipmentById = this.getShipmentById.bind(this);
    this.getPrintSnapshot = this.getPrintSnapshot.bind(this);
    this.addSack = this.addSack.bind(this);
    this.removeSack = this.removeSack.bind(this);
    this.updateShipmentPlan = this.updateShipmentPlan.bind(this);
    this.addPlannedOrder = this.addPlannedOrder.bind(this);
    this.removePlannedOrder = this.removePlannedOrder.bind(this);
  }

  /** PATCH /api/shipping/shipments/:id/plan */
  async updateShipmentPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = updatePlanSchema.parse(req.body);
      const result = await this.service.updateShipmentPlan(
        req.params.id as string,
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/shipping/shipments/:id/planned-orders */
  async addPlannedOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = addPlannedOrderSchema.parse(req.body);
      const result = await this.service.addOrderToShipmentPlan(
        req.params.id as string,
        body.orderId,
        body.note,
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/shipping/planned-orders/:plannedOrderId */
  async removePlannedOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.removeOrderFromShipmentPlan(
        req.params.plannedOrderId as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/shipping/shipments/:id/add-sack */
  async addSack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = sackAssignSchema.parse({
        shipmentId: req.params.id,
        sackId: req.body.sackId,
      });
      const result = await this.service.addSackToShipment(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/shipping/shipments/:id/remove-sack */
  async removeSack(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = sackAssignSchema.parse({
        shipmentId: req.params.id,
        sackId: req.body.sackId,
      });
      const result = await this.service.removeSackFromShipment(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/shipping/shipments
   */
  async listShipments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const params = listShipmentsQuerySchema.parse(req.query);
      const result = await this.service.listShipments(params);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/shipping/shipments/:id
   */
  async getShipmentById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getShipmentById(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/shipping/shipments/:id/print
   * Yazdırma için donmuş (veya canlı) snapshot döner.
   */
  async getPrintSnapshot(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.getPrintSnapshot(req.params.id as string);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/shipping/ready-orders
   */
  async getReadyOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const params = readyOrdersQuerySchema.parse(req.query);
      const result = await this.service.getReadyOrders(params);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/shipping/ready-fason
   */
  async getReadyFasonRolls(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await this.service.getReadyFasonRolls();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/shipping/orphan-rolls */
  async getOrphanReadyRolls(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await this.service.getOrphanReadyRolls();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/shipping/orphan-rolls/:rollId/assign */
  async assignOrphanRoll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { orderLineId } = assignOrphanRollSchema.parse(req.body);
      const rollId = req.params.rollId as string;
      const result = await this.service.assignOrphanRollToOrderLine(
        rollId,
        orderLineId,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/shipping/prepare-package
   */
  async preparePackage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = preparePackageSchema.parse(req.body);
      const result = await this.service.preparePackage(body, req.user?.userId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/shipping/shipments
   */
  async createShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = createShipmentSchema.parse(req.body);
      const result = await this.service.createShipment(body, req.user?.userId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/shipping/shipments/:id/add-items
   */
  async addItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = addItemsSchema.parse(req.body);
      const result = await this.service.addItemsToShipment(
        req.params.id as string,
        body.rollIds,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/shipping/shipments/:id/finalize
   */
  async finalize(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await this.service.finalizeShipment(
        req.params.id as string,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/shipping/shipments/:id/bind-to-orders
   * SHIPPED bir sevkiyatı sipariş satırlarına geriye dönük bağlar.
   */
  async bindToOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = bindToOrdersSchema.parse(req.body);
      const result = await this.service.bindShipmentToOrders(
        req.params.id as string,
        body.bindings,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
