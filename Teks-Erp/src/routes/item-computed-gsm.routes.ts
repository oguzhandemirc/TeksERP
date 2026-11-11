// Kumaş kartı hesaplanan gramaj (Seyitoğlu temel): salt okuma; izin ürün okumasıyla aynı (`item:read`).
// Modül kapısı yok — maliyet tablolarından yalnız yapı alanı okunur, fiyat okunmaz (rejim bekçisi muafı).
import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { computedGsmForItem } from "../services/fabric-gsm.service";

// `/api/items/:id/computed-gsm` altına bağlı → kapı yalnız bu yolu kapsar.
const router = Router({ mergeParams: true });
// Kapı dosya başında (BE-30): sonradan eklenen uç da kapının arkasında doğar.
router.use(verifyToken, requirePermission("item:read"));

/**
 * @openapi
 * /api/items/{id}/computed-gsm:
 *   get:
 *     tags: [Items]
 *     summary: Kumaş kartının yapıdan hesaplanan ham gramajı
 *     description: |
 *       Çözgü + atkı ipliğinden (fire payları HARİÇ) metre ağırlığı ve gramaj; kaynak maliyet motorunun
 *       iplik kullanımı (yeni formül yok). Eksik veri → ilgili alan null ("bilinmiyor"), hata değil.
 *       `gsm = totalGPerM ÷ (rawWidthCm/100)` · `diffPct = (enteredRawGsm − gsm) ÷ gsm × 100`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: "{ success, data: { rawWidthCm, warpGPerM, weftGPerM, totalGPerM, gsm, enteredRawGsm, diffPct } } — her alan number|null"
 *       404: { description: Ürün bulunamadı }
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await computedGsmForItem(assertValidUuid(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

export default router;
