// =============================================================================
// TeksERP - Work Session Controller
// =============================================================================
// HTTP katmanı: Zod validate + WorkSessionService'e delege. Oturum açma/kapama
// CİHAZ bağlamı ister (req.device — x-device-id ile çözülen ONAYLI tablet/telefon);
// admin uçları (active/history/force-close) cihazsız çalışır.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { WorkSessionService } from "../services/work-session.service";
import { AppError } from "../utils/app-error";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";

const openSchema = z
  .object({
    machineId: z.string().uuid().optional(),
    stationId: z.string().uuid().optional(),
    confirmTakeover: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.machineId) !== Boolean(d.stationId), {
    message: "machineId veya stationId — tam biri zorunlu",
  });

const historySchema = z.object({
  userId: z.string().uuid().optional(),
  machineId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** req.device zorunlu — oturum yalnız ONAYLI kayıtlı cihazdan açılır/yönetilir. */
function requireDevice(req: Request): { id: string } {
  if (!req.device) {
    throw AppError.badRequest(
      "Onaylı cihaz gerekli — bu işlem yalnız kayıtlı tablet/telefondan yapılabilir (cihaz yöneticiden onaylanmalı)",
      { code: "DEVICE_REQUIRED" },
    );
  }
  return req.device;
}

export class WorkSessionController {
  static open = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = openSchema.parse(req.body ?? {});
      const device = requireDevice(req);
      const result = await WorkSessionService.open({
        userId: req.user!.userId,
        deviceRowId: device.id,
        machineId: body.machineId ?? null,
        stationId: body.stationId ?? null,
        confirmTakeover: body.confirmTakeover ?? false,
      });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  };

  static close = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const device = requireDevice(req);
      const result = await WorkSessionService.closeForDevice(device.id, "LOGOUT", req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  static current = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const device = requireDevice(req);
      const result = await WorkSessionService.current(device.id);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  static places = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await WorkSessionService.places();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  static resolveMachine = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const result = await WorkSessionService.resolveMachineByCode(code);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  static listActive = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await WorkSessionService.listActive();
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  static history = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = historySchema.parse(req.query ?? {});
      const result = await WorkSessionService.history(q);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };

  static forceClose = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = assertValidUuid(req.params.id, "id");
      const result = await WorkSessionService.forceClose(id, req.user?.userId);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  };
}
