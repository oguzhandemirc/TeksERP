// İplik lif bileşimi (K7) + kumaş hesaplanan kompozisyonu — ürün kartı izinleriyle (okuma `item:read`, yazma `item:write`).
// İki ayrı alt yola bağlı (app.ts, `/api/items`ten ÖNCE): kapı yalnız bu yolları kapsar. Modül kapısı yok (ana veri).
import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { replaceItemFibers } from "../services/item-fiber.service";
import { computedCompositionForItem } from "../services/fabric-composition.service";

/** `/api/items/:id/fibers` — dosya başı toplu kapı (BE-30); izin kodu statik (test_permission_catalog AST'i çözer). */
const router = Router({ mergeParams: true });
router.use(verifyToken, requirePermission("item:write"));
export const itemFiberRouter = router;

/**
 * @openapi
 * /api/items/{id}/fibers:
 *   put:
 *     tags: [Items]
 *     summary: İplik kartının lif bileşimini değiştirir (liste tamamen yenilenir)
 *     description: |
 *       Gövde `{ fibers: [{ fiberTypeId, pct }] }`; yalnız İPLİK kartı. Paylar 0 < p ≤ 100, toplam TAM 100;
 *       boş liste bileşimi temizler. Pasif lif türü yeni satıra giremez (kartta olan korunur).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ success, data: [{ fiberTypeId, pct, fiberType: { id, name, abbreviation } }] }" }
 *       400: { description: "ITEM_FIBER_SUM_NOT_100 · ITEM_FIBER_YARN_ONLY · ITEM_FIBER_DUPLICATE · ITEM_FIBER_TYPE_INACTIVE · ITEM_FIBER_TYPE_NOT_FOUND · ITEM_FIBER_INVALID" }
 *       404: { description: Ürün bulunamadı }
 */
itemFiberRouter.put("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { fibers?: unknown };
    const data = await replaceItemFibers(assertValidUuid(req.params.id), body.fibers ?? [], req.user?.userId);
    res.json({ success: true, data, message: "Lif bileşimi kaydedildi" });
  } catch (err) {
    next(err);
  }
});

/** `/api/items/:id/computed-composition` */
export const itemCompositionRouter = Router({ mergeParams: true });
itemCompositionRouter.use(verifyToken, requirePermission("item:read"));

/**
 * @openapi
 * /api/items/{id}/computed-composition:
 *   get:
 *     tags: [Items]
 *     summary: Kumaş kartının iplik paylarından hesaplanan kompozisyonu
 *     description: |
 *       Çözgü + atkı ipliklerinin firesiz kg/m payı (maliyet motoru) × ipliklerin lif bileşimi. Eksik yapı ya da
 *       lif bileşimi girilmemiş iplik → `parts`/`text` null (bilinmiyor). `manual` = kartın elle düzeltmesi.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ success, data: { status: OK|NOT_FABRIC|MISSING_STRUCTURE|MISSING_FIBER, parts, text, manual, missingYarns } }" }
 *       404: { description: Ürün bulunamadı }
 */
itemCompositionRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await computedCompositionForItem(assertValidUuid(req.params.id)) });
  } catch (err) {
    next(err);
  }
});
