// =============================================================================
// TeksERP - Device Controller
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { DeviceService } from "../services/device.service";
import "../types/express-augment";

const createPairingCodeSchema = z.object({
  machineId: z.string().uuid("Geçersiz makine ID"),
  deviceName: z.string().min(1, "Cihaz adı gerekli").max(80),
});

const pairSchema = z.object({
  deviceId: z.string().min(8, "Geçersiz cihaz kimliği").max(80),
  code: z.string().regex(/^\d{6}$/, "Kod 6 haneli olmalı"),
});

const renameSchema = z.object({
  name: z.string().min(1).max(80),
});

export class DeviceController {
  /** GET /api/admin/devices */
  static async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await DeviceService.list();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/pairing-codes */
  static async createPairingCode(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const body = createPairingCodeSchema.parse(req.body);
      const data = await DeviceService.createPairingCode({
        ...body,
        createdById: req.user?.userId,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/devices/pair (PUBLIC — tablet ilk kurulum)
   * Body: { deviceId, code }
   */
  static async pair(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = pairSchema.parse(req.body);
      const data = await DeviceService.pair(body);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/admin/devices/:id (rename) */
  static async rename(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const { name } = renameSchema.parse(req.body);
      const data = await DeviceService.rename(id, name, req.user?.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/:id/unpair */
  static async unpair(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const data = await DeviceService.unpair(id, req.user?.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/admin/devices/:id (soft) */
  static async deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const data = await DeviceService.deactivate(id, req.user?.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
