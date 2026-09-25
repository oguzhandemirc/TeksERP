// =============================================================================
// TeksERP - WorkOrder (Parti) Routes
// =============================================================================

import { Router } from "express";
import { WorkOrderController } from "../controllers/workorder.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireProductionEnabled } from "../middlewares/module.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { workOrderTravelerRouter } from "./traveler-card.routes";

const controller = new WorkOrderController();
const router = Router();

// Modül kapısı — bu router'daki HER uç için (2026-09-02).
// ⚠️ Kapı `verifyToken`dan SONRA: kimliksiz istek 401 almalı, 403 değil
// (403 "kaynak var ama modül kapalı" bilgisini kimliksiz kişiye sızdırırdı).
// ⚠️ `router.use` ile TOPLU: uç uç yazılırsa biri unutulur ve unutulan uç
// sessizce açık kalır. Sıra da load-bearing — bu satırdan ÖNCE tanımlanan bir
// uç kapıyı HİÇ görmez (Express kayıt sırası; hata da log da üretmez).
router.use(verifyToken, requireProductionEnabled);

// /api/work-orders/:id/traveler-cards altında refakat kartı endpoint'leri
router.use("/:id/traveler-cards", workOrderTravelerRouter);

/**
 * @openapi
 * /api/work-orders:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emri (parti) listesi
 *     description: Tüm iş emirlerini rota adımları ve bağlı siparişler ile listeler.
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
 *         name: search
 *         schema: { type: string }
 *         description: Parti numarası ile arama
 *       - in: query
 *         name: filter[status]
 *         schema: { type: string, enum: [PLANNED, IN_PROGRESS, COMPLETED, CANCELLED] }
 *       - in: query
 *         name: filter[type]
 *         schema: { type: string, enum: [ORDER_PRODUCTION, STOCK_PRODUCTION] }
 *       - in: query
 *         name: filter[customerId]
 *         schema: { type: string }
 *         description: 'Bağlı siparişin müşterisi (uuid; CSV ile çoklu) — bağsız (stok) iş emri eşleşmez'
 *     responses:
 *       200:
 *         description: 'Sayfalanmış iş emri listesi; her satırda `customers` (bağlı siparişlerin DISTINCT müşterileri, id+ad, ad sırası, en çok 5) ve `customerCount`'
 */
router.get("/", verifyToken, requireAnyPermission("workorder:read", "mobile:fason-sevk", "mobile:hizli-is-emri"), controller.findAll);

// K6 (2026-06-12): GET /available-for-attach, PATCH /:id/attach-rolls ve
// PATCH /:id/detach-rolls HTTP uçları kaldırıldı — hiçbir frontend çağırmıyordu
// (Electron+mobil grep'le doğrulandı). attachRolls/detachRolls SERVİS metodları
// yaşıyor: quick-start ve seed scriptleri içeriden çağırır.

/**
 * @openapi
 * /api/work-orders/check-batch-number:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Parti kodu benzersiz mi (form blur kontrolü)
 *     description: |
 *       İş emri formunda parti kodu alanından çıkıldığında çağrılır. Kaydetmeden
 *       önce "bu numara daha önce verilmiş mi" uyarısı verir. excludeId verilirse
 *       o iş emri çakışma sayılmaz (düzenleme modu). Boş kod → available=true.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: batchNumber
 *         schema: { type: string }
 *       - in: query
 *         name: excludeId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ batchNumber, available }" }
 */
router.get(
  "/check-batch-number",
  verifyToken,
  requireAnyPermission("workorder:read", "workorder:write", "mobile:hizli-is-emri"),
  controller.checkBatchNumber,
);

/**
 * @openapi
 * /api/work-orders/{id}:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emri detayı
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri detayı (rota adımları ve siparişler dahil)
 *       404:
 *         description: İş emri bulunamadı
 */
/**
 * @openapi
 * /api/work-orders/events/lookup:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Hareketler ekranı araması (iş emri no ya da top barkodu)
 *     description: |
 *       Önce tam iş emri no eşleşmesi; yoksa top barkodu → topun geçtiği tüm iş emirleri
 *       (hareket adımları ∪ bugünkü adım ∪ doğduğu adım). En az 2 karakter.
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, maxLength: 64 }
 *     responses:
 *       200:
 *         description: Eşleşen iş emirleri (boş dizi = bulunamadı)
 *       400:
 *         description: Sorgu çok kısa
 */
