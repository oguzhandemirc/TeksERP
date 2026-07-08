// =============================================================================
// TeksERP - Return (Müşteri İadesi) Routes
// =============================================================================
// QR ile sevk edilmiş top okutulur → Hazır Depo'ya alınır + iade defteri (RollReturn).
// lookup + create = iade alma aksiyonu (mobil İade operatörü / web); list = takip raporu.
// =============================================================================

import { Router } from "express";
import { ReturnController } from "../controllers/return.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new ReturnController();
const router = Router();

/**
 * @openapi
 * /api/returns/lookup:
 *   get:
 *     tags: [Returns]
 *     summary: İade için top sorgula (QR okut)
 *     description: |
 *       Sevk edilmiş (SHIPPED) topu barkodla sorgular; top + geldiği sevkiyat +
 *       o sevkiyatın spec'e uyan aday siparişleri + returnGradingEnabled döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Top + aday siparişler }
 *       400: { description: Top sevk edilmemiş / sevkiyat bağı yok }
 *       404: { description: Top bulunamadı }
 */
router.get(
  "/lookup",
  verifyToken,
  requireAnyPermission("return:write", "mobile:iade"),
  controller.lookup
);

/**
 * @openapi
 * /api/returns:
 *   post:
 *     tags: [Returns]
 *     summary: İade al (top Hazır Depo'ya)
 *     description: |
 *       Top SHIPPED→WAREHOUSE'a çekilir, sevkiyat/çuval bağı kopar; RollReturn
 *       defterine yazılır. Sevk muhasebesine (shippedQty) DOKUNULMAZ — sipariş
 *       kapalı kalır. qualityGradeId yalnız returnGradingEnabled açıkken honor edilir.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId]
 *             properties:
 *               rollId:         { type: string, format: uuid }
 *               orderId:        { type: string, format: uuid, nullable: true }
 *               reasonId:       { type: string, format: uuid, nullable: true }
 *               reasonText:     { type: string, nullable: true }
 *               note:           { type: string, nullable: true }
 *               qualityGradeId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201: { description: İade alındı }
 *       400: { description: Top sevk edilmemiş / geçersiz seçim }
 */
router.post(
  "/",
  verifyToken,
  requireAnyPermission("return:write", "mobile:iade"),
  controller.create
);

/**
 * @openapi
 * /api/returns:
 *   get:
 *     tags: [Returns]
 *     summary: İade Takibi raporu
 *     description: |
 *       Filtre (customerId/orderId/itemId/reasonId + createdAt tarih aralığı) +
 *       toplam (adet + metraj). Cursor (limit/cursor/withTotal) veya array.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İade listesi + toplam }
 */
router.get(
  "/",
  verifyToken,
  // F197: getById (:id) ile parite — mobil iade operatörü listeyi de görebilsin.
  requireAnyPermission("return:read", "return:write", "mobile:iade"),
  controller.list
);

/**
 * @openapi
 * /api/returns/{id}:
 *   get:
 *     tags: [Returns]
 *     summary: İade kaydı detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: İade detayı }
 *       404: { description: Bulunamadı }
 */
router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("return:read", "return:write", "mobile:iade"),
  controller.getById
);

/**
 * @openapi
 * /api/returns/{id}:
 *   patch:
 *     tags: [Returns]
 *     summary: İade kaydını düzelt (neden + not)
 *     description: |
 *       Yalnız defter alanlarını (reasonId/reasonText/note) günceller — topun
 *       statüsü / sevkiyat bağı / kalitesi DEĞİŞMEZ. Gönderilmeyen alan dokunulmaz;
 *       neden zorunluluğu korunur (katalog VEYA serbest metin). İptal edilmiş kayıt
 *       düzeltilemez (409).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reasonId:   { type: string, format: uuid, nullable: true }
 *               reasonText: { type: string, nullable: true }
 *               note:       { type: string, nullable: true }
 *     responses:
 *       200: { description: İade kaydı güncellendi }
 *       400: { description: İade nedeni gerekli / geçersiz }
 *       409: { description: İptal edilmiş iade düzeltilemez }
 */
router.patch(
  "/:id",
  verifyToken,
  requireAnyPermission("return:write", "mobile:iade"),
  controller.edit
);

/**
 * @openapi
 * /api/returns/{id}/cancel:
 *   post:
 *     tags: [Returns]
 *     summary: İadeyi iptal et (geri al)
 *     description: |
 *       Yanlış iade kabulünü geri alır: top iade öncesi haline (SHIPPED + eski
 *       sevkiyat/çuval/kalite) döner, RollReturn iptal işaretlenir (sebep zorunlu).
 *       Yalnız top hâlâ iade-sonrası durumdaysa (WAREHOUSE + sevkiyatsız) yapılabilir.
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 3 }
 *     responses:
 *       200: { description: İade iptal edildi }
 *       400: { description: Sebep eksik }
 *       409: { description: Top işlem görmüş / zaten iptal }
 */
router.post(
  "/:id/cancel",
  verifyToken,
  requireAnyPermission("return:write", "mobile:iade"),
  controller.cancel
);

export default router;
