/**
 * Açık oturumlar — Sistem → Bağlı İstemciler ekranının oturum sekmesi. Görüntüleme aynı ekranın
 * izin çifti (`admin:settings` ∨ `system:clients`); sonlandırma kullanıcı yönetimi sahibi
 * `admin:users` (giriş kilidi emsali). Kural servis katmanında (`open-session.service.ts`).
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { OPEN_SESSION_LIST_DEFAULT, OPEN_SESSION_LIST_MAX, OpenSessionService } from "../services/open-session.service";
import { listSearchParam } from "../utils/list-search";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireAnyPermission("admin:settings", "system:clients"));

const listQuerySchema = z
  .object({
    search: listSearchParam,
    limit: z.coerce.number().int().min(1).max(OPEN_SESSION_LIST_MAX).default(OPEN_SESSION_LIST_DEFAULT),
  })
  .strict();
const idSchema = z.string().uuid("Geçersiz oturum kimliği");

/**
 * @openapi
 * /api/admin/open-sessions:
 *   get:
 *     tags: [Admin]
 *     summary: Açık oturumlar — kullanıcı, tür, cihaz, uygulama sürümü, son görülme (belirteç kimliği yok)
 *     description: >
 *       İptal edilmemiş ve süresi dolmamış oturumlar; son görülen önce, hiç istek atmamış sonda.
 *       `truncated` = sınırdan fazla açık oturum var.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 500, default: 200 }
 *     responses:
 *       200: { description: Açık oturum listesi }
 *       400: { description: Tanınmayan parametre }
 */
router.get("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, limit } = listQuerySchema.parse(req.query);
    const data = await OpenSessionService.list({ search, limit, currentJti: req.user?.jti ?? null });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/open-sessions/{id}/revoke:
 *   post:
 *     tags: [Admin]
 *     summary: Açık oturumu sonlandır (audit SESSION_REVOKED_BY_ADMIN); açık değilse 409 SESSION_NOT_OPEN, kendi oturumu 400 SESSION_IS_CURRENT, en yetkili hesabın oturumu 403
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Oturum sonlandırıldı }
 *       403: { description: Yetki yok ya da en yetkili hesabın oturumu }
 *       404: { description: Oturum yok }
 *       409: { description: Oturum zaten kapalı }
 */
router.post("/:id/revoke", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = idSchema.parse(req.params.id as string);
    const data = await OpenSessionService.revoke({
      actorUserId: req.user!.userId,
      actorIsSystemAccount: req.isSystemAccount === true,
      actorJti: req.user?.jti ?? null,
      sessionId,
      ipAddress: req.ip ?? null,
    });
    res.status(200).json({ success: true, message: "Oturum sonlandırıldı", data });
  } catch (error) {
    next(error);
  }
});

export default router;
