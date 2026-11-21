// =============================================================================
// TeksERP — Tedarikçi kalem kodu ↔ iplik kartı eşlemesi (Seyitoğlu d5)
// =============================================================================
// Mal kabulün yan yüzeyi: öneri (yazmaz), liste, düzelt, kaldır. İzinler mal kabulünkü
// (yeni izin kodu yok); modül kapısı mal kabulle aynı (`requireTicaretEnabled`).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireTicaretEnabled } from "../middlewares/module.middleware";
import {
  listSupplierItemCodes,
  removeSupplierItemCode,
  suggestSupplierItemCode,
  updateSupplierItemCode,
} from "../services/supplier-item-code.service";

const router = Router();
router.use(verifyToken, requireTicaretEnabled);

const READ = requireAnyPermission("goods-receipt:read", "goods-receipt:write");
const WRITE = requirePermission("goods-receipt:write");

/**
 * @openapi
 * /api/supplier-item-codes/suggest:
 *   get:
 *     tags: [SupplierItemCodes]
 *     summary: Tedarikçi kalem kodundan iplik kartı önerisi (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: supplierId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: code
 *         required: true
 *         schema: { type: string, maxLength: 64 }
 *     responses:
 *       200: { description: "{ code, match } — eşleme yoksa match null" }
 */
router.get("/suggest", READ, async (req, res, next) => {
  try {
    const q = z.object({ supplierId: z.string().uuid(), code: z.string().max(64) }).parse(req.query);
    res.status(200).json({ success: true, data: await suggestSupplierItemCode(q.supplierId, q.code) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/supplier-item-codes:
 *   get:
 *     tags: [SupplierItemCodes]
 *     summary: Tedarikçi kalem kodu eşlemeleri
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: supplierId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: itemId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Eşleme listesi (en çok 1000) }
 */
router.get("/", READ, async (req, res, next) => {
  try {
    const q = z.object({ supplierId: z.string().uuid().optional(), itemId: z.string().uuid().optional() }).parse(req.query);
    res.status(200).json({ success: true, data: await listSupplierItemCodes(q) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/supplier-item-codes/{id}:
 *   patch:
 *     tags: [SupplierItemCodes]
 *     summary: Eşlemeyi başka iplik kartına bağla
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId]
 *             properties:
 *               itemId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncel eşleme }
 *       400: { description: İplik olmayan ya da kullanılamaz kart }
 *       409: { description: Eşleme arada değişti }
 */
router.patch("/:id", WRITE, async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ itemId: z.string().uuid() }).parse(req.body);
    res.status(200).json({ success: true, data: await updateSupplierItemCode(id, body, req.user?.userId) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/supplier-item-codes/{id}:
 *   delete:
 *     tags: [SupplierItemCodes]
 *     summary: Eşlemeyi kaldır (saf yapılandırma — sert silme + audit)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kaldırıldı }
 */
router.delete("/:id", WRITE, async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    res.status(200).json({ success: true, data: await removeSupplierItemCode(id, req.user?.userId) });
  } catch (e) {
    next(e);
  }
});

export default router;
