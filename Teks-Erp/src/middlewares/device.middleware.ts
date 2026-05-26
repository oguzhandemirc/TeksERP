// =============================================================================
// TeksERP - Device Resolver Middleware
// =============================================================================
// x-device-id header'ı varsa Device kaydını çözer ve req.device'a yazar.
//
// Davranış:
// - Header YOK            → next() (web/Electron istekleri, etkilenmez)
// - Header VAR + aktif     → req.device set edilir, next()
// - Header VAR + pasif/yok → 401 DEVICE_INACTIVE (tablet pairing'e geri düşer)
//
// İstisna: /api/devices/pair endpoint'i bu kontrolden muaftır — pasif cihaz
// admin tarafından tekrar aktifleştirildiğinde yeniden eşleşebilmeli.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { DeviceService } from "../services/device.service";
import "../types/express-augment";

const PAIR_ENDPOINT = "/api/devices/pair";

export const resolveDevice = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const headerVal = req.headers["x-device-id"];
  const deviceId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!deviceId || typeof deviceId !== "string") {
    return next();
  }
  if (req.path === PAIR_ENDPOINT) {
    return next();
  }
  try {
    const device = await DeviceService.resolveDevice(deviceId);
    if (!device) {
      // Cihaz silinmiş veya admin tarafından pasifleştirilmiş — tablet'in
      // tüm istekleri (login dahil) burada kesilir; mobil interceptor
      // pairing storage'ı temizleyip kullanıcıyı pairing ekranına yönlendirir.
      res.status(401).json({
        success: false,
        message:
          "Cihaz pasifleştirilmiş veya kayıtlı değil. Yöneticiden yeni eşleştirme kodu isteyin.",
        code: "DEVICE_INACTIVE",
      });
      return;
    }
    if (!device.machineId) {
      // Cihaz aktif ama bir makineye eşli değil (admin "Eşleşmeyi Kaldır" çekti
      // veya Pasife Al → Aktifleştir döngüsü machineId'yi sıfırladı). Tablet'in
      // local pairing storage'ı geçersiz; yeniden eşleştirme kodu girilmeli.
      res.status(401).json({
        success: false,
        message:
          "Cihaz bir makineye eşli değil. Yöneticiden yeni eşleştirme kodu isteyin.",
        code: "DEVICE_INACTIVE",
      });
      return;
    }
    req.device = {
      id: device.id,
      deviceId: device.deviceId,
      name: device.name,
      machineId: device.machineId,
    };
  } catch {
    // DB resolve hatası endpoint'i bloklamamalı — log altyapısı yoksa sessiz geç.
  }
  next();
};
