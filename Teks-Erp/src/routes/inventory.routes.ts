// =============================================================================
// TeksERP - Inventory (Roll) Routes
// =============================================================================

import { Router } from "express";
import { InventoryController } from "../controllers/inventory.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

// Mobil ekran yetkileri web yetkilerine alternatif olarak kabul edilir:
// `mobile:depo` operatörü `roll:read` web yetkisi olmadan da depo ekranını
// kullanabilsin diye. Listeler her ekrana servis veriyor, bu yüzden geniş set.
const MOBILE_ROLL_READ = [
  "mobile:kk1",
  "mobile:kk2-kursun",
  "mobile:tambur",
  "mobile:depo",
  "mobile:tarti-paket",
  "mobile:sevkiyat",
  "mobile:fason-sevk",
  "mobile:fason-kabul",
  "mobile:hizli-is-emri",
] as const;
const MOBILE_ROLL_WRITE_KK1 = ["mobile:kk1"] as const;
const MOBILE_ROLL_WRITE_KURSUN = ["mobile:kk2-kursun"] as const;
/**
 * TOP İPTALİ (+ önizleme + geri alma) — KK1'in YANINDA DEPO da yapabilir.
 *
 * NEDEN (2026-08-06 saha isteği): yanlış etiketle stoğa girmiş top çoğu zaman
 * KK1'de değil DEPODA fark edilir — kâğıt orada okutulur. Depo personelinin
 * yetkisi yoksa tek çare "KK1'e git, birini bul" olur ve saha onu beklemez:
 * 2026-08-05 vakasında beklemedi, doğaçladı ve aynı fiziksel top için ikinci
 * bir barkod doğdu. Kapıyı açan şey izin DEĞİL, guard'lardır — statü beyaz
 * listesi (`CANCELABLE_ROLL_STATUSES`), `confirmActive` ve ölü etiket onayı
 * `softDelete` içinde ve her iki yüzey için de birebir aynı koşar.
 *
 * ⚠️ `/initial-entry` bu kümeye GİRMEZ: depo topu iptal eder, ham giriş AÇMAZ.
 * Üç ucun kümesi ise birbirinden ayrılmamalı — iptal edebilen geri de
 * alabilmeli, yoksa hata yapan kişi yine doğaçlar.
 */
const MOBILE_ROLL_CANCEL = ["mobile:kk1", "mobile:depo"] as const;

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
 *         schema: { type: string, enum: [STOCK, IN_PRODUCTION, AT_SUBCONTRACTOR, WAREHOUSE, ALL] }
 *       - in: query
 *         name: filter[statusIn]
 *         schema: { type: string }
 *         description: Çoklu status (virgülle ayrılmış). Sekme bazlı filtre için. Örn. "STOCK,WAREHOUSE"
 *       - in: query
 *         name: filter[itemId]
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: filter[processingStatus]
 *         schema: { type: string, enum: [raw, processed, open_fabric, finished] }
 *         description: |
 *           Roll.colorId/status/barcode üzerinden türev:
 *           raw = colorId IS NULL (henüz renk almamış);
 *           processed = colorId IS NOT NULL ve henüz Tambur'a ulaşmamış;
 *           open_fabric = barcode IS NULL + status=IN_PRODUCTION (Kurşun/KK2/Tambur'da bekleyen açık kumaş);
 *           finished = WAREHOUSE (Tambur'dan çıkmış, sevke hazır).
 *       - in: query
 *         name: filter[qualityGrade]
 *         schema: { type: string }
 *         description: Kalite kodu (1.KALITE / A1 / FIRE / admin-tanımlı). Exact match.
 *       - in: query
 *         name: filter[includeFire]
 *         schema: { type: boolean }
 *         description: |
 *           Varsayılan false — FIRE kalitesindeki rulolar gizlenir.
 *           true ile birlikte fire rulolar da listelenir. `qualityGrade` parametresi verildiyse bu toggle yok sayılır.
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
 *       - in: query
 *         name: filter[subcontractorId]
 *         schema: { type: string, format: uuid }
 *         description: |
 *           Açık (dönmemiş) fason sevk kalemi bu firmada olan toplar.
 *           Fasonda sekmesi firma kartı/filtresi — filter[status]=AT_SUBCONTRACTOR ile kullanılır.
 *       - in: query
 *         name: filter[subcontractorCategoryId]
 *         schema: { type: string, format: uuid }
 *         description: |
 *           Açık fason sevk kaleminin adım kategorisi (WorkOrderStep.requiredCategoryId)
 *           bu olan toplar. Fasonda sekmesi işlem chip'i/filtresi.
 *     responses:
 *       200:
 *         description: Sayfalanmış top listesi
 *       401:
 *         description: Yetkisiz erişim
 */
router.get("/", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), controller.findAllRolls);

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
 *         description: Top barkodu (ör. T120726H0001)
 *     responses:
 *       200:
 *         description: Top detayı
 *       404:
 *         description: Barkod bulunamadı
 */
router.get("/barcode/:barcode", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), controller.findRollByBarcode);

