// =============================================================================
// TeksERP — Depolar Arası Transfer Routes
// =============================================================================
// `warehouse:transfer` AYRI bir izindir: depo ADINI düzeltebilen herkesin STOK
// TAŞIYABİLMESİ istenmiyor (shipping:write ↔ shipping:undo-dispatch emsali).
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { warehouseTransferService } from "../services/warehouse-transfer.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { parseQueryParams } from "../utils/query-parser";

const router = Router();

const createSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  // 500 top üst sınırı: tek transfer tek tx'te koşuyor (perf kuralı 10 —
  // transaction süresi kısa kalmalı).
  rollIds: z.array(z.string().uuid()).min(1).max(500),
  notes: z.string().max(500).nullable().optional(),
  clientToken: z.string().uuid().optional(),
});

/**
 * @openapi
 * /api/warehouse-transfers:
 *   get:
 *     tags: [WarehouseTransfers]
 *     summary: Transfer listesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [COMPLETED, CANCELLED] }
 *       - in: query
 *         name: filter[fromWarehouseId]
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Sayfalanmış transfer listesi }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("warehouse:transfer", "warehouse:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize, filters, search } = parseQueryParams(req);
      const { rows, total } = await warehouseTransferService.list({ page, pageSize, filters, search });
      res.status(200).json({
        success: true,
        data: rows,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouse-transfers/{id}:
 *   get:
 *     tags: [WarehouseTransfers]
 *     summary: Transfer detayı (başlık + taşınan toplar)
 *     description: Kalemler DEFTERDEN okunur — transferin ayrı satır tablosu yoktur.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Transfer detayı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("warehouse:transfer", "warehouse:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ success: true, data: await warehouseTransferService.loadDetail(req.params.id as string) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouse-transfers:
 *   post:
 *     tags: [WarehouseTransfers]
 *     summary: Depolar arası transfer (tek adımlı — anında uygulanır)
 *     description: >
 *       TEK TRANSACTION: ya hepsi taşınır ya hiçbiri. Yarım transfer fiziksel
 *       dünyada karşılığı olmayan bir durumdur. Uygun olmayan top varsa 400 +
 *       SOMUT top listesi (hangi topu ayıklayacağı söylenir).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taşındı }
 *       400: { description: Uygun olmayan top / aynı depo }
 *       409: { description: Toplar bu sırada başka işleme girdi }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("warehouse:transfer"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createSchema.parse(req.body);
      res.status(201).json(await warehouseTransferService.create(input, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/warehouse-transfers/{id}/cancel:
 *   post:
 *     tags: [WarehouseTransfers]
 *     summary: Transferi geri al (storno)
 *     description: >
 *       Toplar kaynak depoya döner. Yalnız toplar HÂLÂ hedef depoda ve serbestse
 *       geri alınabilir — aradan sevk/başka transfer geçtiyse 409.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: Toplar işlem görmüş }
 */
router.post(
  "/:id/cancel",
  verifyToken,
  requirePermission("warehouse:transfer"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
      res.status(200).json(await warehouseTransferService.cancel(req.params.id as string, reason, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

export default router;
