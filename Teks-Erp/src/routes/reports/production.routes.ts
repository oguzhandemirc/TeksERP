// =============================================================================
// TeksERP - Production Reports Routes (/api/reports/production)
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  dateRangeSchema,
  emptyQuerySchema,
  reportEnvelope,
  resolveDateRange,
} from "../../services/reports/_shared";
import { assertValidUuid } from "../../middlewares/uuid-param.middleware";
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
/** Sorgu şemaları DIŞA AÇIK — bekçi bilinmeyen anahtarı doğrudan şemada ölçer (HTTP'siz). */
export const batchSearchQuerySchema = z.object({ q: z.string().max(100).optional() }).strict();
export const operatorPerformanceQuerySchema = dateRangeSchema.extend({ limit: z.coerce.number().int().min(1).max(200).optional() }).strict();
export const travelerTraceQuerySchema = z.object({ rollId: z.string().uuid("Geçersiz rulo id") }).strict();

router.get("/batch-search", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = batchSearchQuerySchema.parse(req.query).q ?? "";
    res.status(200).json({ success: true, data: await searchBatches(q) });
  } catch (e) {
    next(e);
  }
});

/** PARTİ İZLEME — bu partiden kime ne gitti (geri izleme). */
router.get("/batch-trace/:batchId", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    emptyQuerySchema.parse(req.query);
    const data = await getBatchTrace(assertValidUuid(req.params.batchId, "batchId"));
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
    const { limit, ...rangeInput } = operatorPerformanceQuerySchema.parse(req.query);
    const range = resolveDateRange(rangeInput);
    // F247: limit sürücü uca bağlandı; hatalı değer sessiz 50'ye DÜŞMEZ, 400 verir (R5a ④). Verilmezse 50.
    const data = await getOperatorPerformance(range, limit ?? 50);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
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
    const { rollId } = travelerTraceQuerySchema.parse(req.query);
    const data = await getTravelerTrace(rollId);
    if (!data) throw AppError.notFound("Rulo bulunamadı");
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