/**
 * @openapi
 * /api/rolls/barcode/{barcode}/relabel-context:
 *   get:
 *     tags: [Inventory]
 *     summary: Yeniden-Etiketleme bağlamı (spec + guard + son baskı + müşteri adayları)
 *     description: |
 *       Yeniden-Etiketleme istasyonu için zengin bağlam. Topun tüm spec'i
 *       (renk/kalite/en/özellik), konumu/guard'ı (sevkiyat/çuval — `specLocked`),
 *       son basıldığı yer (`lastLabelSnapshot` = "A") ve "B" müşteri adaylarını
 *       (topu üreten WO'nun bağlı siparişlerinden) döner. Salt-okunur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: RelabelContext }
 *       404: { description: Barkod bulunamadı }
 */
router.get(
  "/barcode/:barcode/relabel-context",
  verifyToken,
  requireAnyPermission("roll:read", "roll:write", "label:read", "label:edit", ...MOBILE_ROLL_READ),
  controller.getRelabelContext,
);

/**
 * @openapi
 * /api/rolls/{id}/relabel-context:
 *   get:
 *     tags: [Inventory]
 *     summary: Aynı bağlam, rollId ile (barkodsuz açık kumaş için)
 *     description: |
 *       `/barcode/{barcode}/relabel-context` ile AYNI payload. Barkodsuz açık kumaş
 *       (fason dönüşü / istasyonda bekleyen top) barkodla bulunamaz; tek "Düzelt"
 *       diyaloğu onu da açabilmek için bu ucu kullanır. Salt-okunur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: RelabelContext }
 *       404: { description: Top bulunamadı }
 */
router.get(
  "/:id/relabel-context",
  verifyToken,
  requireAnyPermission("roll:read", "roll:write", "label:read", "label:edit", ...MOBILE_ROLL_READ),
  controller.getRelabelContextById,
);

// `/barcode` veya `/barcode/` (boş param) — Express trailing slash'i strip
// edip `/barcode` route'una yönlendirir; ardından `/:id` route'u "barcode"
// string'ini UUID olarak doğrulamaya çalışır (BUG-17 sonrası 400 verir
// ama mesajı yanıltıcı: "Geçersiz UUID 'barcode'"). Bu explicit route net
// "Barkod parametresi gerekli" 400 verir, kullanıcı doğru endpoint'i
// kullanmaya yönlenir.
router.get("/barcode", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), (_req, res) => {
  res.status(400).json({
    success: false,
    message: "Barkod parametresi gerekli. Kullanım: GET /api/rolls/barcode/<barkod>",
  });
});

/**
 * @openapi
 * /api/rolls/stats:
 *   get:
 *     tags: [Inventory]
 *     summary: Top özet istatistikleri (filtreye uyan TÜM rolların toplamı)
 *     description: |
 *       Listeleme endpointi (`GET /api/rolls`) ile **aynı filtre parametrelerini** kabul eder
 *       (`filter[status]`, `filter[statusIn]`, `filter[qualityGrade]`, `search` vb.).
 *       Liste sayfaya bağlıdır; bu endpoint sayfaya değil **filtrenin TÜMÜNE** aggregate döner.
 *       Depo paneli, dashboard kartları gibi yerlerde "toplam metre / kg / status dağılımı" için kullanılır.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: |
 *           `{ totalCount, totalQty, totalWeight, byStatus, byQuality }`.
 *           Decimal alanlar JSON'da number'a serileştirilir.
 */
