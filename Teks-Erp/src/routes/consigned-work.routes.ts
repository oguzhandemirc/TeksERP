// =============================================================================
// TeksERP — İÇERİDEKİ İŞLER (emanet; ister 3.2) — salt okuma
// =============================================================================
// Kapı sırası: `verifyToken` → `requireEmanetEnabled` → `roll:read` (yeni izin YOK; envanterin okuma izni).
// =============================================================================
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireEmanetEnabled } from "../middlewares/module.middleware";
import { getConsignedWorkSummary } from "../services/roll-owner.service";

const router = Router();
router.use(verifyToken, requireEmanetEnabled);
router.use(requirePermission("roll:read"));

/**
 * @openapi
 * /api/consigned-work:
 *   get:
 *     tags: [Inventory]
 *     summary: İçerideki İşler — müşteri başına içerideki emanet top/metre, durum kırılımıyla (ister 3.2)
 *     description: |
 *       Ölü (K18) · sevk edilmiş · fire · fason dönüşünde kapanmış toplar DIŞLANIR. Kovalar Envanter sekme kapsamlarının
 *       aynası: waiting (adımsız STOCK) · inProcess (iş emri adımında) · ready (WAREHOUSE/A1_STOCK) · other. Metre = `currentQty`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sahip satırları + toplam }
 *       403: { description: Emanet modülü kapalı (MODULE_DISABLED) ya da roll:read yok }
 */
router.get("/", async (_req, res, next) => {
  try {
    res.json(await getConsignedWorkSummary());
  } catch (e) {
    next(e);
  }
});

export default router;
