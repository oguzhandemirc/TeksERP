// =============================================================================
// TeksERP — Depo (Warehouse) Routes
// =============================================================================
// Fiziksel depo tanımları. Tek depolu kurulumda (fabrika) arayüzde hiçbir depo
// yüzeyi çizilmez — bu uçlar yine çalışır, yalnız kimse çağırmaz. İkinci depo
// açıldığı an tüm depo yüzeyleri kendiliğinden belirir.
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { warehouseService } from "../services/warehouse.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new BaseController(warehouseService);
const router = Router();

/**
 * @openapi
 * /api/warehouses:
 *   get:
 *     tags: [Warehouses]
 *     summary: Depo listesi
 *     description: >
 *       Aktif depolar seçicilerde çıkar. İSTEMCİ KURALI — depo sayısı 1 ise depo
 *       seçici/kolon/filtre çizilmez (tek depolu kurulumda görünür fark olmamalı).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *     responses:
 *       200: { description: Sayfalanmış depo listesi }
 */
router.get(
  "/",
  verifyToken,
  // Depo seçicisi mal kabul / transfer / envanter ekranlarında da açılıyor →
  // salt-okuma yetkisi geniş tutulur (yazma dar kalır).
  requireAnyPermission("warehouse:read", "warehouse:write", "warehouse:transfer", "goods-receipt:read", "goods-receipt:write", "roll:read"),
  controller.findAll,
);

/**
 * @openapi
 * /api/warehouses/{id}:
 *   get:
 *     tags: [Warehouses]
 *     summary: Depo detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Depo detayı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("warehouse:read", "warehouse:write"),
  controller.findById,
);

/**
 * @openapi
 * /api/warehouses:
 *   post:
 *     tags: [Warehouses]
 *     summary: Yeni depo
 *     description: Kod backend'de üretilir (DP+GGAAYY+NNNN) — istemci kodu yok sayılır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:    { type: string, example: "İkinci Depo" }
 *               address: { type: string }
 *               notes:   { type: string }
 *     responses:
 *       201: { description: Oluşturuldu }
 */
router.post("/", verifyToken, requirePermission("warehouse:write"), controller.create);

/**
 * @openapi
 * /api/warehouses/{id}:
 *   patch:
 *     tags: [Warehouses]
 *     summary: Depoyu güncelle
 *     description: VARSAYILAN depo pasife alınamaz (409) — kural cevapsız kalırdı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: Varsayılan depo pasife alınamaz }
 */
router.patch("/:id", verifyToken, requirePermission("warehouse:write"), controller.update);

/**
 * @openapi
 * /api/warehouses/{id}/default:
 *   post:
 *     tags: [Warehouses]
 *     summary: Bu depoyu VARSAYILAN yap
 *     description: >
 *       Depo söylenmeyen her giriş varsayılan depoya düşer. Tek tx: önce eski
 *       varsayılan düşürülür, sonra bu depo işaretlenir (ters sıra partial
 *       unique'e çarpar).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Varsayılan yapıldı }
 *       400: { description: Pasif depo varsayılan yapılamaz }
 *       404: { description: Bulunamadı }
 */
router.post("/:id/default", verifyToken, requirePermission("warehouse:write"), async (req, res, next) => {
  try {
    res.status(200).json(await warehouseService.setDefault(req.params.id as string, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warehouses/{id}:
 *   delete:
 *     tags: [Warehouses]
 *     summary: Depoyu pasife al
 *     description: Soft-delete. Varsayılan depo pasife alınamaz.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 *       409: { description: Varsayılan depo }
 */
router.delete("/:id", verifyToken, requirePermission("warehouse:write"), controller.remove);

/**
 * @openapi
 * /api/warehouses/{id}/permanent:
 *   delete:
 *     tags: [Warehouses]
 *     summary: Depoyu KALICI sil
 *     description: >
 *       Yalnız hiç kaydı olmayan (top/fiş/transfer/hareket) ve varsayılan olmayan
 *       depo silinebilir. Bağımlılık varsa 409 + sayılar.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kalıcı silindi }
 *       409: { description: Bağlı kayıt var / varsayılan depo }
 */
router.delete("/:id/permanent", verifyToken, requirePermission("warehouse:write"), controller.hardRemove);

export default router;