router.get("/stats", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), controller.getRollStats);

/**
 * @openapi
 * /api/rolls/entry-users:
 *   get:
 *     tags: [Inventory]
 *     summary: Top girmiş kullanıcılar — "Ekleyen" filtre lookup'ı
 *     description: Kullanıcı kataloğu DEĞİL; yalnız en az bir top yaratmış kullanıcılar (id + ad).
 *     security: [{ bearerAuth: [] }]
 */
router.get("/entry-users", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), controller.listEntryUsers);

/**
 * @openapi
 * /api/rolls/entry-stations:
 *   get:
 *     tags: [Inventory]
 *     summary: Giriş istasyonları — "Giriş İstasyonu" filtre lookup'ı
 *     description: Yalnız en az bir topun giriş istasyonu olmuş istasyonlar (id + ad).
 *     security: [{ bearerAuth: [] }]
 */
router.get("/entry-stations", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), controller.listEntryStations);

/**
 * @openapi
 * /api/rolls/stats-batch:
 *   post:
 *     tags: [Inventory]
 *     summary: Envanter özeti — N kategori filtresi için toplu sayım (tek istek)
 *     description: |
 *       Body `{ items: [{ key, filters }] }`. Her `filters` liste endpointiyle aynı
 *       filtre setidir (buildRollForceFilters). Her kategori için `{ key, totalCount,
 *       totalQty }` döner. 8 ayrı `/stats` isteği yerine tek çağrı (Promise.all).
 *     security:
 *       - bearerAuth: []
 */
router.post("/stats-batch", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), controller.getRollStatsBatch);

/**
 * @openapi
 * /api/rolls/production-flow:
 *   get:
 *     tags: [Inventory]
 *     summary: Üretim Akışı (Kanban) panosu — 6 kolon tek istekte
 *     description: |
 *       Envanter ekranındaki salt-okunur pano. Ham Stok / Fason / Kurşun / Tambur /
 *       Depo / Sevk kolonlarının her biri için **en fazla 10 önizleme kaydı + gerçek
 *       toplam sayaç** döner (6 ayrı isteğin yerine tek round-trip). Kolon-bazlı ince
 *       yetki: `quality:read` yoksa Kurşun/Tambur, `shipping:read/write` yoksa Sevk boş
 *       (total 0) döner.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ hamStok, fason, kursun, tambur, depo, sevk } — her biri { <items>, total }."
 */
router.get(
  "/production-flow",
  verifyToken,
  requireAnyPermission("roll:read", ...MOBILE_ROLL_READ),
  controller.getProductionFlow,
);

/**
 * @openapi
 * /api/rolls/warehouse-scope:
 *   get:
 *     tags: [Inventory]
 *     summary: Depo kapsam sayaçları — serbest / çuval depo havuzu / planlı sevkiyat
 *     description: WAREHOUSE topları fiziksel yere göre ayırır. Yalnız "free" satılabilir serbest stoktur.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ free, pool, planned } — her biri { count, qty }."
 */
router.get(
  "/warehouse-scope",
  verifyToken,
  requireAnyPermission("roll:read", ...MOBILE_ROLL_READ),
  controller.getWarehouseScope
);

/**
 * @openapi
 * /api/rolls/subcontractor-summary:
 *   get:
 *     tags: [Inventory]
 *     summary: Fasonda özeti — firma + işlem (kategori) bazlı açık fason dağılımı
 *     description: |
 *       AT_SUBCONTRACTOR topların TEK istekte iki dağılımı: `bySubcontractor`
 *       (firma kartları — top adedi, Σ metre, en eski açık sevk tarihi/yaşı) +
 *       `byCategory` (işlem chip'leri — top adedi, Σ metre) + `total`. Açık kalem
 *       tanımı F85 ile aynı: iptalsiz + doğrudan-sevksiz sevkin aktif receipt-item'ı
 *       olmayan kalemi. Açık kalemi bulunamayan top null ("Bilinmiyor") grupta.
 *       Evren FIRE-hariç. "Tümü" = Σ byCategory (her top tam bir kez sayılır).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ bySubcontractor[], byCategory[], total }"
 */
