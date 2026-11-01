// =============================================================================
// TeksERP - Device Controller (allowlist + atama)
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { DeviceService } from "../services/device.service";
import { DeviceRebindService } from "../services/device-rebind.service";
import { HW_DIGEST_RE, HW_SOURCES } from "../services/helpers/device-identity.helper";
import { readDevicePairingRequired } from "../services/system-setting.service";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { AuthService } from "../services/auth.service";
import { AuditService } from "../services/audit.service";
import { matchesPermission } from "../middlewares/rbac.middleware";
import {
  releaseLoginAttempt, reserveLoginAttempt, resetLoginLockout, resolveLoginLockoutKeys, resolveRequestSourceKey,
} from "../middlewares/login-lockout";
import { AppError } from "../utils/app-error";
import "../types/express-augment";

const deviceKindSchema = z.enum(["TABLET", "PHONE", "DESKTOP"]).optional();

/**
 * Donanım özeti (eşleme v2) — yalnız TANIMA. Biçimsiz/bilinmeyen sürüm YOK SAYILIR (`catch`):
 * özet kimlik doğrulamaz, bozuk özet yüzünden tablet announce edemez hâle düşmesin.
 */
const hwSchema = z
  .object({ v: z.literal(1), kaynak: z.enum(HW_SOURCES), ozet: z.string().regex(HW_DIGEST_RE) })
  .optional()
  .catch(undefined);

// Şema katı DEĞİL (bilinmeyen alan atılır) — yeni istemci eski backend'de de çalışır.
const announceSchema = z.object({
  // Kolon `devices.deviceId` VarChar(64): 65–80 karakter eskiden 500 üretiyordu.
  deviceId: z.string().min(8, "Geçersiz cihaz kimliği").max(64, "Geçersiz cihaz kimliği"),
  name: z.string().max(80).optional(),
  kind: deviceKindSchema,
  hw: hwSchema,
  model: z.string().max(120).optional().catch(undefined),
});