// ⚠️ `/:id`'DEN ÖNCE: sonra kaydedilseydi Express "events"i bir iş emri id'si sanırdı.
router.get("/events/lookup", verifyToken, requireAnyPermission("workorder:read", "mobile:fason-sevk", "mobile:hizli-is-emri"), controller.lookupEvents);

router.get("/:id", verifyToken, requireAnyPermission("workorder:read", "mobile:fason-sevk", "mobile:hizli-is-emri"), controller.findById);

/**
 * @openapi
 * /api/work-orders/{id}/branches:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Fason dalları (paralel sevk partileri / lane görünümü)
 *     description: Her SubcontractorDispatch bir "dal"dır; durumu (açık/kısmi/döndü) ve dönüşten doğan açık-kumaş toplarının şu anki konumunu döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Dal listesi
 *       404:
 *         description: İş emri bulunamadı
 */
router.get("/:id/branches", verifyToken, requireAnyPermission("workorder:read", "mobile:hizli-is-emri"), controller.getBranches);
// Parti rota-zaman çizelgesi (birleşik hareket+operasyon geçmişi, adıma göre).
router.get("/:id/batches/:batchId/timeline", verifyToken, requireAnyPermission("workorder:read", "mobile:hizli-is-emri"), controller.getBatchTimeline);

/**
 * @openapi
 * /api/work-orders/{id}/split-preview:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Partiyi (sevk lane'i) yeni iş emrine ayırma önizlemesi
 *     description: batchId query param ile taşınacak topları + ayrılabilirlik (Faz B1 boyanmadan) durumunu döner. Hiçbir şeyi değiştirmez.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: batchId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Önizleme }
 */
router.get("/:id/split-preview", verifyToken, requirePermission("workorder:read"), controller.getSplitPreview);

/**
 * @openapi
 * /api/work-orders/{id}/split:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Partiyi yeni iş emrine ayır (aynı rota + özellikler, yeni renk)
 *     description: Partinin canlı toplarını + açık sevkini yeni WO'nun aynı sıradaki adımlarına taşır (kaldığı yerden devam). Faz B1 - boyanmadan.
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Yeni iş emri oluşturuldu }
 */
router.post("/:id/split", verifyToken, requirePermission("workorder:write"), controller.splitBranch);

/**
 * @openapi
 * /api/work-orders/{id}/manual-move-preview:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Manuel konum düzeltme önizleme (süpervizör override) — salt-okunur
 *     description: Seçili parti/topların hedef adıma taşınması önizlemesi; taşınabilir/engelli toplar + parti kararı + uyarılar.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Önizleme }
 */
router.post("/:id/manual-move-preview", verifyToken, requirePermission("workorder:read"), controller.getManualMovePreview);

/**
 * @openapi
 * /api/work-orders/{id}/manual-move:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Parti/top bazında rotada manuel taşıma (süpervizör override)
 *     description: DB'ye elle müdahale yerine panelden; toplar hedef adıma taşınır (ileri/geri), parti kimliği keep/new/join ile kararlaşır. Fasonda/sevkli/işlenmiş toplar engellenir.
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Taşındı }
 */
router.post("/:id/manual-move", verifyToken, requirePermission("workorder:write"), controller.manualMove);

/**
 * @openapi
 * /api/work-orders/{id}/travel-card:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Refakat Kartı (Traveler Card) verisi
 *     description: İş emrinin barkod ve rota bilgilerini içeren refakat kartı verisini döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Refakat kartı verisi
 *       404:
 *         description: İş emri bulunamadı
 */
router.get("/:id/travel-card", verifyToken, requireAnyPermission("workorder:read", "mobile:hizli-is-emri"), controller.getTravelCard);

/**
 * @openapi
 * /api/work-orders/{id}/manifest:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Çeki Listesi (Manifest) verisi
 *     description: İş emrine bağlı topların metraj ve kilo özet listesini döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Çeki listesi verisi
 *       404:
 *         description: İş emri bulunamadı
 */
