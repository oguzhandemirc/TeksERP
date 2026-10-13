// =============================================================================
// G5 — yalnız-okuma DB erişimi — /api/admin/read-only-db
// =============================================================================
// YALNIZ en yetkili hesap (kullanıcı kararı 2026-10-12): supapsız `requireSystemAccountOr404`
// (403). `app.ts`te genel `/api/admin` router'ından ÖNCE mount edilir. Parola yalnız POST yanıtında
// bir kez döner, yanıt önbelleğe alınmaz (`no-store`).
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireSystemAccountOr404 } from "../middlewares/system-account.middleware";
import { getReadOnlyDbStatus, rotateReadOnlyDbPassword } from "../services/read-only-db.service";
import "../types/express-augment";

const router = Router();

router.use(verifyToken, requirePermission("admin:settings"), requireSystemAccountOr404);

/**
 * @openapi
 * /api/admin/read-only-db:
 *   get:
 *     tags: [Admin]
 *     summary: Yalnız-okuma DB rolü — durum ve bağlantı bilgisi (yalnız sistem hesabı)
 *     description: >
 *       Rol göçünün kurduğu `<sahip>_okuma` rolünün durumu (HAZIR · KAPALI · KURULUMDA_YOK),
 *       veritabanı adı, backend'in bağlandığı adres, son parola yenileme anı, açık bağlantı sayısı ve
 *       okunamayan (sır) tablo/kolon listesi. Parola DÖNMEZ.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Durum }
 *       403: { description: Sistem hesabı değil }
 */
router.get("/", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await getReadOnlyDbStatus() });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/read-only-db/password:
 *   post:
 *     tags: [Admin]
 *     summary: Okuma rolü parolasını yenile ve BİR KEZ göster (yalnız sistem hesabı)
 *     description: >
 *       Yeni rastgele parola üretir; PostgreSQL'e yalnız SCRAM doğrulayıcısı gider, parola hiçbir yerde
 *       saklanmaz ve yalnız bu yanıtta döner. Eski parola geçersiz olur. Audit
 *       `READ_ONLY_DB_PASSWORD_ROTATED` (parolasız).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ status, password }" }
 *       403: { description: Sistem hesabı değil }
 *       409: { description: "READ_ONLY_DB_UNAVAILABLE — rol bu kurulumda yok ya da girişe kapalı" }
 */
router.post("/password", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await rotateReadOnlyDbPassword(req.user?.userId, req.ip ?? null);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