const rejectRebindSchema = z.object({
  mode: z.enum(["REDDET", "AYRI_CIHAZ"], { message: "Geçersiz red biçimi" }),
  reason: z.string().trim().max(300).optional(),
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

// Yerinde onay: kimlik alanları giriş şemasıyla aynı tavanlarda (kimliksiz uçta gövde işi sınırlı).
const onsiteApproveSchema = z.object({
  localId: z.string().trim().min(8, "Geçersiz cihaz kimliği").max(64, "Geçersiz cihaz kimliği"),
  username: z.string().min(1, "Kullanıcı adı gerekli").max(256, "Kullanıcı adı çok uzun"),
  password: z.string().min(1, "Şifre gerekli").max(256, "Şifre çok uzun"),
  totp: z.string().trim().min(1).max(64).optional(),
});

/**
 * Yerinde onay hız sınırı (IP + localId): kilit sayacı yalnız YANLIŞ parolayı sayar; bu tavan
 * aynı kaynaktan aynı tablet için her denemeyi sayar (bcrypt CPU'su + talep taraması).
 */
const ONSITE_WINDOW_MS = 10 * 60 * 1000;
const ONSITE_MAX_PER_WINDOW = 10;
/** Kaynak (IP, IPv6'da /64) başına tavan — localId saldırganın seçimidir, tek başına anahtar olamaz. */
const ONSITE_MAX_PER_SOURCE = 30;
const onsiteHits = new Map<string, { n: number; since: number }>();
function onsiteRateLimited(key: string, max: number, now = Date.now()): boolean {
  if (onsiteHits.size > 5000) {
    for (const [k, v] of onsiteHits) if (now - v.since > ONSITE_WINDOW_MS) onsiteHits.delete(k);
  }
  const e = onsiteHits.get(key);
  if (!e || now - e.since > ONSITE_WINDOW_MS) {
    onsiteHits.set(key, { n: 1, since: now });
    return false;
  }
  e.n += 1;
  return e.n > max;
}
/** Her deneme İKİ kovayı da sayar: kaynak+tablet (10) ve yalnız kaynak (30). */
export function onsiteSourceRateLimited(source: string, localId: string): boolean {
  const perDevice = onsiteRateLimited(`${source}|${localId}`, ONSITE_MAX_PER_WINDOW);
  const perSource = onsiteRateLimited(`${source}|*`, ONSITE_MAX_PER_SOURCE);
  return perDevice || perSource;
}
/** Yalnız bekçi: hız sınırı durumunu sıfırla. */
export function resetOnsiteRebindRateForTests(): void {
  onsiteHits.clear();
}

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

  /** GET /api/admin/devices/:id — cihaz detayı (donanım/etiket profili + son oturum). */
  static async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = assertValidUuid(req.params.id, "id");
      const data = await DeviceService.detail(id);
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

  /** GET /api/admin/devices/rebind-requests — yeniden bağlama talepleri (açıklar önce). */
  static async listRebindRequests(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await DeviceRebindService.listRequests();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/rebind-requests/:id/approve — talebi onayla (hedef satıra bağla). */
  static async approveRebind(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = assertValidUuid(req.params.id, "id");
      const data = await DeviceRebindService.approve(id, req.user!.userId, "PANEL");
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/devices/rebind-requests/:id/reject — `{mode: REDDET|AYRI_CIHAZ, reason?}`. */
  static async rejectRebind(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = assertValidUuid(req.params.id, "id");
      const body = rejectRebindSchema.parse(req.body ?? {});
      const data = await DeviceRebindService.reject(id, body, req.user!.userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/devices/rebind-requests/onsite-approve (PUBLIC) — tablette yerinde yönetici onayı.
   * Giriş ucuyla AYNI kilit kovası ve doğrulayıcı; izin `admin:settings`; JWT VERİLMEZ.
   * Parola/TOTP hiçbir log'a/audit'e girmez (yalnız kullanıcı adı, IP bağlamdan).
   */
  static async onsiteApproveRebind(req: Request, res: Response, next: NextFunction): Promise<void> {
    let body: z.infer<typeof onsiteApproveSchema>;
    try {
      body = onsiteApproveSchema.parse(req.body ?? {});
    } catch (error) {
      next(error);
      return;
    }
    if (onsiteSourceRateLimited(resolveRequestSourceKey(req), body.localId)) {
      next(AppError.tooManyRequests("Çok fazla onay denemesi. Birkaç dakika sonra tekrar deneyin.", { code: "REBIND_RATE_LIMITED" }));
      return;
    }
    const ipAddress = req.ip ?? null;
    const lockKeys = resolveLoginLockoutKeys(req, `u:${body.username}`);
    const lock = await reserveLoginAttempt(lockKeys);
    if (lock.justLocked) {
      await AuditService.logEvent({ category: "AUTH", action: "LOGIN_LOCKED", recordId: body.username, ipAddress,
        payload: { retryAfterSec: lock.retryAfterSec, channel: "DEVICE_REBIND_ONSITE" } });
    }
    if (lock.blocked) {
      next(AppError.tooManyRequests(`Çok fazla hatalı giriş denemesi. ${lock.retryAfterSec} saniye sonra tekrar deneyin.`,
        { code: "LOGIN_LOCKED", retryAfterSec: lock.retryAfterSec }));
      return;
    }
    let actor: { userId: string; username: string };
    try {
      actor = await AuthService.verifyPasswordForApproval(body.username, body.password, {
        clientType: "mobile", totpCode: body.totp, totpCapable: true,
      });
      resetLoginLockout(lockKeys);
    } catch (error) {
      // Giriş ucuyla aynı: yalnız 401 kaba kuvvet sayılır; 409 TOTP_REQUIRED / 403 deneme değildir.
      const isCredentialError = error instanceof AppError && error.statusCode === 401;
      if (!isCredentialError) releaseLoginAttempt(lockKeys);
      if (isCredentialError) {
        void AuditService.logEvent({ category: "AUTH", action: "LOGIN_FAILED", recordId: body.username, ipAddress,
          payload: { statusCode: 401, channel: "DEVICE_REBIND_ONSITE" } });
      }
      next(error);
      return;
    }
    try {
      const permissions = await AuthService.getEffectivePermissions(actor.userId);
      if (!matchesPermission(permissions, "admin:settings")) {
        throw AppError.forbidden("Bu onay için cihaz yönetimi yetkisi (admin:settings) gerekiyor.", { code: "REBIND_APPROVER_FORBIDDEN" });
      }
      const data = await DeviceRebindService.approveOnsite(body.localId, actor.userId);
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
