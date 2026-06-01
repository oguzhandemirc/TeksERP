import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { SackStatus, ShipmentStatus } from "@prisma/client";
import { ShippingService } from "../services/shipping.service";
import "../types/express-augment";

// ---- Zod şemaları ----------------------------------------------------------
const createSackSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  branchId: z.string().uuid("Geçersiz şube ID").optional().nullable(),
  sackNo: z.string().trim().min(1).max(64).optional().nullable(),
});

const assignRollSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  sackId: z.string().uuid("Geçersiz çuval ID"),
  targetOrderLineId: z.string().uuid("Geçersiz sipariş satırı ID").optional().nullable(),
});

const removeRollSchema = z.object({ rollId: z.string().uuid("Geçersiz top ID") });

const assignSwatchSchema = z.object({
  swatchId: z.string().uuid("Geçersiz kartela ID"),
  sackId: z.string().uuid("Geçersiz çuval ID"),
  targetOrderLineId: z.string().uuid("Geçersiz sipariş satırı ID").optional().nullable(),
});

const removeSwatchSchema = z.object({ swatchId: z.string().uuid("Geçersiz kartela ID") });

const weighSchema = z.object({ weightKg: z.number().positive("Kg pozitif olmalı") });

const createShipmentSchema = z.object({
  customerId: z.string().uuid("Geçersiz müşteri ID"),
  branchId: z.string().uuid("Geçersiz şube ID").optional().nullable(),
  plateNumber: z.string().trim().max(32).optional().nullable(),
  driverName: z.string().trim().max(100).optional().nullable(),
  carrier: z.string().trim().max(100).optional().nullable(),
});

const sackRefSchema = z.object({ sackId: z.string().uuid("Geçersiz çuval ID") });

const dispatchSchema = z.object({
  plateNumber: z.string().trim().max(32).optional().nullable(),
  driverName: z.string().trim().max(100).optional().nullable(),
  carrier: z.string().trim().max(100).optional().nullable(),
});

const relabelSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
  // null = etiketi kaldır (stoğa al). Alan zorunlu — niyet açıkça belirtilmeli.
  targetOrderLineId: z.string().uuid("Geçersiz sipariş satırı ID").nullable(),
});

const autoAssignSchema = z.object({
  barcode: z.string().trim().min(1, "Barkod gerekli").max(64),
});

const markReprintedSchema = z.object({
  rollId: z.string().uuid("Geçersiz top ID"),
});

export class ShippingController {
  private service = new ShippingService();

  // ---- ÇUVAL -------------------------------------------------------------
  createSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createSackSchema.parse(req.body);
      const result = await this.service.createSack(body, req.user?.userId);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  listSacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const statusRaw = req.query.status as string | undefined;
      const status =
        statusRaw && Object.values(SackStatus).includes(statusRaw as SackStatus)
          ? (statusRaw as SackStatus)
          : undefined;
      const result = await this.service.listSacks({
        customerId: (req.query.customerId as string | undefined) || undefined,
        status,
        unassignedOnly: req.query.unassignedOnly === "true",
      });
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  getSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getSackById(req.params.id as string);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  assignRoll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = assignRollSchema.parse(req.body);
      const result = await this.service.assignRoll(body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeRoll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeRollSchema.parse(req.body);
      const result = await this.service.removeRoll(body.rollId, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  assignSwatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = assignSwatchSchema.parse(req.body);
      const result = await this.service.assignSwatch(body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeSwatch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = removeSwatchSchema.parse(req.body);
      const result = await this.service.removeSwatch(body.swatchId, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  weighSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = weighSchema.parse(req.body);
      const result = await this.service.weighAndCloseSack(
        { sackId: req.params.id as string, weightKg: body.weightKg },
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- İRSALİYE ----------------------------------------------------------
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
      const statusRaw = req.query.status as string | undefined;
      const status =
        statusRaw && Object.values(ShipmentStatus).includes(statusRaw as ShipmentStatus)
          ? (statusRaw as ShipmentStatus)
          : undefined;
      const result = await this.service.listShipments({
        status,
        customerId: (req.query.customerId as string | undefined) || undefined,
      });
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

  addSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackRefSchema.parse(req.body);
      const result = await this.service.addSack(
        req.params.id as string,
        body.sackId,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  removeSack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = sackRefSchema.parse(req.body);
      const result = await this.service.removeSack(
        req.params.id as string,
        body.sackId,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  dispatchShipment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dispatchSchema.parse(req.body);
      const result = await this.service.dispatchShipment(
        req.params.id as string,
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- SEVKE HAZIR + RELABEL ---------------------------------------------
  getReady = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getReadyForShipping();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  relabel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = relabelSchema.parse(req.body);
      const result = await this.service.relabelRoll(body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  autoAssign = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = autoAssignSchema.parse(req.body);
      const result = await this.service.autoAssignByBarcode(body, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  // ---- PRINT-QUEUE -------------------------------------------------------
  reprintQueue = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getReprintQueue();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  markReprinted = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = markReprintedSchema.parse(req.body);
      const result = await this.service.markReprinted(body.rollId, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };
}
