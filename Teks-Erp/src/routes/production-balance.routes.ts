// =============================================================================
// TeksERP - Ürün Dengesi (MRP net ihtiyaç) routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { ProductionBalanceService } from "../services/production-balance.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import "../types/express-augment";

const service = new ProductionBalanceService();
const router = Router();

/**
 * @openapi
 * /api/production-balance:
 *   get:
 *     tags: [Operations]
 *     summary: Ürün dengesi — spec başına talep/depo/üretimde/ham/üretilecek
 *     description: >
 *       Her ürün (ürün+renk+en) için MRP net ihtiyaç: talep = Σ(istenen−sevk) açık
 *       siparişler; depo = sevksiz WAREHOUSE; üretimde = canlı WO hedef-spec in-flight;
 *       ham = sevksiz STOCK. üretilecek = max(0, talep−depo−üretimde); malzeme açığı =
 *       max(0, üretilecek−ham). Drill-down: katkı veren siparişler + WO'lar.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Spec başına denge listesi" }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("workorder:read", "order:read"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.getBalance();
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