router.get(
  "/subcontractor-summary",
  verifyToken,
  requireAnyPermission("roll:read", ...MOBILE_ROLL_READ),
  controller.getSubcontractorSummary,
);

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
router.get("/:id", verifyToken, requireAnyPermission("roll:read", ...MOBILE_ROLL_READ), controller.findRollById);

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
// 2026-08-05: "roll:history" eklendi — Electron top detayindaki yasam dongusu
// bolumu bu izinle korunuyor (izin yoksa bolum HIC cizilmez). "roll:read" DE
// kabul edilmeye devam ediyor: mobil Depo ekrani bu ucu bugunku izniyle
// kullaniyor ve saha kullanicilarina yeni bir izin atatmak, atanmasi unutulacak
// bir adim daha demekti (2026-08-01 kursun bypass vakasi).
router.get("/:id/history", verifyToken, requireAnyPermission("roll:read", "roll:history", ...MOBILE_ROLL_READ), controller.getRollHistory);

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
 *     responses:
 *       201:
 *         description: Top oluşturuldu
 *       400:
 *         description: Validasyon hatası
 *       404:
 *         description: Ürün bulunamadı
 */
router.post("/initial-entry", verifyToken, requireAnyPermission("roll:write", ...MOBILE_ROLL_WRITE_KK1), controller.createInitialEntry);

/**
 * @openapi
 * /api/rolls/{id}:
 *   delete:
 *     tags: [Inventory]
 *     summary: Topu iptal et (soft delete → CANCELLED)
 *     description: |
 *       Topun durumunu CANCELLED yapar (iptal — SCRAP fire kararı DEĞİL).
 *       STOCK / IN_PRODUCTION / A1_STOCK / WAREHOUSE /
 *       RETURNED_FROM_SUBCONTRACTOR durumundaki toplar iptal edilebilir;
 *       SHIPPED / *_CONSUMED / AT_KARTELA / AT_SUBCONTRACTOR iptal edilemez.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top iptal edildi (CANCELLED)
 *       400:
 *         description: Bu durumdaki top iptal edilemez
 *       404:
 *         description: Top bulunamadı
 */
// K6 (2026-06-12): PATCH /:id/identity kaldırıldı — hiçbir frontend çağırmıyordu
// ('identity' Electron+mobil'de hiç geçmiyor). Servis metodu applyManualProperties
// yaşıyor (domain mantığı, ileride yeniden açılabilir).

/**
 * @openapi
 * /api/rolls/{id}/cancel-preview:
 *   get:
 *     tags: [Inventory]
 *     summary: Top iptal önizlemesi
 *     description: |
 *       Topu iptal etmeden (soft-delete) önce somut etkiyi döner:
 *       iptal edilebilir mi (canCancel), engelliyse neden (blockReason),
 *       bir istasyonda/iş emrinde aktif mi (requiresConfirm + activeAt).
 *       Aktif top'un iptali DELETE ?confirmActive=true gerektirir.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: İptal önizleme bilgisi
 *       404:
 *         description: Top bulunamadı
 */
router.get("/:id/cancel-preview", verifyToken, requireAnyPermission("roll:write", ...MOBILE_ROLL_CANCEL), controller.cancelPreview);

router.delete("/:id", verifyToken, requireAnyPermission("roll:write", ...MOBILE_ROLL_CANCEL), controller.softDelete);

