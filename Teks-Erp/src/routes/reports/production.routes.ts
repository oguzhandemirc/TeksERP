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
  getOperatorPerformance,
  getTravelerTrace,
} from "../../services/reports/production.report.service";
import { getWipScorecard } from "../../services/reports/wip-scorecard.report.service";
import { getBatchTrace, searchBatches } from "../../services/reports/batch-trace.report.service";
import { AppError } from "../../utils/app-error";

const router = Router();
const guard = [verifyToken, requirePermission("report:production")];

/**
 * PARTİ ARAMA — parti no ya da top barkodu ile ADAY listesi.
 * ⚠️ Daima liste döner: parti numarası P01…P99 arasında DÖNER ve benzersiz
 * DEĞİLDİR (kök CLAUDE.md). Tek sonuç varsaymak, aynı numarayı taşıyan başka
 * bir partinin müşterilerini göstermek olurdu.
 */
router.get("/batch-search", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.status(200).json({ success: true, data: await searchBatches(q) });
  } catch (e) {
    next(e);
  }
});

/** PARTİ İZLEME — bu partiden kime ne gitti (geri izleme). */
router.get("/batch-trace/:batchId", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getBatchTrace(req.params.batchId as string);
    if (!data) {
      res.status(404).json({ success: false, message: "Parti bulunamadı" });
      return;
    }
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * NEREDE TAKILDI (WIP) — anlık bekleyen + dönemsel geçen.
 * Tarih aralığı YALNIZ "geçen" bölümünü etkiler; bekleyen kısım snapshot'tır.
 */
router.get("/wip", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getWipScorecard(range);
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

export default router;
