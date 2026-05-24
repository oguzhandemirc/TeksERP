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
 *         name: filter[processingStatus]
 *         schema: { type: string, enum: [raw, processed, open_fabric, finished] }
 *         description: |
 *           Roll.colorId/status/barcode üzerinden türev:
 *           raw = colorId IS NULL (henüz renk almamış);
 *           processed = colorId IS NOT NULL ve henüz Tambur'a ulaşmamış;
 *           open_fabric = barcode IS NULL + status=IN_PRODUCTION (Kurşun/KK2/Tambur'da bekleyen açık kumaş);
 *           finished = WAREHOUSE/READY_FOR_SHIP (Tambur'dan çıkmış).
 *       - in: query
 *         name: filter[rollKind]
 *         schema: { type: string, enum: [OPEN_FABRIC, WOUND_ROLL] }
 *         description: |
 *           Fiziksel form: OPEN_FABRIC = barkodsuz açık kumaş; WOUND_ROLL = barkodlu top.
 *       - in: query
 *         name: filter[currentStepKind]
 *         schema: { type: string, enum: [RAW_QC, PROCESS_QC, SUBCONTRACTOR, TAMBUR, OTHER] }
 *         description: |
 *           Roll'un şu an bulunduğu istasyon türü (Roll.currentStep.station.kind).
 *           Örn. PROCESS_QC = Kurşun/KK2'de bekleyenler; TAMBUR = Tambur'da bekleyenler.
 *       - in: query
 *         name: filter[colorId]
 *         schema: { type: string, format: uuid }
 *         description: Roll.colorId ile filtre — belirli renkteki rulolar.
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

// `/barcode` veya `/barcode/` (boş param) — Express trailing slash'i strip
// edip `/barcode` route'una yönlendirir; ardından `/:id` route'u "barcode"
// string'ini UUID olarak doğrulamaya çalışır (BUG-17 sonrası 400 verir
// ama mesajı yanıltıcı: "Geçersiz UUID 'barcode'"). Bu explicit route net
// "Barkod parametresi gerekli" 400 verir, kullanıcı doğru endpoint'i
// kullanmaya yönlenir.
router.get("/barcode", verifyToken, requirePermission("roll:read"), (_req, res) => {
  res.status(400).json({
    success: false,
    message: "Barkod parametresi gerekli. Kullanım: GET /api/rolls/barcode/<barkod>",
  });
});

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
 *               colorId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: Opsiyonel renk (ham mal genelde NULL — boyahanede kazanır)
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
 *               width:
 *                 type: number
 *                 nullable: true
 *                 description: |
 *                   En (cm) — opsiyonel. Operatör KK1'de ölçmediyse boş
 *                   bırakılabilir; sonra Tambur veya manuel düzenleme ile
 *                   doldurulur. Pozitif olmalı (verildiyse).
 *                 example: 150
 *               workOrderId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: Opsiyonel — verilirse top doğrudan iş emrinin ilk adımına bağlanır
 *     responses:
 *       201:
 *         description: Top oluşturuldu
 *       400:
 *         description: Validasyon hatası
 *       409:
 *         description: İş emrinin KK1 adımı tamamlanmış — yeni rulo eklenemez
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

/**
 * @openapi
 * /api/rolls/kk1-context/{cardBarcode}:
 *   get:
 *     tags: [Inventory]
 *     summary: KK1 tabletinde kart okutarak WO context al
 *     description: |
 *       Mobile KK1 tabletinde refakat kartı okutulduğunda çağrılır. Kart aktif
 *       ise ve WO'nun KK1 (RAW_QC) adımı şu an açıksa, WO context'i (batchNumber,
 *       targetItem, targetColor) döner. KK1 zaten tamamlanmış veya WO başka
 *       adımdaysa multi-batch destekli net 400 mesajı: "Mevcut konum: Boyahane
 *       (4 rulo). Tabletinizi yanlış istasyonda okutmuş olabilirsiniz."
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cardBarcode
 *         required: true
 *         schema: { type: string, example: "RK-2605-939944-C" }
 *     responses:
 *       200: { description: WO context }
 *       400: { description: Kart pasif veya WO başka adımda }
 *       404: { description: Kart bulunamadı veya WO'da KK1 adımı yok }
 */
router.get(
  "/kk1-context/:cardBarcode",
  verifyToken,
  requirePermission("roll:read"),
  controller.getKk1ContextByCard
);

/**
 * @openapi
 * /api/rolls/open-fabric:
 *   post:
 *     tags: [Inventory]
 *     summary: Kurşun/KK2'de açık kumaş Roll oluştur (boyahane fason dönüşü)
 *     description: |
 *       Boyahane gibi açık kumaş döndüren fason kabul sonrası, Kurşun/KK2
 *       operatörü "yeni kumaş aç" der → bu endpoint çağrılır.
 *
 *       Yeni Roll özellikleri:
 *       - Barkod basılmaz (`barcode = NULL`); fiziksel takip arabada.
 *       - colorId / properties receipt'ten inherit (receipt.appliedColor + appliedProperties).
 *       - itemId WO.targetItemId.
 *       - currentStepId / producedInStepId = verilen Kurşun/KK2 step.
 *       - parentReceiptId = kaynak SubcontractorReceipt.
 *       - initialQty / currentQty = 0 (ölçüm `kursun-finish`'te yapılır).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiptId, stepId]
 *             properties:
 *               receiptId: { type: string, format: uuid, description: Kaynak SubcontractorReceipt }
 *               stepId:    { type: string, format: uuid, description: Kurşun/KK2 (PROCESS_QC) step }
 *               notes:     { type: string, nullable: true }
 *     responses:
 *       201: { description: Açık kumaş Roll oluşturuldu }
 *       400: { description: Validasyon / receipt iptal / step PROCESS_QC değil }
 *       404: { description: Receipt veya step bulunamadı }
 *       409: { description: İş emri tamamlanmış / step kapalı }
 */
router.post(
  "/open-fabric",
  verifyToken,
  requirePermission("roll:write"),
  controller.createOpenFabric,
);

/**
 * @openapi
 * /api/rolls/{id}/kursun-finish:
 *   post:
 *     tags: [Inventory]
 *     summary: Açık kumaş Kurşun/KK2 sonu — metraj + hata + Tambur'a ilerlet
 *     description: |
 *       Operatör cihazda gözüken toplam metreyi ve tespit ettiği hata noktalarını
 *       kaydeder. Sonra Roll Tambur step'ine ilerletilir.
 *
 *       Yapılan işlemler:
 *       - Roll.initialQty / currentQty = totalMeters
 *       - RollError'lar insert (sadece startMeter zorunlu, endMeter opsiyonel)
 *       - RollOperation: KURSUN_APPLIED + QC2_COMPLETED
 *       - Kurşun/KK2 movement'ı kapatılır (qtyOut = totalMeters)
 *       - Sonraki step (Tambur) için movement açılır + Roll.currentStepId güncellenir
 *
 *       Yeniden çağırma engellenir (`initialQty > 0` ise 409).
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
 *             required: [totalMeters]
 *             properties:
 *               totalMeters: { type: number, example: 500 }
 *               errors:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [startMeter]
 *                   properties:
 *                     startMeter:   { type: number, example: 60 }
 *                     endMeter:     { type: number, nullable: true, description: "Opsiyonel — operatör çoğu zaman sadece başlangıç metresi girer" }
 *                     defectTypeId: { type: string, format: uuid, nullable: true }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       200: { description: Kurşun/KK2 tamamlandı, Roll Tambur'a ilerletildi }
 *       400: { description: Validasyon / Roll açık kumaş değil / yanlış step }
 *       404: { description: Roll bulunamadı }
 *       409: { description: Bu Roll zaten finalize edilmiş }
 */
router.post(
  "/:id/kursun-finish",
  verifyToken,
  requirePermission("roll:write"),
  controller.kursunFinish,
);

export default router;