/**
 * @openapi
 * /api/rolls/{id}/restore-cancel:
 *   post:
 *     tags: [Inventory]
 *     summary: Top iptalini geri al (storno'nun storno'su)
 *     description: |
 *       İptal edilmiş bir topu iptalden ÖNCEKİ rafına (`preCancelStatus`) döndürür.
 *       Kapsam DAR ve bilinçli: yalnız hiç hareket görmemiş, partisiz, çuvalsız,
 *       kesilmemiş top. Engel varsa 409 + somut Türkçe sebep (`RESTORE_BLOCKED`).
 *
 *       Var olma sebebi: geri dönüş yolu olmayınca tek çare "yeniden giriş"tir ve
 *       o, aynı fiziksel top için İKİNCİ bir barkod doğurur (2026-08-05 saha vakası).
 *
 *       İzin kümesi `DELETE /:id` (iptal) ile BİREBİR AYNIDIR — iptali yapan kişi
 *       geri de alabilmeli; ayrıştırmak hata yapan operatörü vardiya ortasında
 *       beklemeye ve yine doğaçlamaya iter.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, minLength: 3, maxLength: 500 }
 *     responses:
 *       200:
 *         description: İptal geri alındı
 *       409:
 *         description: Kapsam dışı (RESTORE_BLOCKED) veya yarış kaybı
 *       404:
 *         description: Top bulunamadı
 */
router.post(
  "/:id/restore-cancel",
  verifyToken,
  requireAnyPermission("roll:write", ...MOBILE_ROLL_CANCEL),
  controller.restoreCancelled,
);

/**
 * @openapi
 * /api/rolls/{id}/permanent:
 *   delete:
 *     tags: [Inventory]
 *     summary: Topu arşivle (soft — CANCELLED)
 *     description: |
 *       Topu FİZİKSEL SİLMEZ (CLAUDE.md: asla fiziksel DELETE);
 *       STOCK / SCRAP / CANCELLED durumundaki topu CANCELLED'e çeker,
 *       RollError / RollMovement / RollOperation korunur.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Top arşivlendi (CANCELLED)
 *       400:
 *         description: Sadece STOCK / SCRAP / CANCELLED durumundaki toplar arşivlenebilir
 *       404:
 *         description: Top bulunamadı
 */
router.delete("/:id/permanent", verifyToken, requirePermission("roll:write"), controller.hardDelete);

/**
 * @openapi
 * /api/rolls/{id}/label:
 *   patch:
 *     tags: [Inventory]
 *     summary: Top etiketini değiştir (saha #4 — renk/özellik/en/kalite) + yeniden bas
 *     description: |
 *       Yanlış/eksik etiketli stok topunu tartı-paket/sevkiyat ekranından düzeltir.
 *       Yalnız serbest STOCK/WAREHOUSE veya PLANNED sevkiyattaki toplar; sevke
 *       hazır/sevk edilmiş sevkiyatta önce "Hazırlığa Geri Al" gerekir (kapsama bütünlüğü).
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
 *               colorId: { type: string, format: uuid, nullable: true }
 *               propertyIds: { type: array, items: { type: string, format: uuid } }
 *               width: { type: number, nullable: true }
 *               qualityGrade: { type: string }
 *     responses:
 *       200: { description: Etiket güncellendi }
 *       409: { description: Top commit'li sevkiyatta — önce hazırlığa geri al }
 */
router.patch(
  "/:id/label",
  verifyToken,
  requireAnyPermission("roll:write", "label:edit", "mobile:tarti-paket", "mobile:sevkiyat"),
  controller.relabel,
);

/**
 * @openapi
 * /api/rolls/{id}/prepare-for-sale:
 *   post:
 *     tags: [Inventory]
 *     summary: Ham/stok topu satışa hazırla (saha #10 — STOCK → WAREHOUSE)
 *     description: |
 *       İşlenmeden gelen ham kumaşı sevke hazır (WAREHOUSE) statüsüne alır; sonrasında
 *       normal sevk akışı (paketleme + karşılanma + dispatch) çalışır. Top serbest olmalı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Top satışa hazırlandı (WAREHOUSE) }
 *       409: { description: Top serbest değil (sevkiyat/iş emri/fason) }
 */
router.post(
  "/:id/prepare-for-sale",
  verifyToken,
  requireAnyPermission("roll:write", "mobile:tarti-paket", "mobile:sevkiyat", "mobile:hizli-is-emri"),
  controller.prepareForSale,
);

