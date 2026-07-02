// =============================================================================
// TeksERP - Device Controller (allowlist + atama)
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { DeviceService } from "../services/device.service";
import { readDevicePairingRequired } from "../services/system-setting.service";
import "../types/express-augment";

const deviceKindSchema = z.enum(["TABLET", "PHONE", "DESKTOP"]).optional();

const announceSchema = z.object({
  deviceId: z.string().min(8, "Geçersiz cihaz kimliği").max(80),
  name: z.string().max(80).optional(),
  kind: deviceKindSchema,
});

const approveSchema = z.object({
  machineId: z.string().uuid("Geçersiz makine ID").optional().nullable(),
  kind: deviceKindSchema,
  // Onay anında opsiyonel takma ad ("Beratın telefonu") — yalnız panelde görünür.
  name: z.string().trim().min(1).max(80).optional(),
});

const assignHardwareSchema = z.object({
  peripheralIds: z.array(z.string().uuid("Geçersiz donanım ID")).default([]),
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

  /** POST /api/devices/announce (PUBLIC) — tablet boot'ta deviceId bildirir. */
  static async announce(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = announceSchema.parse(req.body);
      const data = await DeviceService.announce(body);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/devices/status (PUBLIC) — atama durumunu poll'la (x-device-id header). */
  static async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const deviceId =
        (req.header("x-device-id") || (typeof req.query.deviceId === "string" ? req.query.deviceId : "")).trim();
      if (!deviceId) {
        res.status(400).json({ success: false, message: "deviceId gerekli (x-device-id header)" });
        return;
      }
      const data = await DeviceService.getStatus(deviceId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/devices/pairing-required (PUBLIC — login öncesi gate)
   * false (default) ise atama pasif — tablet onaysız da çalışır (atıf null).
   */
  static async assignmentRequired(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const required = await readDevicePairingRequired();
      res.status(200).json({ success: true, data: { required } });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/:id/approve — onayla + (opsiyonel) makineye ata. */
  static async approve(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const body = approveSchema.parse(req.body ?? {});
      const data = await DeviceService.approveAndAssign(
        id,
        { machineId: body.machineId ?? null, kind: body.kind, name: body.name },
        req.user?.userId,
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/:id/assign-hardware — cihaza donanım (yazıcı/okuyucu) ata. */
  static async assignHardware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const { peripheralIds } = assignHardwareSchema.parse(req.body ?? {});
      const data = await DeviceService.assignHardware(id, peripheralIds, req.user?.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/:id/revoke — onayı/atamayı geri al (→ PENDING). */
  static async revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const data = await DeviceService.revoke(id, req.user?.userId);
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

  /** DELETE /api/admin/devices/:id/permanent (hard delete) */
  static async hardDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const data = await DeviceService.hardDelete(id, req.user?.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/:id/reactivate */
  static async reactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const data = await DeviceService.reactivate(id, req.user?.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}
