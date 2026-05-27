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
 *     description: |
 *       Legacy mode (default): `{ success, data: [] }` — `take: limit ?? 100`.
 *       Cursor mode: `?cursor=...` veya `?mode=cursor` → `{ success, data, pagination: { nextCursor, hasMore, limit } }`.
 *       Mobil infinite scroll cursor mode kullanır; mevcut Electron/tartı-paket çağrıları legacy moddadır.
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", verifyToken, requireAnyPermission("quality:read", "mobile:tambur", "mobile:tarti-paket", "mobile:depo"), controller.listSwatches);

/**
 * @openapi
 * /api/swatches/stats:
 *   get:
 *     tags: [Swatches]
 *     summary: Kartela özet istatistikleri (TÜM filtreye uyan)
 *     description: |
 *       Liste sayfaya bağlıdır; bu endpoint filtreye uyan tüm kartelaların
 *       aggregate'ini döner: `{ count, totalLength }`.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/stats",
  verifyToken,
  requireAnyPermission("quality:read", "mobile:tambur", "mobile:tarti-paket", "mobile:depo"),
  controller.getSwatchStats
);

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
  requireAnyPermission("quality:read", "mobile:tarti-paket", "mobile:depo"),
  controller.getSwatchByBarcode
);

export default router;
