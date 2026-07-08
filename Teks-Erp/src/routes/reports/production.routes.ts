// =============================================================================
// TeksERP - Production Reports Routes (/api/reports/production)
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  dateRangeSchema,
  reportEnvelope,
  resolveDateRange,
} from "../../services/reports/_shared";
import {
  getMachineUsage,
  getOperatorPerformance,
  getScrapSummary,
  getStationEfficiency,
  getTravelerTrace,
} from "../../services/reports/production.report.service";
import { AppError } from "../../utils/app-error";

const router = Router();
const guard = [verifyToken, requirePermission("report:production")];

/**
 * @openapi
 * /api/reports/production/station-efficiency:
 *   get:
 *     tags: [Reports]
 *     summary: İstasyon verimliliği (rulo sayısı, metraj, ort. süre)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 */
router.get("/station-efficiency", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getStationEfficiency(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/production/operator-performance:
 *   get:
 *     tags: [Reports]
 *     summary: Operatör performans listesi (op türü kırılımıyla)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/operator-performance", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    // F247: limit sürücü uca bağlandı — servis 50 default'unu artık sabitleyip yok saymıyor.
    const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(req.query.limit);
    const data = await getOperatorPerformance(range, limit);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/production/machine-usage:
 *   get:
 *     tags: [Reports]
 *     summary: Makine başına işlem ve rulo sayısı
 *     security: [{ bearerAuth: [] }]
 */
router.get("/machine-usage", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getMachineUsage(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

const traceSchema = z.object({
  rollId: z.string().uuid("Geçersiz rulo id"),
});

/**
 * @openapi
 * /api/reports/production/traveler-trace:
 *   get:
 *     tags: [Reports]
 *     summary: Tek rulonun refakat kartı izi (hareket + operasyon timeline)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: rollId
 *         required: true
 *         schema: { type: string, format: uuid }
 */
router.get("/traveler-trace", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rollId } = traceSchema.parse(req.query);
    const data = await getTravelerTrace(rollId);
    if (!data) throw AppError.notFound("Rulo bulunamadı");
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/production/scrap:
 *   get:
 *     tags: [Reports]
 *     summary: Fire & hurda özeti (günlük seri + defect kırılımı)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/scrap", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getScrapSummary(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

export default router;
