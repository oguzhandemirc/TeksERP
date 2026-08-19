// =============================================================================
// TeksERP - FabricProperty (Kumaş Özellik Kataloğu) Routes
// =============================================================================
// Kumaş özellik kataloğu — Yanmazlık, Kayganlık, Su Geçirmezlik vb.
// Türetilmiş Item'a ItemProperty M:N ile bağlanır.
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { FabricPropertyService } from "../services/fabric-property.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

// Kod (`OZL+GGAAYY+NNNN`) backend'de üretilir — bkz. FabricPropertyService.create.
// `uniqueField` BİLEREK verilmedi: kod backend-üretimli olduğundan generic create'in
// INSERT-öncesi `findFirst` ön-kontrolü (aktif duplicate → 409) yalnızca eşzamanlı
// iki create aynı sıra no'yu okuduğunda tetiklenir ve P2002 olmadığı için
// withBarcodeRetry onu YAKALAYAMAZDI. Ön-kontrol olmadan çakışma DB `@unique`'e
// düşer → P2002 → withBarcodeRetry taze sıra no ile kendini onarır (order/shipment/
// çuval üreteçleriyle aynı desen). Pasif-kayıt reactivate yolu zaten ölüydü
// (taze üretilen kod hiçbir eski kodla eşleşmez).
// `stationCapabilities` nested-create olarak beyan edilir: özellik ve onu
// uygulayacak istasyon bağları TEK insert'te doğar (bkz. FabricPropertyService
// başlığı — bağsız özellik ara durumu doğmasın).
// `defaultInclude` istasyon bağlarını listeye de taşır; panelin "hiçbir istasyona
// bağlı değil" rozetini basabilmesi buna dayanır. Tablo master-data ölçeğinde
// (onlarca satır) olduğu için join maliyeti ihmal edilebilir.
// `values` de nested-create: SEÇİM tipli özellik DEĞERSİZ doğamaz (bağsız
// özellik ara durumuyla birebir aynı gerekçe — tanımlı ama hiçbir ekranda
// seçilemez). `defaultInclude`'a alınır ki panel ve tablet listeyi tek istekte
// görsün; master-data ölçeğinde (özellik başına birkaç satır) maliyet ihmal
// edilebilir.
export const fabricPropertyService = new FabricPropertyService({
  modelName: "fabricProperty",
  tableName: "FABRIC_PROPERTY",
  searchFields: ["name", "category", "description"],
  codeSearchFields: ["code"],
  nestedCreateFields: ["stationCapabilities", "values"],
  defaultInclude: {
    stationCapabilities: {
      select: {
        stationId: true,
        station: { select: { id: true, code: true, name: true, isActive: true } },
      },
    },
    values: {
      select: { id: true, code: true, name: true, sortOrder: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    },
  },
  duplicateNameField: "name",
  entityLabel: "özellik",
});

const controller = new BaseController(fabricPropertyService);
const router = Router();

/**
 * @openapi
 * /api/fabric-properties:
 *   get:
 *     tags: [FabricProperties]
 *     summary: Kumaş özellik listesi
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
 *         name: filter[category]
 *         schema: { type: string }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "sortOrder:asc" }
 *     responses:
 *       200: { description: Sayfalanmış özellik listesi }
 */
// Hızlı İş Emri (mobil) hedef özellik seçicisi bu listeyi okur — saha kullanıcısında
// `property:read` yok. `color.routes.ts` GET'i ile aynı genişletme; yazma uçları
// yalnız `property:write` olarak kalır.
router.get(
  "/",
  verifyToken,
  requireAnyPermission("property:read", "mobile:hizli-is-emri", "mobile:kumas"),
  controller.findAll,
);

/**
 * @openapi
 * /api/fabric-properties/{id}:
 *   get:
 *     tags: [FabricProperties]
 *     summary: Özellik detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Özellik detayı }
 *       404: { description: Bulunamadı }
 */
// BENZER KAYITLAR — mükerreri REDDETMEK yerine ÖNLEMEK için (2026-08-19).
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: bu uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye
// lazımdır; okuma iznine bakmak görünürlüğü gereksiz genişletirdi.
router.get("/similar-names", verifyToken, requirePermission("property:write"), controller.similarNames);

router.get(
  "/:id",
  verifyToken,
  requireAnyPermission("property:read", "mobile:hizli-is-emri", "mobile:kumas"),
  controller.findById,
);

/**
 * @openapi
 * /api/fabric-properties:
 *   post:
 *     tags: [FabricProperties]
 *     summary: Yeni özellik oluştur
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, stationIds]
 *             properties:
 *               name:        { type: string, example: "Yanmazlık" }
 *               stationIds:
 *                 type: array
 *                 description: >
 *                   Özelliği uygulayacak istasyon(lar). ZORUNLU ve en az bir eleman —
 *                   istasyonsuz özellik hiçbir iş emrinde seçilemez.
 *                 items: { type: string, format: uuid }
 *               category:    { type: string, example: "Dayanıklılık" }
 *               description: { type: string }
 *               color:       { type: string, example: "#dc2626" }
 *               sortOrder:   { type: integer, default: 0 }
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: stationIds eksik/boş veya istasyon özellik kazandıramıyor }
 *       409: { description: Kod zaten mevcut }
 */
router.post("/", verifyToken, requirePermission("property:write"), controller.create);

/**
 * @openapi
 * /api/fabric-properties/{id}:
 *   patch:
 *     tags: [FabricProperties]
 *     summary: Özelliği güncelle
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
 *               name:        { type: string }
 *               stationIds:
 *                 type: array
 *                 description: >
 *                   Verilirse istasyon bağları replace edilir (yine en az bir eleman).
 *                   Hiç verilmezse bağlara DOKUNULMAZ.
 *                 items: { type: string, format: uuid }
 *               category:    { type: string }
 *               description: { type: string }
 *               color:       { type: string }
 *               sortOrder:   { type: integer }
 *               isActive:    { type: boolean }
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", verifyToken, requirePermission("property:write"), controller.update);

/**
 * @openapi
 * /api/fabric-properties/{id}:
 *   delete:
 *     tags: [FabricProperties]
 *     summary: Özelliği pasife al
 *     description: Soft-delete. Mevcut ItemProperty kayıtları korunur (RESTRICT FK).
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
