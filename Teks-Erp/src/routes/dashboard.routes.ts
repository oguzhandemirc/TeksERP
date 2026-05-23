// =============================================================================
// TeksERP - Dashboard Aggregation Routes
// =============================================================================
// Admin dashboard'a özel, mevcut CRUD endpoint'lerinden türetilemeyecek
// aggregate metrikler burada toplanır. Her endpoint salt-okunur; CUD yok.

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import prisma from "../lib/prisma";

const router = Router();

/**
 * @openapi
 * /api/dashboard/defects/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: Açık defect özeti (bekleyen + bugün açılan)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: openCount = isProcessed=false, todayCount = detectedAt bugün
 */
router.get(
  "/defects/summary",
  verifyToken,
  requirePermission("quality:read"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [openCount, todayCount] = await Promise.all([
        prisma.rollError.count({ where: { isProcessed: false } }),
        prisma.rollError.count({ where: { detectedAt: { gte: startOfToday } } }),
      ]);

      res.status(200).json({
        success: true,
        data: { openCount, todayCount },
      });
    } catch (error) {
      next(error);
    }
  },
);

interface StationLiveStateRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  type: string;
  queueCount: number;
  activeCount: number;
  todayCompletedCount: number;
}

/**
 * @openapi
 * /api/dashboard/stations/live-state:
 *   get:
 *     tags: [Dashboard]
 *     summary: İstasyon doluluk anlık görünümü
 *     description: |
 *       Her aktif istasyon için kuyrukta bekleyen, üzerinde işlem yapılan
 *       ve bugün biten roll sayılarını döner.
 *
 *       - queueCount = `Roll.currentStepId` bu istasyondaki step'lere bağlı tüm rolls
 *       - activeCount = açık RollMovement (exitedAt IS NULL) ile bu istasyonda işlenmekte olan distinct rolls
 *       - todayCompletedCount = bugün exitedAt'i dolan distinct rolls (FINISH/SKIP)
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/stations/live-state",
  verifyToken,
  requirePermission("station:read"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const rows = await prisma.$queryRaw<StationLiveStateRow[]>`
        SELECT
          s."id"                                    AS "id",
          s."code"                                  AS "code",
          s."name"                                  AS "name",
          s."kind"::text                            AS "kind",
          s."type"::text                            AS "type",
          COALESCE(q.cnt, 0)::int                   AS "queueCount",
          COALESCE(a.cnt, 0)::int                   AS "activeCount",
          COALESCE(t.cnt, 0)::int                   AS "todayCompletedCount"
        FROM "stations" s
        LEFT JOIN (
          SELECT wos."stationId" AS "stationId", COUNT(r."id")::int AS cnt
          FROM "rolls" r
          JOIN "work_order_steps" wos ON wos."id" = r."currentStepId"
          GROUP BY wos."stationId"
        ) q ON q."stationId" = s."id"
        LEFT JOIN (
          SELECT wos."stationId" AS "stationId", COUNT(DISTINCT rm."rollId")::int AS cnt
          FROM "roll_movements" rm
          JOIN "work_order_steps" wos ON wos."id" = rm."workOrderStepId"
          WHERE rm."exitedAt" IS NULL
          GROUP BY wos."stationId"
        ) a ON a."stationId" = s."id"
        LEFT JOIN (
          SELECT wos."stationId" AS "stationId", COUNT(DISTINCT rm."rollId")::int AS cnt
          FROM "roll_movements" rm
          JOIN "work_order_steps" wos ON wos."id" = rm."workOrderStepId"
          WHERE rm."exitedAt" IS NOT NULL AND rm."exitedAt" >= ${startOfToday}
          GROUP BY wos."stationId"
        ) t ON t."stationId" = s."id"
        WHERE s."isActive" = true
        ORDER BY s."code" ASC
      `;

      res.status(200).json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
