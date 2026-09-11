// =============================================================================
// TeksERP - Dashboard Aggregation Routes
// =============================================================================
// Admin dashboard'a özel, mevcut CRUD endpoint'lerinden türetilemeyecek
// aggregate metrikler. Her endpoint salt-okunur; CUD yok. İş mantığı
// DashboardService'te (Routes→Services); route yalnız HTTP + yetki katmanı.

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { DashboardService } from "../services/dashboard.service";

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
      const data = await DashboardService.getDefectsSummary();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

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
 *       - activeCount = açık, geri alınmamış RollMovement (exitedAt IS NULL, revokedAt IS NULL) ile bu istasyonda işlenmekte olan distinct rolls
 *       - todayCompletedCount =
 *           - INTERNAL: bugün exitedAt'i dolan distinct rolls (FINISH/SKIP)
 *           - EXTERNAL: bugün fason kabul ile doğan açık kumaş parça sayısı
 *           - RAW_QC: bugün giren ham mal sayısı
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/stations/live-state",
  verifyToken,
  requirePermission("station:read"),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await DashboardService.getStationsLiveState();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
