// =============================================================================
// TeksERP - Device Resolver Middleware
// =============================================================================
// x-device-id header'ı varsa Device kaydını çözer ve req.device'a yazar.
//
// Davranış (cihaz eşleştirme ZORUNLU iken — device.pairingRequired = true):
// - Header YOK            → next() (web/Electron istekleri, etkilenmez)
// - Header VAR + aktif/eşli → req.device set edilir, next()
// - Header VAR + pasif/yok/eşsiz → 401 DEVICE_INACTIVE (tablet pairing'e geri düşer)
//
// Davranış (eşleştirme PASİF iken — device.pairingRequired = false, DEFAULT):
// - Eşli cihaz yine req.device set edilir (makine atfı korunur).
// - Eşleşmemiş/kayıtsız cihaz da BLOKLANMAZ → next() (req.device boş, makine atfı NULL).
//
// İstisna: /api/devices/pair ve /api/devices/pairing-required endpoint'leri bu
// kontrolden muaftır — pasif cihaz tekrar eşleşebilmeli ve mobil login öncesi
// eşleştirmenin zorunlu olup olmadığını öğrenebilmeli.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { DeviceService } from "../services/device.service";
import { readDevicePairingRequired } from "../services/system-setting.service";
import "../types/express-augment";

const EXEMPT_PATHS = new Set([
  "/api/devices/pair",
  "/api/devices/pairing-required",
]);

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
  if (EXEMPT_PATHS.has(req.path)) {
    return next();
  }
  try {
    const device = await DeviceService.resolveDevice(deviceId);
    if (!device) {
      // Cihaz silinmiş, pasifleştirilmiş veya hiç eşleşmemiş. Eşleştirme zorunluysa
      // tablet'in tüm istekleri (login dahil) burada kesilir; mobil interceptor
      // pairing storage'ı temizleyip kullanıcıyı pairing ekranına yönlendirir.
      // Eşleştirme pasifse (default) bloklama yok — cihaz req.device'sız geçer.
      if (await readDevicePairingRequired()) {
        res.status(401).json({
          success: false,
          message:
            "Cihaz pasifleştirilmiş veya kayıtlı değil. Yöneticiden yeni eşleştirme kodu isteyin.",
          code: "DEVICE_INACTIVE",
        });
        return;
      }
      return next();
    }
    if (!device.machineId) {
      // Cihaz aktif ama bir makineye eşli değil (admin "Eşleşmeyi Kaldır" çekti
      // veya Pasife Al → Aktifleştir döngüsü machineId'yi sıfırladı). Eşleştirme
      // zorunluysa yeniden eşleştirme kodu girilmeli; pasifse cihaz yine geçer.
      if (await readDevicePairingRequired()) {
        res.status(401).json({
          success: false,
          message:
            "Cihaz bir makineye eşli değil. Yöneticiden yeni eşleştirme kodu isteyin.",
          code: "DEVICE_INACTIVE",
        });
        return;
      }
      return next();
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
