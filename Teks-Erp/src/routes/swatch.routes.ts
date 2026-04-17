// =============================================================================
// TeksERP - Swatch (Kartela) Envanteri Routes
// =============================================================================

import { Router } from "express";
import { TamburController } from "../controllers/tambur.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new TamburController();
const router = Router();

/**
 * @openapi
 * /api/swatches:
 *   get:
 *     tags: [Swatches]
 *     summary: Kartela envanteri (listele)
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", verifyToken, requirePermission("quality:read"), controller.listSwatches);

export default router;
