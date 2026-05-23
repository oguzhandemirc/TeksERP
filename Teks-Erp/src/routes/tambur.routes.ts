// =============================================================================
// TeksERP - Tambur Routes
// =============================================================================

import { Router } from "express";
import { TamburController } from "../controllers/tambur.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";

const controller = new TamburController();
const router = Router();

/**
 * @openapi
 * /api/tambur/pending-rolls:
 *   get:
 *     tags: [Tambur]
 *     summary: Tambur'da bekleyen toplar
 *     description: İşlenmemiş hataları olan, IN_PRODUCTION durumundaki topları listeler.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bekleyen toplar ve hata listesi
 */
router.get("/pending-rolls", verifyToken, requirePermission("quality:read"), controller.getPendingRolls);

/**
 * @openapi
 * /api/tambur/recent-output-rolls:
 *   get:
 *     tags: [Tambur]
 *     summary: Tambur'dan son çıkmış toplar (etiket yeniden basımı için)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: workOrderId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200: { description: Toplar listesi (item.color, variant ile) }
 */
router.get(
  "/recent-output-rolls",
  verifyToken,
  requirePermission("quality:read"),
  controller.listRecentOutputRolls
);

/**
 * @openapi
 * /api/tambur/by-card/{barcode}:
 *   get:
 *     tags: [Tambur]
 *     summary: Refakat kartı ile Tambur adımındaki rolleri çöz
 *     description: |
 *       Tambur tabletinde operatör refakat kartını okutur. Bu endpoint, karta bağlı
 *       iş emrinin Tambur adımında açık olan rolleri stok kodu, lot (varyant) kodu,
 *       en ve hata özetleriyle birlikte döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tambur adım özeti ve rol listesi }
 *       400: { description: Kart aktif değil veya Tambur adımı yok }
 *       404: { description: Refakat kartı bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/by-card/:barcode",
  verifyToken,
  requirePermission("quality:read"),
  controller.getByCardBarcode
);

/**
 * @openapi
 * /api/tambur/step/{stepId}:
 *   get:
 *     tags: [Tambur]
 *     summary: Step ID ile direkt çek (refresh için)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Tambur adım özeti }
 *       400: { description: Adım Tambur tipinde değil }
 *       404: { description: Adım bulunamadı }
 */
router.get(
  "/step/:stepId",
  verifyToken,
  requirePermission("quality:read"),
  controller.getStep
);

/**
 * @openapi
 * /api/tambur/open-cards:
 *   get:
 *     tags: [Tambur]
 *     summary: Tambur adımlarında açık top bekleyen aktif kartlar (kamera modal)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Açık kart listesi }
 */
router.get(
  "/open-cards",
  verifyToken,
  requirePermission("quality:read"),
  controller.listOpenCards
);

/**
 * @openapi
 * /api/tambur/report-error:
 *   post:
 *     tags: [Tambur]
 *     summary: Tambur'da yeni hata kaydı (Kurşun'da yakalanmamış)
 *     description: |
 *       Tambur'da operatör Kurşun'da görülmemiş bir hata fark ederse aynı `RollError`
 *       modelinde kayıt açar. `isProcessed=false` kalır, finalize akışıyla beraber
 *       Kurşun'dan gelenlerle aynı listede karara bağlanır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, stepId, startMeter, endMeter, defectTypeId]
 *             properties:
 *               rollId:       { type: string, format: uuid }
 *               stepId:       { type: string, format: uuid }
 *               startMeter:   { type: number }
 *               endMeter:     { type: number }
 *               defectTypeId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Hata kaydı oluşturuldu }
 *       400: { description: Geçersiz aralık veya pasif hata tipi }
 *       404: { description: Top, adım veya hata tipi bulunamadı }
 */
router.post(
  "/report-error",
  verifyToken,
  requirePermission("quality:write"),
  controller.reportError
);

