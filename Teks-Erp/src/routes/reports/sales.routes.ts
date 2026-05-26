// =============================================================================
// TeksERP - Sales Reports Routes
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
  getLateDeliveries,
  getOrderFulfillment,
} from "../../services/reports/sales.report.service";

const router = Router();
const guard = [verifyToken, requirePermission("report:sales")];

router.get("/order-fulfillment", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getOrderFulfillment(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

router.get("/late-delivery", ...guard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getLateDeliveries();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
