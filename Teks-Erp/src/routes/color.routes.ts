// =============================================================================
// TeksERP - Color (Renk Kataloğu) Routes
// =============================================================================
// Renk kataloğu — fason dönüşünde rulonun yeni Item kimliğine renk verir.
// Item.colorId buradan FK alır; türetilmiş Item.code'unda da kullanılır.
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { ColorService } from "../services/color.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

export const colorService = new ColorService({
  modelName: "color",
  tableName: "COLOR",
  // ⚠️ MÜŞTERİ ALIAS'I DA ARANIR (2026-08-19): müşterinin bizim ürüne verdiği ad
  // etikete/irsaliyeye basılıyor ama aranamıyordu — "BELLE" diyen müşterinin
  // kastettiği bizim "18152". Sonuç listesi her zaman BİZİM adımızı gösterir.
  searchFields: ["name", "customerAliases.some.alias"],
  codeSearchFields: ["code"],
  defaultInclude: undefined,
  uniqueField: "code",
  // Kod backend-authoritative: `RNK+GGAAYY+NNNN` günlük sıralı (istemci kodu yok sayılır).
  autoCode: { prefix: "RNK" },
});

const controller = new BaseController(colorService);
const router = Router();

/**
 * @openapi
 * /api/colors:
 *   get:
 *     tags: [Colors]
 *     summary: Renk listesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "sortOrder:asc" }
 *     responses:
 *       200: { description: Sayfalanmış renk listesi }
 */
// `mobile:tambur` — Tambur ekranı renk seçicisi (manuel top ekleme + alan
// düzeltme) bu listeyi çağırıyor. 2026-08-17'ye kadar YOKTU: yalnız Tambur
// yetkisi taşıyan operatör sessiz 403 alıyordu (bekçi: test_mobile_screen_permissions).
router.get("/", verifyToken, requireAnyPermission("property:read", "mobile:hizli-is-emri", "mobile:siparis", "mobile:kumas", "mobile:tambur", "mobile:tarti-paket", "mobile:kk1-yari-mamul"), controller.findAll);

/**
 * @openapi
 * /api/colors/{id}:
 *   get:
 *     tags: [Colors]
 *     summary: Renk detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Renk detayı }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", verifyToken, requireAnyPermission("property:read", "mobile:hizli-is-emri"), controller.findById);

/**
 * @openapi
 * /api/colors:
 *   post:
 *     tags: [Colors]
 *     summary: Yeni renk oluştur
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code:      { type: string, example: "MAVI" }
 *               name:      { type: string, example: "Mavi" }
 *               hex:       { type: string, example: "#1d4ed8" }
 *               sortOrder: { type: integer, default: 0 }
 *               customerIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Rengin atanacağı müşteriler (M:N CustomerColorAlias).
 *     responses:
 *       201: { description: Oluşturuldu }
 *       409: { description: Kod zaten mevcut }
 */
router.post("/", verifyToken, requirePermission("property:write"), controller.create);

/**
 * @openapi
 * /api/colors/{id}:
 *   patch:
 *     tags: [Colors]
 *     summary: Rengi güncelle
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
 *               name:      { type: string }
 *               hex:       { type: string }
 *               sortOrder: { type: integer }
 *               isActive:  { type: boolean }
 *               customerIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Verilirse atamalar bu listeyle senkronlanır; verilmezse dokunulmaz.
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", verifyToken, requirePermission("property:write"), controller.update);

/**
 * @openapi
 * /api/colors/{id}:
 *   delete:
 *     tags: [Colors]
 *     summary: Rengi pasife al
 *     description: Soft-delete. Mevcut Item.colorId referansları korunur (RESTRICT FK yok, SET NULL).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", verifyToken, requirePermission("property:write"), controller.remove);

export default router;