/**
 * @openapi
 * /api/rolls/{id}/manual-attributes:
 *   patch:
 *     tags: [Inventory]
 *     summary: Süpervizör manuel nitelik düzeltme (renk/özellik/en/kalite) + zorunlu sebep
 *     description: |
 *       applyManualProperties motoru + ZORUNLU sebep (audit event=MANUAL_ATTRIBUTE).
 *       Barkodsuz açık kumaşta da çalışır (roll.id ile). itemId/barcode KAPSAM DIŞI.
 *       Commit'li sevkiyatta 409 (önce hazırlığa geri al).
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
 *               colorId:      { type: string, format: uuid, nullable: true }
 *               propertyIds:  { type: array, items: { type: string, format: uuid } }
 *               width:        { type: number, nullable: true }
 *               qualityGrade: { type: string }
 *               reason:       { type: string, minLength: 3 }
 *     responses:
 *       200: { description: Nitelikler güncellendi }
 *       409: { description: Commit'li sevkiyatta — önce hazırlığa geri al }
 */
router.patch(
  "/:id/manual-attributes",
  verifyToken,
  requirePermission("roll:manual-adjust"),
  controller.manualAttributes,
);

/**
 * @openapi
 * /api/rolls/{id}/rescue-preview:
 *   get:
 *     tags: [Inventory]
 *     summary: İstasyonda takılı (IN_PRODUCTION) top kurtarma önizlemesi
 *     description: |
 *       eligible yalnız IN_PRODUCTION topta true; açık fason sevki + açık hareket
 *       sayısı + istasyon adı + barkod üretilecek mi bilgisini döner. Salt-okunur.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "RescuePreview (eligible + blockReasons + station + openMovementCount)" }
 *       404: { description: Top bulunamadı }
 */
router.get(
  "/:id/rescue-preview",
  verifyToken,
  requirePermission("roll:manual-adjust"),
  controller.rescuePreview,
);

/**
 * @openapi
 * /api/rolls/{id}/rescue-stuck:
 *   post:
 *     tags: [Inventory]
 *     summary: İstasyonda takılı (IN_PRODUCTION) topu depoya kurtar
 *     description: |
 *       Süpervizör aksiyonu (roll:manual-adjust). Açık hareketleri fiziksel çıkışla
 *       kapatır (top metresiyle çıktı), topu WAREHOUSE'a alır, barkodsuzsa final
 *       etiket üretir. Zorunlu sebep (audit event=RESCUE_STUCK_ROLL). Kapanan movement
 *       "geçti" sayılır → adım/WO oto-COMPLETE olabilir.
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
 *               reason: { type: string, minLength: 3, description: İşlem nedeni (audit) }
 *     responses:
 *       200: { description: Top istasyondan kurtarıldı (WAREHOUSE) }
 *       404: { description: Top bulunamadı }
 *       409: { description: Top üretimde değil / açık fason sevki / yarış }
 */
router.post(
  "/:id/rescue-stuck",
  verifyToken,
  requirePermission("roll:manual-adjust"),
  controller.rescueStuck,
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
  requireAnyPermission("roll:write", ...MOBILE_ROLL_WRITE_KURSUN),
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
 *       - RollOperation: QC2_COMPLETED her zaman; KURSUN_APPLIED yalnız KURSUN özelliği topa GERÇEKTEN yazıldıysa
 *       - İstasyon özellikleri MODA göre uygulanır (2026-08-10): AUTO her zaman;
 *         OPTIONAL yalnız `properties` listesinde geldiyse; REQUIRED eksikse 400.
 *         SEÇİM (CHOICE) tipli özellikte `valueCode` zorunlu, BAYRAK'ta yasak.
 *         Eski APK `properties` göndermez → yalnız AUTO uygulanır.
 *       - Kurşun/KK2 movement'ı kapatılır (qtyOut = totalMeters)
 *       - Sonraki step (Tambur) için movement açılır + Roll.currentStepId güncellenir
 *
 *       Yeniden çağırma idempotenttir (Roll PROCESS_QC'yi bırakmışsa 200 döner).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               totalMeters: { type: number, example: 500, description: "Opsiyonel — verilmezse mevcut currentQty kullanılır" }
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
  requireAnyPermission("roll:write", ...MOBILE_ROLL_WRITE_KURSUN),
  controller.kursunFinish,
);

export default router;
