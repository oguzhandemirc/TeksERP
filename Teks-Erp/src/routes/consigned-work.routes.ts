// =============================================================================
// TeksERP — İÇERİDEKİ İŞLER (emanet; ister 3.2) — salt okuma
// =============================================================================
// Kapı sırası: `verifyToken` → `requireEmanetEnabled` → `roll:read` (yeni izin YOK; envanterin okuma izni).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
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
 *     parameters:
 *       - in: query
 *         name: onlyReady
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Yalnız sevke hazır (WAREHOUSE/A1_STOCK) emaneti olan sahipler; toplamlar aynı kapsamdan
 *     responses:
 *       200: { description: Sahip satırları + toplam }
 *       400: { description: Tanınmayan süzgeç (CONSIGNED_WORK_FILTER_INVALID) }
 *       403: { description: Emanet modülü kapalı (MODULE_DISABLED) ya da roll:read yok }
 */
/** Fail-closed: tanınmayan parametre/değer 400 (eski istemci parametre göndermez → bugünkü liste). */
const consignedWorkQuery = z.object({ onlyReady: z.enum(["true", "false"]).optional() }).strict();

router.get("/", async (req, res, next) => {
  try {
    const parsed = consignedWorkQuery.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Geçersiz süzgeç: yalnız onlyReady=true|false kabul edilir.", { code: "CONSIGNED_WORK_FILTER_INVALID" });
    }
    res.json(await getConsignedWorkSummary({ onlyReady: parsed.data.onlyReady === "true" }));
  } catch (e) {
    next(e);
  }
});

export default router;
