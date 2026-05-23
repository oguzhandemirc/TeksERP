// =============================================================================
// TeksERP - Station Capability Routes
// =============================================================================
// Bir istasyonun renk + özellik yetkinliklerini yönetir.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { StationCapabilityService } from "../services/station-capability.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const service = new StationCapabilityService();
const router = Router();

const setCapabilitiesSchema = z.object({
  colorIds: z.array(z.string().uuid()).default([]),
  propertyIds: z.array(z.string().uuid()).default([]),
});

/**
 * @openapi
 * /api/station-capabilities:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Tüm istasyonların yetkinlik özeti
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İstasyon başına renk/özellik sayıları }
 */
router.get(
  "/",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ?detailed=true → her istasyonun renk + özellik listesini döner
      if (req.query.detailed === "true") {
        res.status(200).json(await service.listAllDetailed());
        return;
      }
      res.status(200).json(await service.listAll());
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/{stationId}:
 *   get:
 *     tags: [StationCapabilities]
 *     summary: Bir istasyonun renk + özellik yetkinlikleri
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ colors, properties }" }
 *       404: { description: İstasyon bulunamadı }
 */
router.get(
  "/:stationId",
  verifyToken,
  requirePermission("station:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stationId = req.params.stationId as string;
      res.status(200).json(await service.findByStation(stationId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/station-capabilities/{stationId}:
 *   put:
 *     tags: [StationCapabilities]
 *     summary: İstasyonun renk + özellik yetkinliklerini topluca değiştir
 *     description: Replace semantics — eski liste silinip yeni liste yazılır.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               colorIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *               propertyIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncel yetkinlikler döner }
 */
router.put(
  "/:stationId",
  verifyToken,
  requirePermission("station:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stationId = req.params.stationId as string;
      const body = setCapabilitiesSchema.parse(req.body);
      const result = await service.setCapabilities(
        stationId,
        body,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
