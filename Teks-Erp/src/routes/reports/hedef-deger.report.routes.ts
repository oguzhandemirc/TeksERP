// =============================================================================
// /api/reports/sales/hedef-deger-ihtiyaci — kuşak / hedef değer ihtiyacı (SY-F1, tasarım §7.5/6)
// =============================================================================
// Sipariş çekirdek modüldür (modül kapısı yok); izin `report:sales`. Tanınmayan parametre 400 (fail-closed).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/rbac.middleware";
import { requireReportOpen } from "../../middlewares/report.middleware";
import { buildTargetValueNeedSunumu, targetValueNeedReport } from "../../services/reports/target-value-need.report";

const router = Router();
router.use(verifyToken);

export const targetValueNeedQuerySchema = z.object({
  musteriId: z.string().uuid("Geçersiz müşteri").optional(),
  urunId: z.string().uuid("Geçersiz ürün").optional(),
}).strict();

/**
 * @openapi
 * /api/reports/sales/hedef-deger-ihtiyaci:
 *   get:
 *     tags: [Reports]
 *     summary: Kuşak / hedef değer ihtiyacı — açık sipariş kalemi × hedef değer → kalan metre ve beklenen top (top boyu yoksa "bilinmiyor" sayılır)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: musteriId, schema: { type: string, format: uuid } }
 *       - { in: query, name: urunId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "v2 sunum zarfı + data.detay (satirlar[ozellik, deger, degerKodu, kalemSayisi, kalanMetre, beklenenTop, topuBilinmeyenKalem] · ozet · meta)" }
 *       400: { description: Tanınmayan ya da geçersiz parametre }
 *       403: { description: Rapor kapalı ya da yetki yok }
 */
router.get("/hedef-deger-ihtiyaci", requireReportOpen("sales/hedef-deger-ihtiyaci"), requirePermission("report:sales"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = targetValueNeedQuerySchema.parse(req.query);
    const detay = await targetValueNeedReport(q);
    res.status(200).json({ success: true, data: { ...buildTargetValueNeedSunumu(detay, q), detay } });
  } catch (e) {
    next(e);
  }
});

export default router;
