// =============================================================================
// TeksERP - Admin Maintenance Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { AuditService } from "../services/audit.service";
import prisma from "../lib/prisma";
import { z } from "zod";

const router = Router();

const archiveSchema = z.object({
  monthsToKeep: z.number().int().min(1).max(120),
});

/**
 * @openapi
 * /api/admin/system-logs/archive:
 *   post:
 *     tags: [Admin]
 *     summary: Eski sistem loglarını arşivle
 *     description: |
 *       monthsToKeep aydan eski kayıtları system_logs → system_log_archives tablosuna taşır.
 *       Her çağrıda en fazla 5000 satır işlenir. archived = 0 ise işlem tamamlandı.
 *       Önerilen periyot: 6 ay sakla, kalanı arşivle.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [monthsToKeep]
 *             properties:
 *               monthsToKeep:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 120
 *                 example: 6
 *     responses:
 *       200:
 *         description: Arşivleme sonucu — archived=0 ise tamamlandı
 */
router.post(
  "/system-logs/archive",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { monthsToKeep } = archiveSchema.parse(req.body);
      const result = await AuditService.archiveOlderThan(monthsToKeep);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/admin/system-logs/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Sistem log tablo boyutu istatistikleri
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Aktif + arşiv kayıt sayısı ve en eski log tarihi
 */
router.get(
  "/system-logs/stats",
  verifyToken,
  requirePermission("admin:settings"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [activeCount, archiveCount, oldest] = await Promise.all([
        prisma.systemLog.count(),
        prisma.systemLogArchive.count(),
        prisma.systemLog.findFirst({
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);
      res.status(200).json({
        success: true,
        data: { activeCount, archiveCount, oldestLog: oldest?.createdAt ?? null },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
