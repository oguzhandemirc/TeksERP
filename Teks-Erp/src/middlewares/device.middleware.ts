// =============================================================================
// TeksERP - Device Resolver Middleware
// =============================================================================
// x-device-id header'ı varsa Device kaydını çözer ve req.device'a yazar.
//
// Davranış (atama ZORUNLU iken — device.pairingRequired = true):
// - Header YOK               → next() (web/Electron istekleri, etkilenmez)
// - Header VAR + ONAYLI       → req.device set edilir, next() (MAKİNEYE ATANMAMIŞ OLSA DA —
//                              yönetici/atamasız cihaz da çalışır; donanım deviceId-join'den)
// - Header VAR + PENDING/pasif/yok → 401 DEVICE_INACTIVE (tablet onay bekler)
//
// Davranış (atama PASİF iken — device.pairingRequired = false, DEFAULT):
// - Onaylı cihaz req.device set edilir (makine atfı korunur).
// - Onaysız/kayıtsız cihaz da BLOKLANMAZ → next() (req.device boş, makine atfı NULL).
//
// İstisna: announce/status/pairing-required endpoint'leri bu kontrolden muaftır —
// onaysız (PENDING) cihaz kendini bildirebilmeli, durumunu poll'layabilmeli ve mobil
// login öncesi atamanın zorunlu olup olmadığını öğrenebilmeli.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { DeviceService } from "../services/device.service";
import { readDevicePairingRequired } from "../services/system-setting.service";
import { touchDevice } from "../lib/presence";
import "../types/express-augment";

const EXEMPT_PATHS = new Set([
  "/api/devices/announce",
  "/api/devices/status",
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
  // F19: try YALNIZ resolveDevice etrafında. Eskiden boş catch, DB hatasında
  // eşleştirme zorunluyken bile PENDING/pasif cihazı kapıdan geçiriyordu (fail-open,
  // görünmez). Artık eşleştirme zorunluysa hata halinde FAIL-CLOSED (503) + iz.
  let device;
  try {
    device = await DeviceService.resolveDevice(deviceId);
  } catch (err) {
    console.warn(
      "[device.middleware] resolveDevice hatası:",
      err instanceof Error ? err.message : err,
    );
    let pairingRequired = false;
    try {
      pairingRequired = await readDevicePairingRequired();
    } catch {
      /* flag da okunamadı: eşleştirme kapalı varsayılıp mevcut fail-open korunur */
    }
    if (pairingRequired) {
      res.status(503).json({
        success: false,
        message: "Cihaz doğrulaması geçici olarak yapılamıyor. Lütfen tekrar deneyin.",
        code: "DEVICE_CHECK_UNAVAILABLE",
      });
      return;
    }
    return next(); // eşleştirme kapalı (default): DB hatası erişimi engellemesin (kasıtlı fail-open)
  }

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

  // Onaylı + aktif cihaz GEÇER — makineye atanmamış olsa bile. Yönetici/atamasız
  // cihaz da çalışır; donanım artık deviceId-join'den çözülür (makineden değil).
  // machineId yalnızca üretim atfı (RollOperation vb.); null olması erişimi engellemez.
  req.device = {
    id: device.id,
    deviceId: device.deviceId,
    name: device.name,
    machineId: device.machineId,
    kind: device.kind,
  };
  touchDevice(device.deviceId); // anlık "bağlı cihaz" izleme (bellekte)
  next();
};
