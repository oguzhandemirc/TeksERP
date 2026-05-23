// =============================================================================
// TeksERP - Device Resolver Middleware
// =============================================================================
// x-device-id header'ı varsa Device kaydını çözer ve req.device'a yazar.
// Header yoksa veya cihaz pasifse req.device undefined kalır — endpoint normal
// çalışmaya devam eder (web/electron istekleri etkilenmez).
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { DeviceService } from "../services/device.service";
import "../types/express-augment";

export const resolveDevice = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const headerVal = req.headers["x-device-id"];
  const deviceId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!deviceId || typeof deviceId !== "string") {
    return next();
  }
  try {
    const device = await DeviceService.resolveDevice(deviceId);
    if (device) {
      req.device = {
        id: device.id,
        deviceId: device.deviceId,
        name: device.name,
        machineId: device.machineId,
      };
    }
  } catch {
    // Header çözümleme hatası endpoint'i bloklamamalı
  }
  next();
};
