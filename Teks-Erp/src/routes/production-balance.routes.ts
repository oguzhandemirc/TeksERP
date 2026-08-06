// =============================================================================
// TeksERP - Ürün Dengesi (MRP net ihtiyaç) routes
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { ProductionBalanceService } from "../services/production-balance.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import "../types/express-augment";

const service = new ProductionBalanceService();
const router = Router();

/**
 * @openapi
 * /api/production-balance:
 *   get:
 *     tags: [Operations]
 *     summary: Ürün dengesi — (ürün+renk) grubu başına denge, en kırılımı specs[]
 *     description: >
 *       (ürün+renk) grubu için MRP net ihtiyaç. talep = Σ(istenen−sevk) açık
 *       siparişler; depo = sevksiz WAREHOUSE (en birebir); üretimde = canlı WO
 *       hedef-spec in-flight. üretilecek = max(0, talep−depo−üretimde). Ham kumaşın
 *       eni önemsiz olduğu için ham (= sevksiz STOCK) ve malzeme açığı GRUP düzeyinde
 *       tek hesaplanır (en-agnostik havuz; malzeme açığı = max(0, Σüretilecek−ham)).
 *       Talep/depo/üretimde/üretilecek en kırılımı her grubun specs[]'inde; drill-down:
 *       katkı veren siparişler + WO'lar.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: itemId
 *         schema: { type: string }
 *         description: "Verilirse denge yalnız bu ürün(ler) için hesaplanır. Çoklu seçim virgülle: `itemId=a,b`."
 *     responses:
 *       200: { description: "Spec başına denge listesi" }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("workorder:read", "order:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // itemId plain String FK — eşleşmeyen değer boş sonuç verir (Prisma hatası yok).
      // CSV (`a,b`) da bir string'dir ve buradan AYNEN geçer; listeye çevirmeyi
      // servis yapar (`readIdCondition`) — burada bölersek iki yerde iki sözleşme olur.
      const itemId =
        typeof req.query.itemId === "string" && req.query.itemId
          ? req.query.itemId
          : undefined;
      const result = await service.getBalance({ itemId });
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