router.get("/:id/manifest", verifyToken, requireAnyPermission("workorder:read", "mobile:hizli-is-emri"), controller.getManifest);

/**
 * @openapi
 * /api/work-orders/{id}/manifest:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Çeki Listesi belgesi oluştur (kalıcı)
 *     description: İş emrinin anlık manifest snapshot'ını Manifest tablosuna kaydeder. Aynı WO için birden fazla basım alınabilir.
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
 *               notes: { type: string }
 *     responses:
 *       201: { description: Manifest oluşturuldu }
 */
router.post("/:id/manifest", verifyToken, requireAnyPermission("workorder:write", "mobile:hizli-is-emri"), controller.createManifest);

/**
 * @openapi
 * /api/work-orders/{id}/manifests:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emrinin tüm manifest (çeki listesi) geçmişi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Manifest listesi }
 */
router.get("/:id/manifests", verifyToken, requireAnyPermission("workorder:read", "mobile:hizli-is-emri"), controller.listManifests);

/**
 * @openapi
 * /api/work-orders/manifest-by-id/{manifestId}:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Tek manifest'i ID ile getir (snapshot dahil)
 *     description: Yazdırma / preview için kayıtlı snapshot'ı döner — yeniden hesaplama yok.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: manifestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Manifest detayı (snapshot dahil) }
 *       404: { description: Manifest bulunamadı }
 */
router.get("/manifest-by-id/:manifestId", verifyToken, requireAnyPermission("workorder:read", "mobile:hizli-is-emri"), controller.getManifestById);

/**
 * @openapi
 * /api/work-orders:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Yeni iş emri (parti) oluştur
 *     description: |
 *       Rota adımları ile birlikte yeni iş emri oluşturur.
 *       orderLineIds opsiyoneldir — boş bırakılırsa stok için üretim yapılır.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [batchNumber, steps]
 *             properties:
 *               batchNumber:
 *                 type: string
 *                 example: "PARTI-2026-001"
 *               type:
 *                 type: string
 *                 enum: [ORDER_PRODUCTION, STOCK_PRODUCTION]
 *                 default: ORDER_PRODUCTION
 *               width:
 *                 type: number
 *                 description: Kumaş eni (cm)
 *                 example: 150
 *               recipeNo:
 *                 type: string
 *                 description: Boyahane/baskı reçete kodu
 *                 example: "R-2026-045"
 *               parameters:
 *                 type: object
 *                 description: Dinamik parametreler (ek bilgiler)
 *               steps:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [stationId]
 *                   properties:
 *                     stationId: { type: string, format: uuid }
 *               orderLineIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: İş emri oluşturuldu
 *       400:
 *         description: Validasyon hatası
 */
router.post("/", verifyToken, requirePermission("workorder:write"), controller.create);

/**
 * @openapi
 * /api/work-orders/quick-start:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Mobil hızlı iş emri başlatma (stok topu okut → WO + bağlama)
 *     description: |
 *       Okutulan stok (STOCK) toplarını doğrular, iş emrini oluşturur ve topları
 *       tek istekte bağlar. targetItemId verilmezse okutulan topların ürününden
 *       türetilir. Hiç top bağlanamazsa iş emri geri alınır (yetim WO bırakmaz).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollBarcodes]
 *             properties:
 *               rollBarcodes:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["T120726H0001", "T120726H0002"]
 *               routeTemplateId: { type: string, format: uuid }
 *               targetItemId:    { type: string, format: uuid }
 *               targetColorId:   { type: string, format: uuid, nullable: true }
 *               orderLineIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       201: { description: İş emri başlatıldı (workOrder + attached + errors) }
 *       400: { description: Validasyon / uygun olmayan top }
 *       409: { description: Hiç top bağlanamadı }
 */
router.post(
  "/quick-start",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:hizli-is-emri"),
  controller.quickStart,
);

