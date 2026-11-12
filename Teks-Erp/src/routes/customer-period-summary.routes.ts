// =============================================================================
// Müşteri dönem özeti — Mount: /api/customers/:customerId/period-summary
// =============================================================================
// Salt okuma; ölçü kapıları servis içinde pano ile aynı (`panoGates`), izinsiz ölçü `null`.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { PANO_DONEMLERI } from "../services/dashboard/pano-donem";
import { getCustomerPeriodSummary } from "../services/customer-period-summary.service";
import "../types/express-augment";

const router = Router({ mergeParams: true });
// Dosya başı kapı (BE-30): yeni uç eklenince guard unutulmasın.
router.use(verifyToken, requirePermission("customer:read"));

/** Tanınmayan anahtar ya da dönem 400 (fail-closed); dönem verilmezse ay. */
export const periodSummaryQuerySchema = z.object({ donem: z.enum(PANO_DONEMLERI).optional() }).strict();

/**
 * @openapi
 * /api/customers/{customerId}/period-summary:
 *   get:
 *     tags: [Customers]
 *     summary: Müşterinin dönem özeti (brüt sevk, ciro, sipariş; önceki döneme göre)
 *     description: |
 *       Panonun kaynakları müşteri süzgeciyle: brüt sevk metresi + irsaliye, ciro (sevk günü fiyatı; para birimi
 *       başına, toplanmaz), sipariş adet/metre. Ölçünün izni ya da modülü yoksa alan `null`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: donem
 *         schema: { type: string, enum: [bugun, hafta, ay, yil], default: ay }
 *     responses:
 *       200: { description: "{ donem, aralik, sevk|null, ciro|null, siparis|null }" }
 *       400: { description: Tanınmayan dönem ya da parametre }
 *       404: { description: Cari yok }
 */
router.get("/", async (req, res, next) => {
  try {
    const customerId = assertValidUuid((req.params as Record<string, string>).customerId, "customerId");
    const q = periodSummaryQuerySchema.parse(req.query);
    const user = { userId: req.user?.userId ?? "", permissions: req.user?.permissions ?? [] };
    res.status(200).json({ success: true, data: await getCustomerPeriodSummary(customerId, q.donem ?? "ay", user) });
  } catch (error) {
    next(error);
  }
});

export default router;
