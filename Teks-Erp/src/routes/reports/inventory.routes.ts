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
import {
  getCustomerOwnedStock,
  getDailyMovements,
  getRollAging,
  getStockDistribution,
} from "../../services/reports/inventory.report.service";

const router = Router();
const guard = [verifyToken, requirePermission("report:inventory")];

router.get("/roll-aging", ...guard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getRollAging();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get("/stock-distribution", ...guard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getStockDistribution();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get("/customer-owned", ...guard, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getCustomerOwnedStock();
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get("/movements", ...guard, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = resolveDateRange(dateRangeSchema.parse(req.query));
    const data = await getDailyMovements(range);
    res.status(200).json(reportEnvelope(data, range));
  } catch (e) {
    next(e);
  }
});

export default router;
