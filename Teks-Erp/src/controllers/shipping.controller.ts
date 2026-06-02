import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ShippingService } from "../services/shipping.service";
import "../types/express-augment";

// ---- Zod şemaları ----------------------------------------------------------
const createShipmentSchema = z.object({
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).min(1, "En az bir sipariş seçilmeli"),
});

const orderIdsSchema = z.object({
  orderIds: z.array(z.string().uuid("Geçersiz sipariş ID")).min(1, "Sipariş seçilmeli"),
});

const removeOrderSchema = z.object({ orderId: z.string().uuid("Geçersiz sipariş ID") });

const scanSchema = z.object({ barcode: z.string().trim().min(1, "Barkod gerekli").max(64) });

const removeRollSchema = z.object({ rollId: z.string().uuid("Geçersiz top ID") });
const removeSwatchSchema = z.object({ swatchId: z.string().uuid("Geçersiz kartela ID") });

const addSackSchema = z.object({
  weightKg: z.number().positive("Kg pozitif olmalı"),
  sackNo: z.string().trim().min(1).max(64).optional().nullable(),
});
const weighSackSchema = z.object({ weightKg: z.number().positive("Kg pozitif olmalı") });

const dispatchSchema = z.object({
  plateNumber: z.string().trim().max(32).optional().nullable(),
  driverName: z.string().trim().max(100).optional().nullable(),
  carrier: z.string().trim().max(100).optional().nullable(),
});

export class ShippingController {
  private service = new ShippingService();

  // ---- SEVKİYAT OTURUMU ---------------------------------------------------
  createShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createShipmentSchema.parse(req.body);
      const result = await this.service.createShipment(body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  listShipments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listShipments(req);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  getShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getShipmentById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  addOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = orderIdsSchema.parse(req.body);
      const result = await this.service.addOrders(req.params.id as string, body.orderIds, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeOrderSchema.parse(req.body);
      const result = await this.service.removeOrder(req.params.id as string, body.orderId, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- OKUTMA -------------------------------------------------------------
  scan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = scanSchema.parse(req.body);
      const result = await this.service.scanIntoShipment(
        { shipmentId: req.params.id as string, barcode: body.barcode },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeRoll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeRollSchema.parse(req.body);
      const result = await this.service.removeRollFromShipment(
        { shipmentId: req.params.id as string, rollId: body.rollId },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeSwatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeSwatchSchema.parse(req.body);
      const result = await this.service.removeSwatchFromShipment(
        { shipmentId: req.params.id as string, swatchId: body.swatchId },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- ÇUVAL (tartı) ------------------------------------------------------
  addSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = addSackSchema.parse(req.body);
      const result = await this.service.addSack(
        { shipmentId: req.params.id as string, weightKg: body.weightKg, sackNo: body.sackNo },
        req.user?.userId
      );
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  weighSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = weighSackSchema.parse(req.body);
      const result = await this.service.updateSack(
        { sackId: req.params.id as string, weightKg: body.weightKg },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.removeSack(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- SEVKE HAZIR / SEVK / İPTAL ----------------------------------------
  markReady = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.markReady(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  dispatchShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dispatchSchema.parse(req.body);
      const result = await this.service.dispatchShipment(req.params.id as string, body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  cancelPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getCancelPreview(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  cancelShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.cancelShipment(req.params.id as string, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- SİPARİŞ SEÇİM (Mod A) ---------------------------------------------
  openOrders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const branchRaw = req.query.branchId as string | undefined;
      const result = await this.service.listOpenOrdersWithCoverage({
        customerId: (req.query.customerId as string | undefined) || undefined,
        branchId: branchRaw === undefined ? undefined : branchRaw || null,
      });
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };
}
