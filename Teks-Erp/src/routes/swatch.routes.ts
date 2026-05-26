// =============================================================================
// TeksERP - Swatch (Kartela) Envanteri Routes
// =============================================================================

import { Router } from "express";
import { TamburController } from "../controllers/tambur.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

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
router.get("/", verifyToken, requireAnyPermission("quality:read", "mobile:tambur", "mobile:tarti-paket"), controller.listSwatches);

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
  requireAnyPermission("quality:read", "mobile:tarti-paket"),
  controller.getSwatchByBarcode
);

export default router;
