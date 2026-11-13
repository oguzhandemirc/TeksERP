// =============================================================================
// TeksERP - Color (Renk Kataloğu) Routes
// =============================================================================
// Renk kataloğu — fason dönüşünde rulonun yeni Item kimliğine renk verir.
// Item.colorId buradan FK alır; türetilmiş Item.code'unda da kullanılır.
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { BaseController } from "../controllers/base.controller";
import { ColorService } from "../services/color.service";
import { createColorRecord, takeCreateToken } from "../services/color-item-create.service";
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
  autoCode: { series: "color" },
  // ⚠️ `duplicateNameField` DEĞİL: renk mükerreri ayraç-duyarsız ve rakam-önce
  // katlamayla kontrol ediliyor (`ColorService.assertNameAvailable`). Bu alan
  // yalnız "benzer kayıtlar" ucunu besler, genel guard'ı AÇMAZ.
  similarNameField: "name",
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
router.get("/", verifyToken, requireAnyPermission("property:read", "mobile:hizli-is-emri", "mobile:siparis", "mobile:kumas", "mobile:tambur", "mobile:tarti-paket", "mobile:kk1-yari-mamul", "mobile:dokuma"), controller.findAll);

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
// BENZER KAYITLAR — mükerreri REDDETMEK yerine ÖNLEMEK için (2026-08-19).
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: bu uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye
// lazımdır; okuma iznine bakmak görünürlüğü gereksiz genişletirdi.
router.get("/similar-names", verifyToken, requirePermission("property:write"), controller.similarNames);

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
 *               clientToken: { type: string, format: uuid, description: "Opsiyonel deneme kimliği — aynı token + aynı ad → ilk kayıt (201); farklı ad → 409 CLIENT_TOKEN_COLLISION; renk sonradan pasif/birleşik → 409 COLOR_CREATE_GONE" }
 *               customerIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Rengin atanacağı müşteriler (M:N CustomerColorAlias).
 *     responses:
 *       201: { description: Oluşturuldu }
 *       409: { description: Kod zaten mevcut }
 */
router.post("/", verifyToken, requirePermission("property:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientToken = takeCreateToken(req.body);
    res.status(201).json(await createColorRecord(colorService, req.body, req.user?.userId, clientToken));
  } catch (e) {
    next(e);
  }
});

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
