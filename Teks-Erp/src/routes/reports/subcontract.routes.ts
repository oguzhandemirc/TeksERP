// =============================================================================
// TeksERP - Subcontract Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  dateRangeSchema,
  reportEnvelope,
  resolveDateRange,
} from "../../services/reports/_shared";
import {
  getOpenDispatches,
  getSubcontractorPerformance,
} from "../../services/reports/subcontract.report.service";

const router = Router();
const guard = [verifyToken, requirePermission("report:subcontract")];

router.get("/performance", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getSubcontractorPerformance(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

router.get("/open-dispatches", ...guard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getOpenDispatches();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
