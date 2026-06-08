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
  // ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli).
  companyName: z.string().trim().max(120).optional(),
  pricingEnabled: z.boolean().optional(),
  targetQuantityEnabled: z.boolean().optional(),
  rawWidthEnabled: z.boolean().optional(),
  returnGradingEnabled: z.boolean().optional(),
  // İş emri parti kodu otomatik mi üretilsin (true) manuel mi girilsin (false=default).
  partyCodeAuto: z.boolean().optional(),
  // Fason Sevk boyahane notunu sahadaki operatör telefondan girebilsin mi (false=default).
  dyehouseNoteMobileEntry: z.boolean().optional(),
  // Mobil cihaz eşleştirmesi zorunlu mu (true=aktif) yoksa pasif mi (false=default).
  devicePairingRequired: z.boolean().optional(),
  // shipping.confirmationEnabled — sevk onay adımı (UI rehberi).
  shipmentConfirmationEnabled: z.boolean().optional(),
  // tambur.overQuantityEnabled — çıkan top metresi giriş metresini aşabilsin mi (ENFORCE).
  tamburOverQuantityEnabled: z.boolean().optional(),
  // Refakat kartı marka/içerik ayarı (firma adı + bölüm görünürlükleri).
  travelerCardConfig: z
    .object({
      companyName: z.string().trim().max(120),
      addressLine: z.string().trim().max(200).default(""),
      phone: z.string().trim().max(60).default(""),
      showOperationGrid: z.boolean(),
      showNotes: z.boolean(),
      showOrders: z.boolean(),
      showProperties: z.boolean().default(true),
      footerNote: z.string().trim().max(500).default(""),
    })
    .optional(),
  // Belge künyesi — irsaliye/çeki üst bloğunda firma adının altına basılır.
  companyLetterhead: z
    .object({
      addressLine: z.string().trim().max(200),
      phone: z.string().trim().max(60),
      taxInfo: z.string().trim().max(120),
    })
    .optional(),
  // Yazdırılan belge içerik ayarı (bölüm görünürlükleri + başlık/imza/footer). Ham map.
  documentsConfig: z
    .record(
      z.string(),
      z.object({
        titleOverride: z.string().trim().max(80).optional(),
        showLetterhead: z.boolean().optional(),
        sections: z.record(z.string(), z.boolean()).optional(),
        signatureLabels: z.array(z.string().trim().max(40)).max(6).optional(),
        showSignatures: z.boolean().optional(),
        footerNote: z.string().trim().max(500).optional(),
      }),
    )
    .optional(),
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
