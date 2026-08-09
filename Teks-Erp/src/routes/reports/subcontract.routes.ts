// =============================================================================
// TeksERP - Subcontract Reports Routes
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
import { getSubcontractScorecard } from "../../services/reports/subcontract-scorecard.report.service";

const router = Router();
const guard = [verifyToken, requirePermission("report:subcontract")];

/** FASON KARNESİ — fire (giden ↔ dönen metraj), süre, açık bakiye. */
router.get("/scorecard", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = compareRangeSchema.parse(req.query);
    const range = resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const compareRange = resolveCompareRange(input, range);
    const data = await getSubcontractScorecard(range, compareRange);
    res.status(200).json(reportEnvelope(data, range, compareRange));
  } catch (e) {
    next(e);
  }
});

export default router;
