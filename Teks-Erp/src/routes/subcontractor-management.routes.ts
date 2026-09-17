// =============================================================================
// TeksERP - Subcontractor Management Routes
// =============================================================================
// Subcontractor (Fason firma) ve SubcontractorCategory CRUD endpoint'leri.

import { Router } from "express";
import {
  SubcontractorManagementController,
  SubcontractorCategoryController,
} from "../controllers/subcontractor-management.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const MOBILE_FASON_READ = ["mobile:fason-sevk", "mobile:fason-kabul"] as const;

// ─── /api/subcontractors ────────────────────────────────────────────────────
const subcontractorRouter = Router();
const subCtrl = new SubcontractorManagementController();

/**
 * @openapi
 * /api/subcontractors:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason firma listesi (categoryId filter desteklenir)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[categoryId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string }
 *       - in: query
 *         name: filter[customerId]
 *         description: "Bağlı cari (uuid ya da CSV); `null` = yalnız BAĞSIZ fasonlar (tedarikçi seçicisinin fason bacağı)"
 *         schema: { type: string }
 *     responses:
 *       200: { description: Liste (her satırda bağlı cari `customer {id,code,name,type}` ya da null) }
 */
subcontractorRouter.get("/", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ, "mobile:hizli-is-emri"), subCtrl.findAll);

/**
 * @openapi
 * /api/subcontractors/{id}:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason firma detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Fason firma }
 *       404: { description: Bulunamadı }
 */
subcontractorRouter.get("/:id", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ, "mobile:hizli-is-emri"), subCtrl.findById);

/**
 * @openapi
 * /api/subcontractors:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason firma oluştur (pasif kod varsa yeniden aktive eder)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:        { type: string }
 *               name:        { type: string }
 *               taxNumber:   { type: string, nullable: true }
 *               phone:       { type: string, nullable: true }
 *               address:     { type: string, nullable: true }
 *               isFavorite:  { type: boolean }
 *               categoryIds: { type: array, items: { type: string, format: uuid } }
 *               customerId:  { type: string, format: uuid, nullable: true, description: "Bağlı cari kartı (fason = carinin rolü); cari SUPPLIER/BOTH olmalı (CUSTOMER → 400), aynı cariye ikinci profil 409; null/verilmezse bağsız" }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Doğrulama hatası }
 *       409: { description: Kod zaten aktif }
 */
subcontractorRouter.post("/", verifyToken, requirePermission("subcontractor:write"), subCtrl.create);

/**
 * @openapi
 * /api/subcontractors/{id}:
 *   patch:
 *     tags: [Subcontractor]
 *     summary: Fason firma güncelle (categoryIds verilirse kategoriler tümden değişir)
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
 *             properties:
 *               code:        { type: string }
 *               name:        { type: string }
 *               taxNumber:   { type: string, nullable: true }
 *               phone:       { type: string, nullable: true }
 *               address:     { type: string, nullable: true }
 *               isActive:    { type: boolean }
 *               isFavorite:  { type: boolean }
 *               categoryIds: { type: array, items: { type: string, format: uuid } }
 *               customerId:  { type: string, format: uuid, nullable: true, description: "Bağlı cariyi kur/değiştir; null bağı kaldırır (profil silinmez)" }
 *     responses:
 *       200: { description: Güncellendi }
 *       404: { description: Bulunamadı }
 */
subcontractorRouter.patch("/:id", verifyToken, requirePermission("subcontractor:write"), subCtrl.update);

/**
 * @openapi
 * /api/subcontractors/{id}:
 *   delete:
 *     tags: [Subcontractor]
 *     summary: Fason firma pasife al (soft delete)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 *       404: { description: Bulunamadı }
 */
subcontractorRouter.delete("/:id", verifyToken, requirePermission("subcontractor:write"), subCtrl.remove);

// ─── /api/subcontractor-categories ──────────────────────────────────────────
const categoryRouter = Router();
const catCtrl = new SubcontractorCategoryController();

/**
 * @openapi
 * /api/subcontractor-categories:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason kategori listesi (Boyahane, Yıkama, Zımpara...)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 */
categoryRouter.get("/", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ), catCtrl.findAll);

/**
 * @openapi
 * /api/subcontractor-categories/{id}:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason kategori detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kategori }
 *       404: { description: Bulunamadı }
 */
categoryRouter.get("/:id", verifyToken, requireAnyPermission("subcontractor:read", ...MOBILE_FASON_READ), catCtrl.findById);

/**
 * @openapi
 * /api/subcontractor-categories:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason kategori oluştur
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:            { type: string }
 *               name:            { type: string }
 *               description:     { type: string }
 *               appliesColor:    { type: boolean, description: Renk veren kategori (kabulde Roll.colorId set eder) }
 *               appliesProperty: { type: boolean, description: Özellik veren kategori (kabulde RollProperty ekler) }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Doğrulama hatası }
 *       409: { description: Kod zaten aktif }
 */
categoryRouter.post("/", verifyToken, requirePermission("subcontractor:write"), catCtrl.create);

/**
 * @openapi
 * /api/subcontractor-categories/{id}:
 *   patch:
 *     tags: [Subcontractor]
 *     summary: Fason kategori güncelle
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
 *             properties:
 *               code:            { type: string }
 *               name:            { type: string }
 *               description:     { type: string, nullable: true }
 *               isActive:        { type: boolean }
 *               appliesColor:    { type: boolean }
 *               appliesProperty: { type: boolean }
 *     responses:
 *       200: { description: Güncellendi }
 *       404: { description: Bulunamadı }
 */
categoryRouter.patch("/:id", verifyToken, requirePermission("subcontractor:write"), catCtrl.update);

/**
 * @openapi
 * /api/subcontractor-categories/{id}:
 *   delete:
 *     tags: [Subcontractor]
 *     summary: Fason kategori pasife al (soft delete)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 *       404: { description: Bulunamadı }
 */
categoryRouter.delete("/:id", verifyToken, requirePermission("subcontractor:write"), catCtrl.remove);

export { subcontractorRouter, categoryRouter as subcontractorCategoryRouter };
