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

/**
 * @openapi
 * /api/swatches/by-barcode/{barcode}:
 *   get:
 *     tags: [Swatches]
 *     summary: Barkoddan kartela bul (TartıPaket scan akışı)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Kartela bulundu veya not-found }
 */
router.get(
  "/by-barcode/:barcode",
  verifyToken,
  requirePermission("quality:read"),
  controller.getSwatchByBarcode
);

export default router;