/**
 * @openapi
 * /api/tambur/post-production-split:
 *   post:
 *     tags: [Tambur]
 *     summary: Post-production split — depodaki topu istenen metrede ikiye böl
 *     description: |
 *       Hata kesimi DEĞİL — aynı kalitede fonksiyonel kesim. Senaryo: 500m'lik
 *       depodaki top → 300m yeni siparişe + 200m geride kalan top depoda.
 *       İkisi de aynı qualityGrade ve WAREHOUSE'da kalır. Çuvallanmış top
 *       (sackId dolu) kesime gitmez.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, cutLength, originalKeepsLarger]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               cutLength: { type: number, description: Kesim metresi (orijinalden ayrılan parça) }
 *               originalKeepsLarger:
 *                 type: boolean
 *                 description: |
 *                   true: orijinal büyük kalır (qty-cutLength), yeni roll küçük (cutLength)
 *                   false: orijinal küçük (cutLength), yeni roll büyük (qty-cutLength)
 *     responses:
 *       200: { description: 2 top — original + newRoll }
 *       400: { description: Geçersiz parametreler veya çuvallanmış top }
 *       404: { description: Top bulunamadı }
 */
router.post(
  "/post-production-split",
  verifyToken,
  requirePermission("quality:write"),
  controller.postProductionSplit
);

/**
 * @openapi
 * /api/tambur/rolls/{rollId}:
 *   get:
 *     tags: [Tambur]
 *     summary: Tambur karar ekranı — top detayı
 *     description: Belirtilen topu işlenmemiş hataları ile birlikte getirir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rollId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top detayı ve hata listesi
 *       404:
 *         description: Top bulunamadı
 */
router.get("/rolls/:rollId", verifyToken, requirePermission("quality:read"), controller.getRollForDecision);

/**
 * @openapi
 * /api/tambur/finalize:
 *   post:
 *     tags: [Tambur]
 *     summary: Tambur finalizasyonu (Kes/Kesme kararları)
 *     description: |
 *       Kurşun'dan gelen hata kayıtları için KES/KESME kararı verir.
 *       
 *       **KRİTİK İŞ KURALI (Roll Splitting):**
 *       KES kararı verildiğinde orijinal topun metrajı sadece azaltılmaz.
 *       Kesilen parça için YENİ bir Roll kaydı (yeni barkod) oluşturulur
 *       ve SCRAP veya A1 statüsü verilir.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, netCurrentQty, decisions]
 *             properties:
 *               rollId:
 *                 type: string
 *                 format: uuid
 *               netCurrentQty:
 *                 type: number
 *                 description: Kesimler sonrası net metraj
 *                 example: 115.3
 *               decisions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [errorId, decision]
 *                   properties:
 *                     errorId:
 *                       type: string
 *                       format: uuid
 *                     decision:
 *                       type: string
 *                       enum: [CUT, NO_CUT]
 *                     qualityGrade:
 *                       type: string
 *                       description: "Kesilen parçanın kalitesi (FIRE, A1 vb.)"
 *                       default: "FIRE"
 *               foldType:
 *                 type: string
 *                 enum: [2-KAT, 4-KAT]
 *                 description: Katlama şekli
 *               cutMode:
 *                 type: string
 *                 enum: [BY_DEFECT, FIXED_LENGTH]
 *                 description: Kesim stratejisi — hata noktasında mı, sabit metrede mi
 *               cutLengthM:
 *                 type: number
 *                 description: FIXED_LENGTH ise her kaç metrede bir kesilecek
 *                 example: 50
 *     responses:
 *       200:
 *         description: Tambur finalizasyonu tamamlandı (orijinal top + kesim topları)
 *       400:
 *         description: Validasyon hatası
 *       404:
 *         description: Top bulunamadı
 */
router.post("/finalize", verifyToken, requirePermission("quality:write"), controller.finalize);

/**
 * @openapi
 * /api/tambur/allocate:
 *   post:
 *     tags: [Tambur]
 *     summary: Sipariş tahsisi
 *     description: |
 *       PRODUCED durumundaki bir topu sipariş kalemine tahsis eder.
 *       Topun yeterli net metrajı olması gerekir.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, orderLineId, allocatedQty]
 *             properties:
 *               rollId:
 *                 type: string
 *                 format: uuid
 *               orderLineId:
 *                 type: string
 *                 format: uuid
 *               allocatedQty:
 *                 type: number
 *                 description: Tahsis edilecek metraj
 *                 example: 100.0
 *     responses:
 *       201:
 *         description: Tahsis oluşturuldu
 *       400:
 *         description: Yetersiz miktar veya uygun olmayan status
 *       404:
 *         description: Top veya sipariş kalemi bulunamadı
 */
router.post("/allocate", verifyToken, requirePermission("allocation:write"), controller.allocate);

