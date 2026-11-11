// =============================================================================
// TeksERP - Dashboard Aggregation Routes
// =============================================================================
// Admin dashboard'a özel, mevcut CRUD endpoint'lerinden türetilemeyecek
// aggregate metrikler. Her endpoint salt-okunur; CUD yok. İş mantığı
// DashboardService'te (Routes→Services); route yalnız HTTP + yetki katmanı.

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { z } from "zod";
import { DashboardService } from "../services/dashboard.service";
import { getPanoSummary, PANO_ROUTE_PERMISSIONS } from "../services/dashboard/pano.service";
import { getPanoHareketler, PANO_HAREKET_ROUTE_PERMISSIONS } from "../services/dashboard/pano-hareketler.service";
import { PANO_DONEMLERI } from "../services/dashboard/pano-donem";

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

/** Pano sorgusu — tanınmayan anahtar 400 (fail-closed); dönem verilmezse bugün. */
export const panoQuerySchema = z.object({ donem: z.enum(PANO_DONEMLERI).optional() }).strict();
export const panoHareketQuerySchema = z.object({}).strict();

/**
 * @openapi
 * /api/dashboard/pano:
 *   get:
 *     tags: [Dashboard]
 *     summary: Açılış panosu — KPI, eğilim, dağılım, en çok, stok/fason/tezgah/bekleyen/finans özetleri
 *     description: |
 *       Dönem fabrika dilimindedir (bugun · hafta = son 7 gün · ay = son 30 gün · yil = son 12 ay);
 *       KPI'lar aynı uzunlukta geri kaydırılmış önceki dönemle kıyaslanır (önceki 0 → yüzde null).
 *       Kutu başına izin + modül kapısı: kapalı/izinsiz kutu `null` döner, hata değil.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: donem
 *         schema: { type: string, enum: [bugun, hafta, ay, yil], default: bugun }
 */
router.get(
  "/pano",
  verifyToken,
  requireAnyPermission(...PANO_ROUTE_PERMISSIONS),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = panoQuerySchema.parse(req.query);
      const data = await getPanoSummary(q.donem ?? "bugun", req.user!);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @openapi
 * /api/dashboard/pano/hareketler:
 *   get:
 *     tags: [Dashboard]
 *     summary: Açılış panosu — son 8 hareket (sipariş · sevk · fason giden/dönen · mal kabul · gelen belge)
 *     description: Tür başına liste ucunun izni + modülü; görülemeyen tür akışa girmez (`turler` listesi).
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/pano/hareketler",
  verifyToken,
  requireAnyPermission(...PANO_HAREKET_ROUTE_PERMISSIONS),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      panoHareketQuerySchema.parse(req.query);
      const data = await getPanoHareketler(req.user!);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
