// =============================================================================
// Geri yükleme kopyaları — /api/admin/db-copies
// =============================================================================
// Yedeği CANLI veritabanına değil YENİ bir veritabanına geri yükleme akışı.
// `admin.routes.ts` zaten ~1300 satır → ayrı dosya; `app.ts`'te genel
// `/api/admin` router'ından ÖNCE mount edilir.
//
// Yetki zinciri `/api/admin/backups` ile BİREBİR AYNI: `admin:settings` +
// `admin:users` (AND). Zayıflatmayın — kopya, tüm kullanıcıların düz
// `quickPin`/`cardToken`'ını taşıyan verinin ta kendisidir (F287) ve ondan
// veritabanı üretmek, yedek indirmekten daha yıkıcıdır.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { AuditService } from "../services/audit.service";
import {
  dropCopy,
  getSwapCommands,
  listDbCopies,
  reverifyCopy,
  startCopyJob,
} from "../services/db-copy.service";
import "../types/express-augment";

const router = Router();

/**
 * @openapi
 * /api/admin/db-copies:
 *   get:
 *     tags: [Admin]
 *     summary: Geri yükleme kopyaları — liste, durum, disk ve yetenek kontrolü
 *     description: >
 *       `<canlı>_restore_<damga>` desenli veritabanlarını listeler. Etkin durum
 *       `pg_database` (gerçek) + `SystemSetting` kaydı (hızlandırıcı) + bellekteki
 *       iş (canlı faz) uzlaştırılarak hesaplanır; yarıda kalmış kopyalar
 *       `interrupted`, kaydı olmayanlar `unverified` olarak işaretlenir ve bunlara
 *       geçiş SUNULMAZ. Ayrıca takas sonrası kenara çekilmiş `_old_` veritabanları,
 *       PGDATA biriminin disk durumu ve `CREATEDB` yetkisi döner.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kopya listesi + disk + yetenekler }
 *       403: { description: Yetki yok (admin:settings + admin:users gerekli) }
 */
router.get(
  "/",
  verifyToken,
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json({ success: true, data: await listDbCopies() });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/admin/db-copies:
 *   post:
 *     tags: [Admin]
 *     summary: Yedeği YENİ bir veritabanına geri yükle (canlıya dokunmaz)
 *     description: >
 *       `CREATE DATABASE` → `pg_restore` → veritabanı ayarlarını replay → doğrula.
 *       **202 döner ve BEKLEMEZ**; ilerleme `GET /api/admin/db-copies` yanıtındaki
 *       `job` alanından yoklanır. Canlı veritabanına HİÇ dokunulmaz.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       202: { description: Kopya oluşturuluyor }
 *       400: { description: Başlatılamadı (yetki/disk/yedek yok/iş sürüyor) }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = z.object({ backupName: z.string().min(1) }).parse(req.body);
      const result = await startCopyJob(body.backupName);
      res.status(result.started ? 202 : 400).json({
        success: result.started,
        message: result.message,
        ...(result.copyName ? { copyName: result.copyName } : {}),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/admin/db-copies/{name}/verify:
 *   post:
 *     tags: [Admin]
 *     summary: Mevcut bir kopyayı yeniden doğrula (idempotent)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: name, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Doğrulama raporu }
 */
router.post(
  "/:name/verify",
  verifyToken,
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json({
        success: true,
        data: await reverifyCopy(req.params.name as string),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/admin/db-copies/{name}:
 *   delete:
 *     tags: [Admin]
 *     summary: Geri yükleme kopyasını sil
 *     description: >
 *       Yalnız `<canlı>_restore_<damga>` desenine UYAN adlar silinebilir (allowlist).
 *       Canlı veritabanı ve takas sonrası `_old_` yedekleri bu uçtan silinemez.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: name, required: true, schema: { type: string } }
 *       - { in: query, name: force, schema: { type: string }, description: "1 → açık bağlantıları kopar" }
 *     responses:
 *       200: { description: Silindi }
 *       409: { description: Açık bağlantı var ya da ad guard'ı reddetti }
 */
router.delete(
  "/:name",
  verifyToken,
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await dropCopy(req.params.name as string, req.query.force === "1");
      res.status(result.ok ? 200 : 409).json({
        success: result.ok,
        message: result.message,
        ...(result.blockedBy ? { blockedBy: result.blockedBy } : {}),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/admin/db-copies/{name}/swap-command:
 *   get:
 *     tags: [Admin]
 *     summary: Takas (ileri) ve geri alma komut bloklarını üret
 *     description: >
 *       Kopyanın etkin durumu **ready** değilse komut ÜRETİLMEZ. Bloklar
 *       `pm2 stop → ön kontrol → iki ALTER DATABASE RENAME (otomatik geri almalı)
 *       → migrate deploy → pm2 start` yapısındadır.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: name, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: İleri + geri alma blokları }
 *       409: { description: Kopya hazır değil }
 */
router.get(
  "/:name/swap-command",
  verifyToken,
  requirePermission("admin:settings"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const name = req.params.name as string;
      const result = await getSwapCommands(name);
      if (!result.ok) {
        res.status(409).json({ success: false, message: result.message });
        return;
      }
      // Geçişi backend YAPMADIĞI için "kim geçişe niyetlendi"nin tek izi burasıdır.
      await AuditService.logEvent({
        category: "SYSTEM",
        action: "DB_SWAP_COMMAND_ISSUED",
        userId: req.user?.userId ?? null,
        payload: { copyName: name, needsMigrateDeploy: result.needsMigrateDeploy },
      });
      res.status(200).json({
        success: true,
        data: { ...result.commands, needsMigrateDeploy: result.needsMigrateDeploy },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
