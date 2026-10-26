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
// - İstisna `device.unpairedPasswordLogin` açıkken: PENDING + aktif cihaz `req.device`siz,
//   `req.unapprovedDevice` işaretiyle geçer (yalnız parola girişi; pasif/kayıtsız yine 401).
//
// Davranış (atama PASİF iken — device.pairingRequired = false, DEFAULT):
// - Onaylı cihaz req.device set edilir (makine atfı korunur).
// - Onaysız/kayıtsız cihaz da BLOKLANMAZ → next() (req.device boş, makine atfı NULL).
//
// Cihaz kanıtı (`x-device-proof`, `lib/device-proof.ts`): `device.proofRequired` açıkken
// (barındırılan sınıfta DAİMA) onaylı cihaz ancak geçerli kanıtla `req.device` olur; kanıtsız
// ya da yanlış kanıtlı istek 401 DEVICE_PROOF_INVALID. Kapalıyken (varsayılan) bugünkü davranış;
// geçerli kanıt yine de sırrı TEYİT eder (yeniden verim kapanır).
//
// İstisna: announce/status/pairing-required/rebind-requests/onsite-approve endpoint'leri bu
// kontrolden muaftır — onaysız (PENDING) cihaz kendini bildirebilmeli, durumunu poll'layabilmeli,
// mobil login öncesi atamanın zorunlu olup olmadığını öğrenebilmeli ve yeniden bağlama talebini
// yerinde yönetici girişiyle onaylatabilmeli.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { DeviceService } from "../services/device.service";
import {
  readDevicePairingRequired, readDeviceProofRequiredCached, readDeviceUnpairedPasswordLogin,
} from "../services/system-setting.service";
import { getShortCredentialKeyRing } from "../lib/short-credential/keyring";
import {
  DEVICE_PROOF_HEADER, deriveDeviceSecret, proofPathOf, verifyDeviceProof, type ProofVerdict,
} from "../lib/device-proof";
import { noteHalkaVerdict } from "../lib/short-credential/ring-footprint";
import { AppError } from "../utils/app-error";
import { touchDevice } from "../lib/presence";
import "../types/express-augment";
import { uyari } from "../lib/logger";

const EXEMPT_PATHS = new Set([
  "/api/devices/announce",
  "/api/devices/status",
  "/api/devices/pairing-required",
  // Yerinde onay: kayıtsız (yeni) localId'den gelir; kimliği gövdedeki yönetici girişi taşır.
  "/api/devices/rebind-requests/onsite-approve",
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
  // F27: trailing-slash / büyük-harf varyantında announce/status/pairing kilitlenmesin.
  const normalizedPath = req.path.replace(/\/+$/, "").toLowerCase();
  if (EXEMPT_PATHS.has(normalizedPath)) {
    return next();
  }
  // F19: try YALNIZ resolveDevice etrafında. Eskiden boş catch, DB hatasında
  // eşleştirme zorunluyken bile PENDING/pasif cihazı kapıdan geçiriyordu (fail-open,
  // görünmez). Artık eşleştirme zorunluysa hata halinde FAIL-CLOSED (503) + iz.
  let device;
  try {
    device = await DeviceService.resolveDevice(deviceId);
  } catch (err) {
    uyari("device.middleware", "resolveDevice hatası:",
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
      // Onaysız ama yasaklanmamış (PENDING + aktif) cihaz bayrak açıkken `req.device`siz geçer:
      // yalnız parola girişi + o oturumun uçları; PIN/kart/liste/indirme belirteci işarete bakıp kapanır.
      if ((await readDeviceUnpairedPasswordLogin()) && (await DeviceService.isUnpairedPasswordCandidate(deviceId))) {
        req.unapprovedDevice = { deviceId };
        return next();
      }
      res.status(401).json({
        success: false,
        message:
          "Cihaz pasifleştirilmiş veya kayıtlı değil. Bu cihaz için yönetici onayı gerekiyor.",
        code: "DEVICE_INACTIVE",
      });
      return;
    }
    return next();
  }

  const verdict = checkProof(req, device.deviceId, device.proofSalt);
  // Halka kaybının sahadaki izi: sayaç sağlığa gider (bayrak kapalıyken de sayılır — görünürlük).
  if (verdict === "HALKA") noteHalkaVerdict();
  if (verdict === "OK" && !device.proofConfirmedAt && device.proofSalt) {
    await DeviceService.confirmProof(device.deviceId, device.proofSalt).catch(() => undefined);
  }
  if (verdict !== "OK" && (await readDeviceProofRequiredCached())) {
    if (verdict === "HALKA") {
      return next(new AppError("Cihaz doğrulaması geçici olarak yapılamıyor. Lütfen tekrar deneyin.", 503, true, {
        code: "DEVICE_CHECK_UNAVAILABLE",
      }));
    }
    return next(AppError.unauthorized(
      "Cihaz kimliği doğrulanamadı. Uygulamayı güncelleyin; sürerse yöneticiden cihazı yeniden onaylatın.",
      { code: "DEVICE_PROOF_INVALID", reason: verdict },
    ));
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

/** Kanıt hükmü; "SIRSIZ" = cihaza henüz sır verilmedi, "HALKA" = anahtar halkası okunamadı. */
function checkProof(req: Request, deviceId: string, salt: string | null): ProofVerdict | "SIRSIZ" | "HALKA" {
  if (!salt) return "SIRSIZ";
  const st = getShortCredentialKeyRing();
  if (!st.ok) return "HALKA";
  const secret = deriveDeviceSecret(st.ring, deviceId, salt);
  if (!secret) return "HALKA";
  const h = req.headers[DEVICE_PROOF_HEADER];
  return verifyDeviceProof(secret, Array.isArray(h) ? h[0] : h, {
    method: req.method,
    path: proofPathOf(req.originalUrl),
  });
}
