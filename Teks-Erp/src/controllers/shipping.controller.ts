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
  driverName: z.string().optional(),
  plateNumber: z.string().optional(),
  carrier: z.string().optional(),
});

const addItemsSchema = z.object({
  rollIds: z.array(z.string().min(1)).min(1, "En az bir top gerekli"),
});

export class ShippingController {
  private service: ShippingService;

  constructor() {
    this.service = new ShippingService();
    this.getReadyOrders = this.getReadyOrders.bind(this);
    this.getReadyFasonRolls = this.getReadyFasonRolls.bind(this);
    this.preparePackage = this.preparePackage.bind(this);
    this.createShipment = this.createShipment.bind(this);
    this.addItems = this.addItems.bind(this);
    this.finalize = this.finalize.bind(this);
    this.listShipments = this.listShipments.bind(this);
    this.getShipmentById = this.getShipmentById.bind(this);
    this.getPrintSnapshot = this.getPrintSnapshot.bind(this);
  }

  /**
   * GET /api/shipping/shipments
   */
  async listShipments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = req.query.status as string | undefined;
      const customerId = req.query.customerId as string | undefined;
      const validStatus =
        status && status in ShipmentStatus
          ? (status as ShipmentStatus)
          : undefined;
      const result = await this.service.listShipments({
        status: validStatus,
        customerId,
      });
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
      const result = await this.service.getReadyOrders();
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
}
