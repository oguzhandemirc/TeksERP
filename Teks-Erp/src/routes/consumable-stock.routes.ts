// Sarf stoğu (kuşak / kurşun şeridi) — okuma uçları. Yazım mal kabul ve üretim izinden doğar (helpers/consumable-stock.helper).
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { requireTicaretEnabled } from "../middlewares/module.middleware";
import { AppError } from "../utils/app-error";
import { listConsumableMovements, listConsumableStock } from "../services/consumable-stock.service";

const router = Router();
router.use(verifyToken, requireTicaretEnabled);

const uuidCsv = z
  .string()
  .max(4000)
  .refine((v) => v.split(",").every((s) => z.uuid().safeParse(s.trim()).success), { message: "Geçersiz kalem kimliği." });
const listQuery = z.strictObject({
  search: z.string().max(100).optional(),
  itemId: uuidCsv.optional(),
  belowMin: z.enum(["1", "0", "true", "false"]).optional(),
});
const movementQuery = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * @openapi
 * /api/consumable-stock:
 *   get:
 *     tags: [ConsumableStock]
 *     summary: Sarf kalemlerinin stok bakiyesi (eksi bakiye ve asgari altı işaretli)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 100 }
 *       - in: query
 *         name: itemId
 *         schema: { type: string }
 *         description: UUID ya da virgüllü UUID listesi
 *       - in: query
 *         name: belowMin
 *         schema: { type: string, enum: ["1", "0", "true", "false"] }
 *         description: Yalnız bakiyesi asgari stoğun altında olan kalemler
 *     responses:
 *       200: { description: Liste + özet }
 */
router.get("/", requireAnyPermission("goods-receipt:read", "goods-receipt:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listQuery.safeParse(req.query);
    if (!q.success) throw AppError.badRequest("Geçersiz sorgu parametresi.", { code: "CONSUMABLE_STOCK_QUERY_INVALID" });
    const data = await listConsumableStock({
      search: q.data.search,
      itemId: q.data.itemId,
      belowMin: q.data.belowMin === "1" || q.data.belowMin === "true",
    });
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/consumable-stock/{itemId}/movements:
 *   get:
 *     tags: [ConsumableStock]
 *     summary: Sarf kaleminin stok hareketleri (yeni → eski, cursor)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Hareketler }
 *       404: { description: Sarf kalemi yok }
 */
router.get("/:itemId/movements", requireAnyPermission("goods-receipt:read", "goods-receipt:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = movementQuery.safeParse(req.query);
    const id = z.uuid().safeParse(req.params.itemId);
    if (!q.success || !id.success) throw AppError.badRequest("Geçersiz sorgu parametresi.", { code: "CONSUMABLE_STOCK_QUERY_INVALID" });
    const data = await listConsumableMovements(id.data, q.data);
    res.status(200).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