/**
 * @openapi
 * /api/work-orders/{id}:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: İş emrinin temel alanlarını güncelle (COMPLETED/CANCELLED hariç; kilitli alanlar 409)
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
 *               batchNumber: { type: string }
 *               width: { type: number, nullable: true }
 *               targetQuantity: { type: number, nullable: true }
 *               recipeNo: { type: string, nullable: true }
 *               plannedStartDate: { type: string, nullable: true }
 *               plannedEndDate: { type: string, nullable: true }
 *               foldType:
 *                 type: string
 *                 nullable: true
 *                 description: Tambur planlama bilgisi ("2-KAT" / "4-KAT" gibi). Tambur'a bilgi olarak iletilir; operatör override edebilir.
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: WO tamamlandı/iptal edildi VEYA fiziksel taahhüt kilitli alan değiştirildi (locks) }
 */
router.patch("/:id", verifyToken, requireAnyPermission("workorder:write", "mobile:hizli-is-emri"), controller.update);

/**
 * @openapi
 * /api/work-orders/{id}:
 *   put:
 *     tags: [WorkOrders]
 *     summary: İş emrini tüm ilişkileri ile birlikte yeniden yaz (full replace)
 *     description: |
 *       COMPLETED/CANCELLED dışında her durumda çalışır; fiziksel taahhüt (sevk/adım başladı) kilitli alanları 409 döner.
 *       Rota şablonu, custom adımlar, bağlı sipariş kalemleri, hedef ürün ve
 *       özellikler dahil tüm alanlar değişebilir. Mevcut WorkOrderStep,
 *       WorkOrderToOrderLine ve WorkOrderTargetProperty kayıtları drop-and-recreate
 *       pattern'i ile yenilenir.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: WO tamamlandı/iptal edildi VEYA fiziksel taahhüt kilitli alan değiştirildi (locks) }
 */
router.put("/:id", verifyToken, requireAnyPermission("workorder:write", "mobile:hizli-is-emri"), controller.replace);

/**
 * @openapi
 * /api/work-orders/{id}/steps/{stepId}/planning:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: Fason adımı planlaması (kategori + planlanan firma)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               requiredCategoryId:     { type: string, format: uuid, nullable: true }
 *               plannedSubcontractorId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200: { description: Adım planlaması güncellendi }
 */
router.patch(
  "/:id/steps/:stepId/planning",
  verifyToken,
  requirePermission("workorder:write"),
  controller.updateStepPlanning
);

/**
 * @openapi
 * /api/work-orders/{id}/lock:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: İş emrini kilitle (üretime al)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri kilitlendi
 */
router.patch("/:id/lock", verifyToken, requirePermission("workorder:write"), controller.lockWorkOrder);

// ── Sipariş bağlama + hedef düzeltme (2026-08-17 saha talepleri 8/10/12) ─────
// Bu dört uç, "Düzenle" ekranını hiç açmadan TEK bir şeyi değiştirir. Gerekçe:
// düzenleme ekranı iş emrinin her şeyini (rota, hedef, metraj) açar ve saha
// personeli sipariş bağlarken yanlışlıkla üretimi bozabiliyordu.
// ⚠️ `POST /:id/order-links` sipariş satırından HİÇBİR ŞEY MİRAS ALMAZ —
// gerekçe workorder-link.service.ts başlığında.

/**
 * @openapi
 * /api/work-orders/{id}/linkable-order-lines:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Bu iş emrine bağlanabilecek sipariş satırları (kumaş+renk uyumlu)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Aday sipariş satırları (açık metrajıyla) }
 */
router.get(
  "/:id/linkable-order-lines",
  verifyToken,
  // `workorder:write` 2026-08-19'da EKLENDİ: Tambur "Sipariş Bağla" tuşu bu
  // yetkiyle açılır ve tabletteki süpervizörün JWT'sinde read olmayabilir
  // (yazabilen okuyabilir ilkesi — document-template dersi).
  requireAnyPermission("workorder:read", "workorder:write", "mobile:hizli-is-emri"),
  controller.getLinkableOrderLines,
);

/**
 * @openapi
 * /api/work-orders/{id}/order-links:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Sipariş satırlarını bağla (YALNIZ bağ kurar — hedef/rota/metraj değişmez)
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
 *             required: [orderLineIds]
 *             properties:
 *               orderLineIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Bağlandı }
 *       400: { description: Kumaş/renk uyuşmuyor }
 */
router.post(
  "/:id/order-links",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:hizli-is-emri"),
  controller.linkOrderLines,
);

