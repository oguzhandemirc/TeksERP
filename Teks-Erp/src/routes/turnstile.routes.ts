/**
 * Tarayıcı girişi bot koruması (Cloudflare Turnstile, V1c) — tek yazma yüzeyi. İzin `admin:settings`.
 * Gizli anahtar ortamda (`TURNSTILE_SECRET_KEY`); bu uç yalnız "tanımlı mı" döner, değeri asla.
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { readTurnstileAdminView, updateTurnstileConfig } from "../services/turnstile/turnstile-config";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requirePermission("admin:settings"));

const updateSchema = z.strictObject({
  enabled: z.boolean(),
  siteKey: z.string().max(128).nullable().optional(),
});

/**
 * @openapi
 * /api/admin/turnstile:
 *   get:
 *     tags: [Admin]
 *     summary: Tarayıcı girişi bot koruması durumu (enabled, siteKey, secretConfigured, webPanelMode; gizli anahtar yok)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await readTurnstileAdminView() });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/turnstile:
 *   put:
 *     tags: [Admin]
 *     summary: Bot korumasını aç/kapat + site anahtarı; anahtarsız açma 400 TURNSTILE_KEYS_MISSING
 *     security: [{ bearerAuth: [] }]
 */
router.put("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = updateSchema.parse(req.body);
    const data = await updateTurnstileConfig(req.user!.userId, body);
    res.status(200).json({ success: true, message: "Bot koruması ayarı kaydedildi", data });
  } catch (error) {
    next(error);
  }
});

export default router;
