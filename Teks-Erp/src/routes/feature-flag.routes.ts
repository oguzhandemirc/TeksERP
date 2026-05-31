// =============================================================================
// TeksERP - Feature Flag Routes
// =============================================================================
// Frontend app açılışında 1 kez okur, context'e koyar. Tüm kullanıcılara
// açık (auth gerekli, özel permission yok). Toggle eden admin (admin:settings).
//
// Backend bu flag'leri ENFORCE ETMEZ — sadece UI'ya rehber. Pricing kapalıyken
// API yine currency/unitPrice kabul eder (admin/test araçları için).
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { systemSettingService } from "../services/system-setting.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const router = Router();

const updateSchema = z.object({
  pricingEnabled: z.boolean().optional(),
  targetQuantityEnabled: z.boolean().optional(),
});

/**
 * @openapi
 * /api/feature-flags:
 *   get:
 *     tags: [Feature Flags]
 *     summary: Tüm public feature flag değerleri
 *     description: |
 *       Her kullanıcının erişimi var (auth-only). Frontend app start'ta okuyup
 *       context'e koyar. Şu an: { pricingEnabled }.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: { pricingEnabled: boolean } }
 */
router.get(
  "/",
  verifyToken,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await systemSettingService.getFeatureFlags();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/feature-flags:
 *   patch:
 *     tags: [Feature Flags]
 *     summary: Feature flag toggle (admin)
 *     description: |
 *       Verilmeyen flag'ler dokunulmaz. admin:settings yetkisi gerekli.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pricingEnabled: { type: boolean }
 *     responses:
 *       200: { description: Güncel flag değerleri }
 */
router.patch(
  "/",
  verifyToken,
  requirePermission("admin:settings"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const result = await systemSettingService.setFeatureFlags(
        body,
        req.user?.userId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
