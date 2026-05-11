// =============================================================================
// TeksERP - Inventory (Roll) Routes
// =============================================================================

import { Router } from "express";
import { InventoryController } from "../controllers/inventory.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new InventoryController();
const router = Router();

/**
 * @openapi
 * /api/rolls:
 *   get:
 *     tags: [Inventory]
 *     summary: Top (Roll) listesi
 *     description: |
 *       Envanterdeki topları filtre, sıralama ve sayfalama ile listeler.
 *       Varsayılan olarak sadece STOCK durumundaki toplar döner.
 *       Diğer durumları görmek için filter[status] kullanın.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Barkod ile arama
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [STOCK, IN_PRODUCTION, PRODUCED, READY_FOR_SHIP, SHIPPED, SCRAP, AT_SUBCONTRACTOR, WAREHOUSE, A1_STOCK, ALL] }
 *       - in: query
 *         name: filter[statusIn]
 *         schema: { type: string }
 *         description: Çoklu status (virgülle ayrılmış). Sekme bazlı filtre için. Örn. "STOCK,WAREHOUSE"
 *       - in: query
 *         name: filter[itemId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[ownerType]
 *         schema: { type: string, enum: [FACTORY, CUSTOMER] }
 *         description: FACTORY = fabrika stoğu, CUSTOMER = müşteri malları (fason)
 *       - in: query
 *         name: filter[isDerived]
 *         schema: { type: string, enum: ["true", "false"] }
 *         description: Item.isDerived — false=ham, true=işlenmiş (renk/özellik kazanmış)
 *       - in: query
 *         name: filter[baseItemId]
 *         schema: { type: string, format: uuid }
 *         description: Ham item ID. Bu item ve ondan türetilmiş tüm item'ların top'larını getirir.
 *       - in: query
 *         name: filter[colorId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[propertyIds]
 *         schema: { type: string }
 *         description: Virgülle ayrılmış FabricProperty ID'leri (AND-every — hepsini birden taşıyan).
 *       - in: query
 *         name: filter[widthMin]
 *         schema: { type: number }
 *         description: Roll.width min (cm).
 *       - in: query
 *         name: filter[widthMax]
 *         schema: { type: number }
 *         description: Roll.width max (cm). Eşit değer için min=max.
 *       - in: query
 *         name: filter[qtyMin]
 *         schema: { type: number }
 *         description: Roll.currentQty min (mt).
 *       - in: query
 *         name: filter[qtyMax]
 *         schema: { type: number }
 *         description: Roll.currentQty max (mt).
 *     responses:
 *       200:
 *         description: Sayfalanmış top listesi
 *       401:
 *         description: Yetkisiz erişim
 */
router.get("/", verifyToken, requirePermission("roll:read"), controller.findAllRolls);

/**
 * @openapi
 * /api/rolls/barcode/{barcode}:
 *   get:
 *     tags: [Inventory]
 *     summary: Barkod ile top sorgula
 *     description: El terminali veya barkod okuyucu ile top detayını getirir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *         description: Top barkodu (ör. TEKS-20260415-A1B2C3D4)
 *     responses:
 *       200:
 *         description: Top detayı
 *       404:
 *         description: Barkod bulunamadı
 */
router.get("/barcode/:barcode", verifyToken, requirePermission("roll:read"), controller.findRollByBarcode);

/**
 * @openapi
 * /api/rolls/{id}:
 *   get:
 *     tags: [Inventory]
 *     summary: Top detayı (ID ile)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top detayı (hatalar ve tahsisler dahil)
 *       404:
 *         description: Top bulunamadı
 */
router.get("/:id", verifyToken, requirePermission("roll:read"), controller.findRollById);

/**
 * @openapi
 * /api/rolls/{id}/history:
 *   get:
 *     tags: [Inventory]
 *     summary: Topun yaşam döngüsü geçmişi
 *     description: |
 *       Topun oluşumundan itibaren geçtiği tüm olayları kronolojik timeline olarak döner:
 *       istasyon giriş/çıkışları (RollMovement), operasyonlar (RollOperation),
 *       fason sevk/kabul ve sevkiyat (irsaliye).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top geçmişi (events dizisi ile)
 *       404:
 *         description: Top bulunamadı
 */
router.get("/:id/history", verifyToken, requirePermission("roll:read"), controller.getRollHistory);

/**
 * @openapi
 * /api/rolls/initial-entry:
 *   post:
 *     tags: [Inventory]
 *     summary: Ham mal girişi (QC1 - Mal Kabul)
 *     description: |
 *       Yeni top (roll) kaydı oluşturur. Barkod otomatik üretilir.
 *       Status STOCK olarak ayarlanır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, initialQty]
 *             properties:
 *               itemId:
 *                 type: string
 *                 format: uuid
 *                 description: Stok kartı ID
 *               initialQty:
 *                 type: number
 *                 description: İlk ölçüm (metre)
 *                 example: 120.5
 *               weightKg:
 *                 type: number
 *                 description: Ağırlık (kg)
 *                 example: 45.2
 *               qualityGrade:
 *                 type: string
 *                 description: Kalite sınıfı
 *                 default: "1.KALITE"
 *               design:
 *                 type: string
 *                 description: Desen adı veya kodu (KK1 operatörü tarafından girilir)
 *                 example: "BALIK SIRTA"
 *                 maxLength: 200
 *     responses:
 *       201:
 *         description: Top oluşturuldu
 *       400:
 *         description: Validasyon hatası
 *       404:
 *         description: Ürün bulunamadı
 */
router.post("/initial-entry", verifyToken, requirePermission("roll:write"), controller.createInitialEntry);

/**
 * @openapi
 * /api/rolls/{id}:
 *   delete:
 *     tags: [Inventory]
 *     summary: Topu hurda olarak işaretle (soft delete)
 *     description: |
 *       Topun durumunu SCRAP olarak değiştirir.
 *       Sadece STOCK durumundaki toplar hurda olarak işaretlenebilir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top hurda olarak işaretlendi
 *       400:
 *         description: Sadece STOCK durumundaki toplar hurda olarak işaretlenebilir
 *       404:
 *         description: Top bulunamadı
 */
/**
 * @openapi
 * /api/rolls/{id}/identity:
 *   patch:
 *     tags: [Inventory]
 *     summary: Topun kimliğini manuel olarak güncelle (renk + özellikler)
 *     description: |
 *       Hibrit mod — fason kabul sonrası operatör bir rulonun rengini/
 *       özelliklerini elle düzeltir. Replace semantics: gönderilen liste
 *       yeni TAM listedir. baseItem (ham kimlik) korunur.
 *     security:
 *       - bearerAuth: []
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
 *               colorId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               propertyIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Yeni kimlik (itemId, itemCode, itemName)
 *       404:
 *         description: Top bulunamadı
 */
router.patch("/:id/identity", verifyToken, requirePermission("roll:write"), controller.applyManualProperties);

router.delete("/:id", verifyToken, requirePermission("roll:write"), controller.softDelete);

/**
 * @openapi
 * /api/rolls/{id}/permanent:
 *   delete:
 *     tags: [Inventory]
 *     summary: Topu kalıcı olarak sil (hard delete)
 *     description: |
 *       Topu veritabanından fiziksel olarak siler.
 *       Sadece STOCK veya SCRAP durumundaki toplar silinebilir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top kalıcı olarak silindi
 *       400:
 *         description: Sadece STOCK veya SCRAP durumundaki toplar silinebilir
 *       404:
 *         description: Top bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("roll:write"), controller.hardDelete);

export default router;