/**
 * @openapi
 * /api/tambur/split-allocate:
 *   post:
 *     tags: [Tambur]
 *     summary: Tek çağrıda çoklu sipariş + stok paylaştırması
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/split-allocate",
  verifyToken,
  requirePermission("allocation:write"),
  controller.splitAllocate
);

/**
 * @openapi
 * /api/tambur/swatch:
 *   post:
 *     tags: [Tambur]
 *     summary: Kartela üretimi (adet x uzunluk kaynak rolden düşülür)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  "/swatch",
  verifyToken,
  requirePermission("quality:write"),
  controller.createSwatch
);

/**
 * @openapi
 * /api/tambur/context/{cardBarcode}:
 *   get:
 *     tags: [Tambur]
 *     summary: Tambur ekran context — WO + sipariş progress + açık kumaşlar (LIFO)
 *     description: |
 *       Refakat kartı barkoduyla Tambur step'ini çözer ve operatör ekranı için
 *       tek atışta tüm veriyi döner:
 *       - WO bilgisi
 *       - WO'ya bağlı orderlar + her sipariş satırı için orderedQty/shippedQty
 *       - Tambur step'inde bekleyen açık kumaş Roll'lar (LIFO — en son giren en üstte)
 *       - Her açık kumaşın RollError listesi (Kurşun/KK2'de tespit edilen hatalar)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: cardBarcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tambur context }
 *       400: { description: Kart pasif }
 *       404: { description: Kart bulunamadı veya WO Tambur'da değil }
 */
router.get(
  "/context/:cardBarcode",
  verifyToken,
  requirePermission("quality:read"),
  controller.getTamburContext,
);

/**
 * @openapi
 * /api/tambur/{id}/cut:
 *   post:
 *     tags: [Tambur]
 *     summary: Açık kumaşta tek kesim — yeni child Roll (gerçek top)
 *     description: |
 *       Operatör 100. metrede "kes" basar → bu endpoint çağrılır → child Roll
 *       (barkodlu, gerçek top) oluşur, açık kumaşın `currentQty`'i kalan metreye
 *       düşer. Status operatör tarafından seçilir (WAREHOUSE/SCRAP/A1_STOCK).
 *
 *       Hata kayıtları otomatik aktarılmaz — operatör Tambur ekranında hata
 *       metrelerini görür, gerekirse manuel kararlar alır (kes + fire / devam +
 *       A1 olarak işaretle).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid, description: Açık kumaş Roll ID }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lengthMeters, status]
 *             properties:
 *               lengthMeters: { type: number, example: 100 }
 *               status:
 *                 type: string
 *                 enum: [WAREHOUSE, SCRAP, A1_STOCK]
 *               qualityGrade: { type: string, nullable: true, example: "1.KALITE" }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       201: { description: Child Roll oluşturuldu }
 *       400: { description: Validasyon / Roll açık kumaş değil }
 *       404: { description: Roll bulunamadı }
 */
router.post(
  "/:id/cut",
  verifyToken,
  requirePermission("quality:write"),
  controller.cutOpenFabric,
);

/**
 * @openapi
 * /api/tambur/{id}/finalize-open-fabric:
 *   post:
 *     tags: [Tambur]
 *     summary: Açık kumaşı bitir — parent CONSUMED_AT_TAMBUR
 *     description: |
 *       Operatör "açık kumaş bitti" der → parent Roll TAMBUR_CONSUMED'a çekilir,
 *       Tambur movement kapatılır. `scrapRemaining=true` verilirse kalan metre
 *       fire (SCRAP) child Roll olarak kayıt edilir.
 *
 *       WO'nun tüm step'leri kapanmışsa WO COMPLETED + refakat kartı COMPLETED.
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
 *               scrapRemaining: { type: boolean, default: false, description: Kalan metre için fire Roll oluştur }
 *               notes: { type: string, nullable: true }
 *               foldType:
 *                 type: string
 *                 nullable: true
 *                 description: |
 *                   Tambur kararı — WO planlamasını (WO.foldType) override eder.
 *                   Verilmezse WO'nun planlanan değeri kullanılır. Hem planlanan
 *                   hem actual değer RollOperation metadata'sına yazılır
 *                   (sapma izlenebilir).
 *     responses:
 *       200: { description: Açık kumaş finalize edildi }
 *       400: { description: Validasyon / Roll açık kumaş değil }
 *       404: { description: Roll bulunamadı }
 */
router.post(
  "/:id/finalize-open-fabric",
  verifyToken,
  requirePermission("quality:write"),
  controller.finalizeOpenFabric,
);

export default router;

