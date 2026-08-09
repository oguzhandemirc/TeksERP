// =============================================================================
// TeksERP - Customer Reports Routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import {
  getCustomerOrderProfiles,
} from "../../services/reports/customer.report.service";

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

export default router;
