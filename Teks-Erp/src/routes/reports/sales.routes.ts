// =============================================================================
// TeksERP - Sales Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  compareRangeSchema,
  dateRangeSchema,
  reportEnvelope,
  resolveCompareRange,
  resolveDateRange,
} from "../../services/reports/_shared";
import { getReturnScorecard } from "../../services/reports/return-scorecard.report.service";
import { getShipmentScorecard } from "../../services/reports/shipment-scorecard.report.service";

const router = Router();
const guard = [verifyToken, requirePermission("report:sales")];

/**
 * İADE KARNESİ — dönem karşılaştırmalı.
 * `report:sales` altında: payda sevkiyat, ana kırılım müşteri. Nedenler kalite
 * geri-beslemesidir ama raporu okuyan kişi sevkiyat/müşteri tarafındadır.
 */
/** SEVK & TERMİN KARNESİ (OTIF) — sevk hacmi + zamanında teslim oranı. */
router.get("/shipment-scorecard", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getShipmentScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

router.get("/return-scorecard", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getReturnScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

export default router;
