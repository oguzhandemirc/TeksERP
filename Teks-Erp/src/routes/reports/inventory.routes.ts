// =============================================================================
// TeksERP - Inventory Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  dateRangeSchema,
  reportEnvelope,
  resolveDateRange,
} from "../../services/reports/_shared";
import { getStockScorecard } from "../../services/reports/stock-scorecard.report.service";

const router = Router();
const guard = [verifyToken, requirePermission("report:inventory")];

/**
 * STOK & ÖLÜ STOK — SNAPSHOT (tarih aralığı YOK).
 * "Şu an rafta ne var, kaç gündür duruyor, siparişi var mı" sorusunun tarih
 * filtresiyle işi yoktur; zarf yine de `resolveDateRange` ile doldurulur ki
 * istemci sözleşmesi tek tip kalsın.
 */
router.get("/scorecard", ...guard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getStockScorecard();
    res.status(200).json(reportEnvelope(data, resolveDateRange({})));
  } catch (e) {
    next(e);
  }
});

export default router;