/**
 * @openapi
 * /api/work-orders/{id}/order-links/override:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Uyumsuz siparişi onayla-düzelt-bağla (plan + toplar + bağ tek zincir)
 *     description: >
 *       Tambur süpervizör akışı — sipariş satırı iş emrinin hedefiyle renk/en
 *       uyuşmazsa: hedef siparişe eşitlenir (sebep + iz), iş emrinin
 *       düzeltilebilir topları yeni değere çekilir (tekil düzeltme motoru),
 *       sonra bağ kurulur. Kumaş (cins) farkı HER ZAMAN 400. ÇİFT yetki kapısı.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderLineId, reason]
 *             properties:
 *               orderLineId: { type: string, format: uuid }
 *               reason: { type: string }
 *     responses:
 *       200: { description: "{ changedColor, changedWidth, rollsUpdated, rollsFailed[], linked, warnings }" }
 *       400: { description: Kumaş farkı / zaten uyumlu / sebep eksik }
 */
router.post(
  "/:id/order-links/override",
  verifyToken,
  // ÇİFT KAPI (AND): plan yazımı workorder:write, toplara dokunuş roll:manual-adjust.
  // Middleware zinciri iki ayrı requirePermission = ikisi de şart.
  requirePermission("workorder:write"),
  requirePermission("roll:manual-adjust"),
  controller.linkOrderLineWithOverride,
);

/**
 * @openapi
 * /api/work-orders/{id}/order-links/{orderLineId}:
 *   delete:
 *     tags: [WorkOrders]
 *     summary: Sipariş bağını kaldır
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bağ kaldırıldı }
 */
router.delete(
  "/:id/order-links/:orderLineId",
  verifyToken,
  requirePermission("workorder:write"),
  controller.unlinkOrderLine,
);

/**
 * @openapi
 * /api/work-orders/{id}/target-color:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: Üretim rengini değiştir (sebep zorunlu, iz bırakır)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               colorId: { type: string, format: uuid, nullable: true }
 *               reason:  { type: string }
 *     responses:
 *       200: { description: Renk güncellendi }
 */
router.patch(
  "/:id/target-color",
  verifyToken,
  requirePermission("workorder:write"),
  controller.changeTargetColor,
);

/**
 * @openapi
 * /api/work-orders/{id}/width:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: İş emrinin enini değiştir (sebep zorunlu, iz bırakır)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               width:  { type: number, nullable: true }
 *               reason: { type: string }
 *     responses:
 *       200: { description: En güncellendi }
 */
/**
 * @openapi
 * /api/work-orders/{id}/roll-attribute-targets:
 *   get:
 *     tags: [WorkOrders]
 *     summary: '"Toplara da uygula" için aday toplar (partiye göre gruplu)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Parti → top listesi (engellenenler sebebiyle işaretli) }
 */
router.get(
  "/:id/roll-attribute-targets",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getRollAttributeTargets,
);

/**
 * @openapi
 * /api/work-orders/{id}/apply-attribute-to-rolls:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Seçilen topların rengini/enini iş emriyle eşitle (sebep zorunlu)
 *     description: >
 *       İş emri PLAN, top ÖLÇÜMDÜR — bu uç ölçümü DÜZELTİR, bu yüzden
 *       `roll:manual-adjust` ister ve her top için tekil düzeltme motorundan
 *       geçer (kapsam kuralları orada). Kısmi başarı normaldir.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ updated, failed[] }" }
 */
router.post(
  "/:id/apply-attribute-to-rolls",
  verifyToken,
  // PLANLAMACI DA GEÇER (2026-08-21, kullanıcı kararı): iş emri kapsamlı toplu
  // renk/en düzeltmesi bir PLANLAMA düzeltmesidir (sebep + audit). Süpervizör
  // kapsam kuralı tekil motorda; planlamacı için servis motora izin listesi
  // vermez (bkz. workorder-link.service.applyAttributeToRolls).
  requireAnyPermission("roll:manual-adjust", "workorder:write"),
  controller.applyAttributeToRolls,
);

router.patch(
  "/:id/width",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-kabul"),
  controller.changeWidth,
);

