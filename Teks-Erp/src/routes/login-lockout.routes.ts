/**
 * Giriş kilidi yönetimi (VDS denetimi O4): kilitli kovalar + audit'li kaldırma. İzin `admin:users`
 * (kullanıcı yönetimiyle aynı sahip). Kural servis katmanında (`login-lockout-admin.service.ts`).
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { LoginLockoutAdminService } from "../services/login-lockout-admin.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requirePermission("admin:users"));

const idSchema = z.string().regex(/^[0-9a-f]{64}$/, "Geçersiz kilit kimliği");

/**
 * @openapi
 * /api/admin/login-lockouts:
 *   get:
 *     tags: [Admin]
 *     summary: Şu an kilitli giriş kovaları (IP / kullanıcı / cihaz etiketiyle; sır yok)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await LoginLockoutAdminService.list() });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/login-lockouts/{id}/release:
 *   post:
 *     tags: [Admin]
 *     summary: Kilitli giriş kovasını kaldır (audit LOGIN_LOCK_RELEASED); kilitli değilse 409 LOCKOUT_NOT_ACTIVE
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/release", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = idSchema.parse(req.params.id as string);
    const data = await LoginLockoutAdminService.release(req.user!.userId, id, req.ip ?? null);
    res.status(200).json({ success: true, message: "Giriş kilidi kaldırıldı", data });
  } catch (error) {
    next(error);
  }
});

export default router;
