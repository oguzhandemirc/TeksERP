// =============================================================================
// TeksERP - Customer Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  getCustomerOrderProfiles,
} from "../../services/reports/customer.report.service";
import { getCustomerScorecard } from "../../services/reports/customer-scorecard.report.service";
import {
  compareRangeSchema,
  reportEnvelope,
  resolveCompareRange,
  resolveDateRange,
} from "../../services/reports/_shared";

const router = Router();
const guard = [verifyToken, requirePermission("report:customer")];

router.get("/order-profile", ...guard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getCustomerOrderProfiles();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/reports/customer/scorecard:
 *   get:
 *     tags: [Reports]
 *     summary: Müşteri Karnesi — ABC (Pareto) + RFM
 *     description: |
 *       En çok veren, en sık veren ve kaybolmakta olan müşteriyi tek ekranda
 *       gösterir.
 *
 *       İKİ ZAMAN KAPSAMI vardır ve bilinçlidir: ABC sıralaması ve dönem
 *       metrikleri seçili tarih aralığına aittir; "kaç gündür sessiz" ve
 *       "ortalama sipariş aralığı" ise TÜM GEÇMİŞTEN hesaplanır — aksi halde
 *       30 günlük pencerede herkes "sessiz" görünürdü.
 *
 *       Risk ölçüsü mutlak gün değil ORANDIR: geçen süre / o müşterinin kendi
 *       ortalama sipariş aralığı. Ritim en az 3 sipariş ister; daha az geçmişi
 *       olanlar risk listesine girmez ve sayıları ayrıca döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: compare
 *         schema: { type: string, enum: [none, prev, prevYear, custom] }
 *     responses:
 *       200:
 *         description: Müşteri karnesi
 */
router.get("/scorecard", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getCustomerScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

export default router;