/**
 * @openapi
 * /api/work-orders/{id}/rolls:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Sepetteki (bağlanmış) topları getir
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bağlanmış topların listesi
 */
router.get("/:id/rolls", verifyToken, requireAnyPermission("workorder:read", "mobile:hizli-is-emri"), controller.getAttachedRolls);

/**
 * @openapi
 * /api/work-orders/{id}/documents:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emrinin TÜM belgeleri (refakat kartı + fason sevk/kabul/doğrudan sevk)
 *     description: >
 *       Belgeler dört ayrı kaynakta yaşıyor; bu uç tek liste döner ki istemciler
 *       kendi listelerini kurup ayrışmasın. İPTAL edilmiş belgeler listede KALIR
 *       (`cancelled: true`) — donmuş belge silinmez, İPTAL filigranıyla basılır.
 *       Baskı: TRAVELER_CARD → /traveler-cards/:id/html, diğerleri →
 *       /printed-documents/:docType/:sourceId/html.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Belge listesi (grup + başlık + tarih + iptal bilgisiyle)
 *       404:
 *         description: İş emri bulunamadı
 */
// LİSTE izni okuma seviyesindedir; asıl kapı baskı ucundaki belge-tipi bazlı
// `requireDocPermission`'dır (bir belgeyi GÖRMEK ile BASMAK ayrı sorular değil,
// ama liste tek uçtan geldiği için tip-bazlı gate baskı tarafında kalır).
/**
 * @openapi
 * /api/work-orders/{id}/events:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İş emri hareketleri (zaman çizelgesi)
 *     description: |
 *       İş emrinin kendi hareket defteri (`work_order_events`) ile kendi defteri olan
 *       olaylar (sipariş bağı, hedef özellik, parti, fason sevk/kabul, Tambur kesimi,
 *       kapanış künyesi) tek çizelgede, yeniden eskiye, cursor'lu. Salt-okunur; audit
 *       OKUNMAZ. `group` CSV süzgeci tanınmayan değerde 400 döner.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: group
 *         schema: { type: string, example: "DURUM,FASON" }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *     responses:
 *       200:
 *         description: Sayfa + grup sayıları
 *       400:
 *         description: Tanınmayan grup ya da bozuk imleç
 *       404:
 *         description: İş emri bulunamadı
 */
router.get(
  "/:id/events",
  verifyToken,
  requireAnyPermission("workorder:read", "mobile:fason-sevk", "mobile:hizli-is-emri"),
  controller.getEvents,
);

router.get(
  "/:id/documents",
  verifyToken,
  requireAnyPermission("workorder:read", "workorder:write", "mobile:hizli-is-emri", "mobile:fason-sevk", "mobile:fason-kabul"),
  controller.getDocuments,
);

/**
 * @openapi
 * /api/work-orders/{id}:
 *   delete:
 *     tags: [WorkOrders]
 *     summary: İş emrini iptal et (soft delete)
 *     description: |
 *       İş emrinin durumunu CANCELLED olarak günceller.
 *       Fiziksel silme yapılmaz; audit kaydı oluşturulur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri iptal edildi
 *       404:
 *         description: İş emri bulunamadı
 */
/**
 * @openapi
 * /api/work-orders/{id}/cancel-impact:
 *   get:
 *     tags: [WorkOrders]
 *     summary: İptal önizleme (stoğa dönecek toplar + void kart sayısı)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İptal etkisi
 */
router.get("/:id/cancel-impact", verifyToken, requireAnyPermission("workorder:write", "mobile:hizli-is-emri"), controller.cancelImpact);

/**
 * @openapi
 * /api/work-orders/{id}/complete-preview:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Manuel kapatma önizleme (atlanacak adımlar + dispozisyon bekleyen toplar)
 *     description: |
 *       `dispositionRolls` → istasyonda kalan, kapanışta karar verilecek toplar.
 *       `blockedRolls`     → fasonda / açık fason sevkinde; kapatmayı ENGELLER.
 *       `canComplete` yalnız `blockedRolls` (ya da WO durumu) yüzünden false olur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Kapatma önizlemesi
 */
