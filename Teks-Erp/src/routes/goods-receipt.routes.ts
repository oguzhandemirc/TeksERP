// =============================================================================
// TeksERP — Mal Kabul (GoodsReceipt) Routes
// =============================================================================
// Satın alınan malın depoya girişi. Alım-satım kurulumunun ana giriş kapısı;
// üretici fabrikada kullanılmaz (mal KK1'den ham girer). Bu yüzden izinler
// hiçbir varsayılan rol şablonunda YOKTUR — kurulumda elle atanır.
// =============================================================================
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { goodsReceiptService } from "../services/goods-receipt.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { parseQueryParams } from "../utils/query-parser";

const router = Router();

const lineSchema = z.object({
  itemId: z.string().uuid(),
  colorId: z.string().uuid().nullable().optional(),
  initialQty: z.number().positive(),
  weightKg: z.number().positive().nullable().optional(),
  width: z.number().positive().nullable().optional(),
  qualityGrade: z.string().max(64).nullable().optional(),
  foldType: z.string().max(64).nullable().optional(),
  propertyIds: z.array(z.string().uuid()).optional(),
  clientToken: z.string().uuid().optional(),
});

const createSchema = z.object({
  warehouseId: z.string().uuid(),
  supplierId: z.string().uuid().nullable().optional(),
  deliveryNoteNo: z.string().max(64).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  clientToken: z.string().uuid().optional(),
  lines: z.array(lineSchema).max(500).optional(),
});

/**
 * @openapi
 * /api/goods-receipts:
 *   get:
 *     tags: [GoodsReceipts]
 *     summary: Mal kabul fişi listesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[warehouseId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[supplierId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [ACTIVE, CANCELLED] }
 *     responses:
 *       200: { description: Sayfalanmış fiş listesi }
 */
router.get(
  "/",
  verifyToken,
  requireAnyPermission("goods-receipt:read", "goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize, filters, search } = parseQueryParams(req);
      const { rows, total } = await goodsReceiptService.list({ page, pageSize, filters, search });
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
 * /api/goods-receipts/{id}:
 *   get:
 *     tags: [GoodsReceipts]
 *     summary: Fiş detayı (başlık + toplar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Fiş detayı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("goods-receipt:read", "goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ success: true, data: await goodsReceiptService.loadDetail(req.params.id as string) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/goods-receipts:
 *   post:
 *     tags: [GoodsReceipts]
 *     summary: Mal kabul fişi aç (opsiyonel satırlarla)
 *     description: >
 *       Her satır ayrı transaction'da doğar — düşen satır `failed[]` içinde
 *       SEBEBİYLE döner, diğerleri kalır. `clientToken` verilirse fiş
 *       idempotenttir (ağ kopmasında ikinci fiş açılmaz).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Depo/tedarikçi geçersiz }
 */
router.post(
  "/",
  verifyToken,
  requirePermission("goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createSchema.parse(req.body);
      res.status(201).json(await goodsReceiptService.create(input, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/goods-receipts/{id}/lines:
 *   post:
 *     tags: [GoodsReceipts]
 *     summary: Fişe top ekle
 *     description: Mal parça parça gelir — fiş bir KAPTIR, satırlar sonradan eklenebilir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Eklendi (failed[] atlanan satırları taşır) }
 *       409: { description: Fiş iptal edilmiş }
 */
router.post(
  "/:id/lines",
  verifyToken,
  requirePermission("goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lines } = z.object({ lines: z.array(lineSchema).min(1).max(500) }).parse(req.body);
      const result = await goodsReceiptService.addLines(req.params.id as string, lines, req.user?.userId);
      res.status(200).json({
        success: true,
        data: { ...(await goodsReceiptService.loadDetail(req.params.id as string)), failed: result.failed },
        message:
          result.failed.length > 0
            ? `${result.created.length} top eklendi, ${result.failed.length} satır atlandı.`
            : `${result.created.length} top eklendi.`,
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/goods-receipts/{id}/cancel:
 *   post:
 *     tags: [GoodsReceipts]
 *     summary: Fişi iptal et (toplar da iptal edilir)
 *     description: >
 *       "Mal HİÇ girmedi" storno semantiği. İşlem görmüş (sevk edilmiş, üretime
 *       girmiş) top varsa 409 — o toplar önce ayıklanmalı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: İşlem görmüş top var }
 */
router.post(
  "/:id/cancel",
  verifyToken,
  requirePermission("goods-receipt:write"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
      res.status(200).json(await goodsReceiptService.cancel(req.params.id as string, reason, req.user?.userId));
    } catch (e) {
      next(e);
    }
  },
);

export default router;