/**
 * @openapi
 * /api/work-orders/{id}/complete:
 *   post:
 *     tags: [WorkOrders]
 *     summary: İş emrini manuel kapat (+ kapanış dispozisyonu)
 *     description: |
 *       IN_PROGRESS WO'yu COMPLETED'a çeker. İstasyonda kalan (IN_PRODUCTION) TÜM toplar
 *       için `dispositions` gönderilmek ZORUNDADIR (önizlemedeki `dispositionRolls` ile
 *       birebir). Fasondaki toplar hard-block — mal fiziksel olarak dışarıda.
 *
 *       Dispozisyon gönderiliyorsa `roll:manual-adjust` yetkisi de aranır.
 *     security:
 *       - bearerAuth: []
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
 *               reason:
 *                 type: string
 *                 description: Dispozisyon varsa zorunlu (min 3 karakter) — audit'e yazılır
 *               transferOrderMode:
 *                 type: string
 *                 enum: [stock, keep]
 *                 description: TRANSFER varsa yeni iş emrinin sipariş bağı
 *               dispositions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [rollId, action]
 *                   properties:
 *                     rollId: { type: string, format: uuid }
 *                     action:
 *                       type: string
 *                       enum: [STOCK, WAREHOUSE, A1_STOCK, SCRAP, CANCELLED, TRANSFER]
 *                     qualityGradeId:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                       description: Opsiyonel; yalnız WAREHOUSE / A1_STOCK'ta verilebilir
 *     responses:
 *       200:
 *         description: İş emri kapatıldı
 *       400:
 *         description: Dispozisyon listesi eksik/uyumsuz ya da geçersiz karar
 *       403:
 *         description: roll:manual-adjust yetkisi yok
 *       409:
 *         description: Fasonda top var ya da kayıt bu sırada değişti
 */
// Manuel kapatma: istasyonda kalan toplar için dispozisyon kararıyla kapatır.
router.get("/:id/complete-preview", verifyToken, requirePermission("workorder:write"), controller.completePreview);

/**
 * @openapi
 * /api/work-orders/{id}/fason-quick-receive:
 *   get:
 *     tags: [WorkOrders]
 *     summary: Kapatmayı engelleyen açık fason sevkleri (kabul önizlemesi)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ groups[], orphanRolls[] }" }
 *   post:
 *     tags: [WorkOrders]
 *     summary: Açık fason sevklerini TEK adımda kabul et (dikilerek geldi / birebir)
 *     description: >
 *       İş emrini kapatmanın önündeki fiziksel engeli kapatma ekranından çözer.
 *       Motor mevcut fason kabulüdür; burası yalnız parça sayısını/metrajını
 *       moddan türetir. `subcontractor:write` ister — bu bir MAL KABULÜDÜR.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ receipts, newRolls }" }
 */
router.get(
  "/:id/fason-quick-receive",
  verifyToken,
  requireAnyPermission("workorder:write", "subcontractor:read"),
  controller.fasonQuickPreview,
);
router.post(
  "/:id/fason-quick-receive",
  verifyToken,
  // Mal kabulü fason yetkisidir — kapatma ekranından yapılıyor olması onu
  // "iş emri düzenleme" yapmaz (stok yaratıyor).
  requirePermission("subcontractor:write"),
  controller.fasonQuickApply,
);
router.post("/:id/complete", verifyToken, requirePermission("workorder:write"), controller.completeWorkOrder);

/**
 * @openapi
 * /api/work-orders/{id}/cancel:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Karar vererek iptal et (gerekçe zorunlu)
 *     description: |
 *       `DELETE /:id`'nin karar veren hali. İstasyonda kalan toplar için üç seçenek:
 *       `STOCK` (ham stoğa dön — varsayılan, gönderilmesi gerekmez), `SCRAP` (fire),
 *       `CANCELLED` (hatalı kayıt — storno). `SCRAP`/`CANCELLED` için ayrıca
 *       `roll:manual-adjust` yetkisi aranır. Fasondaki mal hâlâ hard-block'tur.
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
 *               reason: { type: string, minLength: 3, maxLength: 500 }
 *               dispositions:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [rollId, action]
 *                   properties:
 *                     rollId: { type: string, format: uuid }
 *                     action: { type: string, enum: [STOCK, SCRAP, CANCELLED] }
 *     responses:
 *       200: { description: İş emri iptal edildi }
 *       400: { description: Gerekçe eksik / liste bayat }
 *       403: { description: Fire-hatalı kayıt için roll:manual-adjust gerekli }
 *       409: { description: Fasonda top var ya da kayıt bu sırada değişti }
 */
router.post("/:id/cancel", verifyToken, requireAnyPermission("workorder:write", "mobile:hizli-is-emri"), controller.cancelWorkOrder);

/**
 * @openapi
 * /api/work-orders/{id}/batches/{batchId}/drop:
 *   post:
 *     tags: [WorkOrders]
 *     summary: Partiyi iş emrinden düşür (iş emri devam eder)
 *     description: |
 *       Seçilen partinin canlı topları karara göre çözülür (`STOCK` renge duyarlıdır:
 *       renkli top kaliteden çözülen rafa döner) ve parti üyeliği kopar — iptal
 *       edilen toplar HARİÇ, onlar tarihçe satırı olarak partide kalır. İş emri
 *       durumu DEĞİŞMEZ; canlı top kalmadıysa yanıt `noLiveRollsRemain: true` der ve
 *       arayüz "iş emrini de iptal et" teklif eder.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: batchId
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
 *               reason: { type: string, minLength: 3, maxLength: 500 }
 *               dispositions:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [rollId, action]
 *                   properties:
 *                     rollId: { type: string, format: uuid }
 *                     action: { type: string, enum: [STOCK, SCRAP, CANCELLED] }
 *     responses:
 *       200: { description: Parti düşürüldü }
 *       400: { description: Parti bu iş emrine ait değil / liste bayat }
 *       409: { description: Açık fason sevki, fasonda top ya da birleştirilmiş parti }
 */
router.get(
  "/:id/batches/:batchId/drop-preview",
  verifyToken,
  requirePermission("workorder:write"),
  controller.batchDropPreview
);
router.post(
  "/:id/batches/:batchId/drop",
  verifyToken,
  requirePermission("workorder:write"),
  controller.dropBatch
);

// ⚠️ AYNEN KALIR — sahadaki eski mobil APK'lar bu ucu gövdesiz çağırır ve gövdesiz
// çağrı bugünkü davranışın birebir aynısını üretir (bkz. softDelete). Yeni karar
// veren yüzey POST /:id/cancel'dır; bu satırı ona yönlendirme.
router.delete("/:id", verifyToken, requireAnyPermission("workorder:write", "mobile:hizli-is-emri"), controller.softDelete);

/**
 * @openapi
 * /api/work-orders/{id}/permanent:
 *   delete:
 *     tags: [WorkOrders]
 *     summary: İş emrini kalıcı olarak sil (hard delete)
 *     description: |
 *       İş emrini ve tüm bağlı adımları (WorkOrderStep, WorkOrderToOrderLine)
 *       veritabanından fiziksel olarak siler. Bu işlem geri alınamaz.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İş emri kalıcı olarak silindi
 *       404:
 *         description: İş emri bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("workorder:write"), controller.hardDelete);

/**
 * @openapi
 * /api/work-orders/{id}/target-properties/impact:
 *   get:
 *     tags: [WorkOrders]
 *     summary: targetProperties değişikliği etkisi
 *     description: |
 *       Frontend update öncesi "kaç rulo etkilenir" uyarısı için. Tambur'dan
 *       geçmiş ve henüz üretimde olan rulo sayılarını döner.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 */
router.get(
  "/:id/target-properties/impact",
  verifyToken,
  requirePermission("workorder:read"),
  controller.getTargetPropertiesImpact,
);

/**
 * @openapi
 * /api/work-orders/{id}/target-properties:
 *   patch:
 *     tags: [WorkOrders]
 *     summary: Hedef özellikler güncelle (replace)
 *     description: |
 *       WO.targetProperties replace edilir; bağlı tüm Roll'ların properties'i
 *       senkronize edilir. Status farketmez.
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
 *             required: [propertyIds]
 *             properties:
 *               propertyIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 */
router.patch(
  "/:id/target-properties",
  verifyToken,
  requirePermission("workorder:write"),
  controller.updateTargetProperties,
);

export default router;
