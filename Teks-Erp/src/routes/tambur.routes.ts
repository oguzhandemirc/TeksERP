// =============================================================================
// TeksERP - Tambur Routes
// =============================================================================

import { Router } from "express";
import { TamburController } from "../controllers/tambur.controller";
import { TamburManualController } from "../controllers/tambur-manual.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const controller = new TamburController();
/** Saha düzeltmesi uçları (`/manual/*`) — ayrı controller, aynı router. */
const manualController = new TamburManualController();
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
router.get("/pending-rolls", verifyToken, requireAnyPermission("quality:read", "mobile:tambur"), controller.getPendingRolls);

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
 *       - in: query
 *         name: mode
 *         description: "'cursor' → cursor-paginated cevap (mobil infinite scroll)"
 *         schema: { type: string, enum: [cursor] }
 *       - in: query
 *         name: cursor
 *         description: Bir önceki sayfanın nextCursor değeri
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         description: Barkod / ürün adı-kodu / renk / parti araması
 *         schema: { type: string }
 *       - in: query
 *         name: withTotal
 *         description: Cursor mode ilk sayfada totalEstimate döndür
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: "Toplar listesi — cursor mode'da pagination.nextCursor/hasMore ile" }
 */
router.get(
  "/recent-output-rolls",
  verifyToken,
  requireAnyPermission("quality:read", "mobile:tambur"),
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
  requireAnyPermission("quality:read", "mobile:tambur"),
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
  requireAnyPermission("quality:read", "mobile:tambur"),
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
  requireAnyPermission("quality:read", "mobile:tambur"),
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
 *             required: [rollId, stepId, startMeter, defectTypeId]
 *             properties:
 *               rollId:       { type: string, format: uuid }
 *               stepId:       { type: string, format: uuid }
 *               startMeter:   { type: number }
 *               defectTypeId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Hata kaydı oluşturuldu }
 *       400: { description: Geçersiz aralık veya pasif hata tipi }
 *       404: { description: Top, adım veya hata tipi bulunamadı }
 */
router.post(
  "/report-error",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:tambur"),
  controller.reportError
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
router.get("/rolls/:rollId", verifyToken, requireAnyPermission("quality:read", "mobile:tambur"), controller.getRollForDecision);

/**
 * @swagger
 * /api/tambur/rolls/{rollId}/undo-preview:
 *   get:
 *     summary: Tambur geri alma önizlemesi (salt-okunur)
 *     description: >
 *       rollId çocuk parça da olabilir kaynak top da — mod sunucuda çözülür.
 *       SINGLE = seri sürerken tek parça iptali; FULL = finalize'ı tümden geri al
 *       (tüm parçalar iptal, kaynak top Tambur adımına döner, kapatılan hatalar
 *       yeniden açılır, tamamlanmış iş emri dirilir). Etkilenen her kayıt
 *       barkoduyla listelenir; engelliyse blockReason döner (yıkıcı-işlem onay kuralı).
 *     tags: [Tambur]
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  "/rolls/:rollId/undo-preview",
  verifyToken,
  // "mobile:tambur-duzelt" 2026-08-04te eklendi: elle eklenen topu GERI ALMA
  // (MANUAL modu) da bu uctan gecer ve karar "ekleyen kendisi geri alsin" oldu.
  // Yaratma izni bu kod; iptal izni baska bir kumede kalsaydi yaratabilen kisi
  // hatasini duzeltemez, vardiya ortasinda birini beklerdi.
  requireAnyPermission("quality:read", "mobile:tambur", "mobile:tambur-duzelt"),
  controller.getUndoPreview,
);

/**
 * @swagger
 * /api/tambur/rolls/{rollId}/undo:
 *   post:
 *     summary: Tambur kesim/finalize geri al (önizleme onaylı akış)
 *     description: >
 *       Önizlemedeki mod tx içinde TAZE yeniden çözülür; parçalardan biri bu
 *       arada çuvala/sevke/yeni iş emrine kaçtıysa 409 + tam rollback. Depo
 *       kesimi kapanışı (kalıcı iz yazmayan yol) bilinçli kapsam dışıdır.
 *     tags: [Tambur]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri alındı — iptal edilen parçalar + dönen metraj }
 *       409: { description: Engelli parça / yarış — hiçbir şey değişmedi }
 */
router.post(
  "/rolls/:rollId/undo",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:tambur", "mobile:tambur-duzelt"),
  controller.applyUndo,
);

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
 *             required: [rollId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               cuts:
 *                 type: array
 *                 description: Operatörün tamburda yaptığı sıralı kesimler; her biri yeni child Roll.
 *                 items:
 *                   type: object
 *                   required: [length, qualityGrade]
 *                   properties:
 *                     length: { type: number, description: Kesim uzunluğu (m), pozitif }
 *                     qualityGrade: { type: string, description: Kesilen parçanın kalite kodu }
 *                     relatedErrorIds: { type: array, items: { type: string, format: uuid } }
 *               decisions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [errorId, decision]
 *                   properties:
 *                     errorId: { type: string, format: uuid }
 *                     decision: { type: string, enum: [CUT, NO_CUT] }
 *               foldType: { type: string, enum: [2-KAT, 4-KAT] }
 *               markedForKartela: { type: boolean }
 *     responses:
 *       200:
 *         description: Tambur finalizasyonu tamamlandı (orijinal top + kesim topları)
 *       400:
 *         description: Validasyon hatası
 *       404:
 *         description: Top bulunamadı
 */
router.post("/finalize", verifyToken, requireAnyPermission("quality:write", "mobile:tambur"), controller.finalize);

// NOT: POST /api/tambur/swatch kaldırıldı. Kartela artık Tambur'da kesilmez;
// kartela fason dönüşünde doğar (POST /api/kartela/receive). Bkz. docs/design/KARTELA-TASARIM.md.

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
 *       - WO'ya bağlı orderlar + her sipariş satırı için orderedQty
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
  requireAnyPermission("quality:read", "mobile:tambur"),
  controller.getTamburContext,
);

/**
 * @openapi
 * /api/tambur/bypass-complete:
 *   post:
 *     tags: [Tambur]
 *     summary: Kurşun Dağıtım'ı Tambur okutmasıyla tamamla (kurşun bypass)
 *     description: |
 *       Kurşun istasyonunda tablet YOKTUR. İş, Kurşun Dağıtım ekranından fiziksel
 *       bir kurşun MAKİNESİNE atanır (istasyon tektir ve değişmez); Tambur
 *       operatörü refakat kartını okutup
 *       (`GET /api/tambur/context/{cardBarcode}` → `bypassPending`)
 *       önizlemeyi onayladığında bu uç çağrılır:
 *       - Kurşun/KK2 adımının açık movement'ları `KURSUN_BYPASS_FINISHED:<uuid>`
 *         marker'ıyla kapanır (adım COMPLETED olur — **SKIPPED DEĞİL**) ve
 *         `RollMovement.machineId` = ATANAN MAKİNE damgalanır,
 *       - istasyon yetenekleri (KURSUN) makinenin istasyonundan toplara kopyalanır,
 *       - toplar Tambur adımına giriş movement'ı ile geçer.
 *
 *       `RollOperation` (QC2_COMPLETED/KURSUN_APPLIED) YAZILMAZ ve `RollError`
 *       açılmaz (hatalar kâğıtta). **Kalite NULL kalır** — kaliteyi Tambur belirler.
 *
 *       `rollIds` KAPSAM sözleşmesidir: önizlemede görülen toplar birebir
 *       gönderilir; kapsam bu sırada değiştiyse 409 döner (yarım kapanış yok).
 *       Idempotent: dağıtım zaten tamamlanmışsa `alreadyDone=true`.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cardBarcode, rollIds]
 *             properties:
 *               cardBarcode:
 *                 type: string
 *                 description: Refakat kartı karekodu (İş Emri No)
 *               rollIds:
 *                 type: array
 *                 minItems: 1
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200: { description: "Kurşun adımı tamamlandı, toplar Tambur'a alındı (veya idempotent tekrar)" }
 *       400: { description: Geçersiz gövde / kart aktif değil }
 *       401: { description: Yetkisiz }
 *       404: { description: Refakat kartı bulunamadı veya bekleyen kurşun dağıtımı yok }
 *       409: { description: Kapsam değişmiş, rota Tambur'a çıkmıyor ya da iş emri ölü }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/bypass-complete",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:tambur"),
  controller.completeKursunBypass,
);

// =============================================================================
// SAHA DÜZELTMESİ (`/manual/*`) — operatör self-servis
// =============================================================================
// Yetki: `roll:manual-adjust` (süpervizör) VEYA `mobile:tambur-duzelt` (panelden
// SEÇİLİ Tambur operatörüne verilir; varsayılan operatör paketinde YOKTUR).
// Rota sırası: `/manual/*` sabit segmentleri `/:id/cut` gibi parametreli
// rotalarla ÇAKIŞMAZ (ikinci segmentler farklı), yine de niyet açık olsun diye
// parametreli blokların ÖNÜNE konmuştur.
// Hata gövdeleri makine-okunur `code` taşır (mobil onu okur): STEP_NOT_FOUND,
// STEP_NOT_TAMBUR, STATION_MISMATCH, WORKORDER_DEAD, ROLL_NOT_FOUND, ROLL_DEAD,
// ROLL_IN_SACK, ROLL_IN_SHIPMENT, ROLL_AT_SUBCONTRACTOR, ROLL_STATUS_NOT_MOVABLE,
// ROLL_OTHER_WORKORDER, ROLL_ALREADY_HERE, ROLL_STATE_CHANGED, REASON_REQUIRED,
// QTY_REQUIRED, ITEM_REQUIRED, MOVE_REJECTED · `/manual/produce` ek kodları:
// ORDER_LINE_NOT_FOUND, CUSTOMER_NOT_FOUND, CUSTOMER_INACTIVE, ENTRY_REJECTED,
// CLIENT_TOKEN_COLLISION.
//
// ÜÇ UÇ, İKİ NİYET: `/manual/bring*` ve `/manual/roll` KART VARSAYAR (`targetStepId`
// zorunlu → çıktı iş emri adımına bağlanır, IN_PRODUCTION). `/manual/produce` kartın
// YOKLUĞUNU varsayar (adım alanı YOK → doğrudan Bitmiş Depo). Aynı uca opsiyonel
// `targetStepId` EKLEME: kapsam "alan dolu mu"ya bağlanır ve iki niyet karışır.

/**
 * @openapi
 * /api/tambur/manual/bring-preview:
 *   post:
 *     tags: [Tambur]
 *     summary: "Mevcut Topu Buraya Al — ÖNİZLEME (salt-okunur)"
 *     description: |
 *       Barkodu okutulan (ya da listeden seçilen) topun bu Tambur adımına
 *       alınmasının SOMUT etkilerini döner; hiçbir şeyi değiştirmez:
 *       top hangi iş emri/adımdan gelecek, hedef-sonrası kalite/kurşun kararı
 *       VOID olacak mı, ileri atlamada hangi adımlar SKIPPED olacak, yeni parti
 *       numarası doğacak mı, tamamlanmış iş emri yeniden açılacak mı.
 *
 *       Taşımanın kendisi `POST /api/work-orders/{id}/manual-move` ile AYNI
 *       motordur (`WorkOrderManualMoveService`) — saha yolu paralel bir mantık
 *       taşımaz. Saha kapsamı iki kuralla DAHA DARDIR: başka iş emrine bağlı top
 *       reddedilir (`ROLL_OTHER_WORKORDER`) ve hedef adım oturumun istasyonuyla
 *       eşleşmelidir (`STATION_MISMATCH`).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetStepId]
 *             properties:
 *               targetStepId: { type: string, format: uuid, description: "Ekrandaki Tambur adımı (WorkOrderStep)" }
 *               barcode:      { type: string, description: "Top barkodu (okutma) — rollId ile birlikte en az biri zorunlu" }
 *               rollId:       { type: string, format: uuid }
 *     responses:
 *       200: { description: "Önizleme — canApply/blockCode/blockReason/warnings/effects" }
 *       400: { description: "Geçersiz gövde / adım Tambur tipinde değil" }
 *       404: { description: "Top ya da adım bulunamadı" }
 *       409: { description: "Oturum başka istasyonda ya da iş emri iptal/devredilmiş" }
 */
router.post(
  "/manual/bring-preview",
  verifyToken,
  requireAnyPermission("roll:manual-adjust", "mobile:tambur-duzelt"),
  manualController.getBringPreview,
);

/**
 * @openapi
 * /api/tambur/manual/bring:
 *   post:
 *     tags: [Tambur]
 *     summary: "Mevcut Topu Buraya Al — UYGULA (önizleme onaylı akış)"
 *     description: |
 *       Topu bu Tambur adımına taşır. SEBEP ZORUNLUDUR (en az 3 karakter) ve
 *       audit'e yazılır (`event=TAMBUR_MANUAL_BRING` — panel taşımasının
 *       `MANUAL_MOVE` izine EK olarak, saha yolunu makine/istasyonla ayırt eder).
 *
 *       Reddedilenler: ölü statüler (tüketilmiş/iptal), çuvaldaki/sevkiyattaki top,
 *       fasondaki top, iptal/devredilmiş iş emri, başka iş emrine bağlı top.
 *       Yarış durumunda taşıma servisi atomik claim ile 409 döner (hiçbir şey
 *       değişmez); mesaj korunur, gövdeye `code: MOVE_REJECTED` eklenir.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetStepId, reason]
 *             properties:
 *               targetStepId: { type: string, format: uuid }
 *               barcode:      { type: string }
 *               rollId:       { type: string, format: uuid }
 *               reason:       { type: string, minLength: 3, maxLength: 500 }
 *     responses:
 *       200: { description: "Top adıma alındı" }
 *       400: { description: "Geçersiz gövde / sebep eksik" }
 *       404: { description: "Top ya da adım bulunamadı" }
 *       409: { description: "Engelli top / yarış / ölü iş emri — hiçbir şey değişmedi" }
 */
router.post(
  "/manual/bring",
  verifyToken,
  requireAnyPermission("roll:manual-adjust", "mobile:tambur-duzelt"),
  manualController.bringRoll,
);

/**
 * @openapi
 * /api/tambur/manual/send-to-dye-preview:
 *   post:
 *     tags: [Tambur]
 *     summary: "Boyahaneye Geri Gönder — ÖNİZLEME (plan-sapma kararının rework kolu)"
 *     description: |
 *       Topu rotadaki ÖNCEKİ renk veren adıma geri almanın etkilerini söyler;
 *       hiçbir şeyi değiştirmez. **Hedef adım gövdede GÖNDERİLMEZ** — sunucu
 *       rotadan çözer (kanonik `stepCanApplyColor`: istasyon bayrağı VEYA adımda
 *       seçilmiş fason hizmeti), mevcut adımdan önceki EN YAKIN boya adımını seçer.
 *
 *       Cevap: `targetStep{ stationName, isExternal }`, `canApply`, `blockCode`,
 *       `warnings[]` (kalite VOID, yeni parti, fason sevk hatırlatması),
 *       `effects{ direction, reopenedStepNames, qualityWillVoid, newParty }`.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               barcode: { type: string }
 *               rollId:  { type: string, format: uuid }
 *     responses:
 *       200: { description: "Önizleme (canApply=false ise blockCode/blockReason dolu)" }
 *       400: { description: "Top Tambur'da değil / rotada önce boya adımı yok" }
 *       409: { description: "Oturum başka istasyonda / iptal-devredilmiş iş emri" }
 */
router.post(
  "/manual/send-to-dye-preview",
  verifyToken,
  requireAnyPermission("roll:manual-adjust", "mobile:tambur-duzelt"),
  manualController.getSendToDyePreview,
);

/**
 * @openapi
 * /api/tambur/manual/send-to-dye:
 *   post:
 *     tags: [Tambur]
 *     summary: "Boyahaneye Geri Gönder — UYGULA (önizleme onaylı akış)"
 *     description: |
 *       Topu rotadaki önceki boya adımına taşır. SEBEP ZORUNLUDUR (≥3 karakter);
 *       audit `event=TAMBUR_SEND_TO_DYE` (taşımanın kendi `MANUAL_MOVE` izine EK).
 *
 *       Taşımanın tamamı `WorkOrderManualMoveService.manualMove`de: hedef sonrası
 *       kalite/kurşun kararları VOID olur (kalite Belirsiz), hayalet hareketler
 *       silinir, SKIPPED adımlar PENDING'e açılır, tamamlanmış iş emri dirilir.
 *
 *       ⚠️ Taşıma topu `AT_SUBCONTRACTOR` YAPMAZ — mal fason adımında ÜRETİMDE
 *       bekler; boyahaneye fiziksel çıkış ayrıca **Fason Sevk** ile yapılır
 *       (taşınan top o ekranın listesinde kendiliğinden görünür).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               barcode: { type: string }
 *               rollId:  { type: string, format: uuid }
 *               reason:  { type: string, minLength: 3, maxLength: 500 }
 *     responses:
 *       200: { description: "Top boya adımına alındı" }
 *       400: { description: "Sebep eksik / top Tambur'da değil / rotada boya adımı yok" }
 *       409: { description: "Engelli top (çuval/sevk/fason/kesim yapılmış) — hiçbir şey değişmedi" }
 */
router.post(
  "/manual/send-to-dye",
  verifyToken,
  requireAnyPermission("roll:manual-adjust", "mobile:tambur-duzelt"),
  manualController.sendToDye,
);

/**
 * @openapi
 * /api/tambur/manual/roll:
 *   post:
 *     tags: [Tambur]
 *     summary: "Manuel Top Ekle — sistemde olmayan topu elle yarat + Tambur'a bağla"
 *     description: |
 *       **Bu uç envanter zincirindeki tek DELİKTİR** (diğer her top KK1 girişine,
 *       fason kabul makbuzuna ya da bir topun kesilmesine dayanır) — bu yüzden
 *       delik açıkça işaretlenir ve sebebi kalıcı olarak saklanır:
 *       - `Roll.entrySource = MANUAL_ENTRY` (kolon; "elle eklenenler" raporu tek filtre),
 *       - audit `event = TAMBUR_MANUAL_ROLL` (sebep + operatör + makine + istasyon + iş emri),
 *       - giriş hareketinde `notes = "TAMBUR_MANUAL_ROLL: <sebep>"` (operasyonel iz;
 *         finalize bu notu ezer — kalıcı çapa ilk ikisidir).
 *
 *       Barkod SUNUCUDA üretilir (istemci gönderemez). `clientToken` ZORUNLUDUR:
 *       offline/ağ-retry'de mükerrer top doğmasın (`Roll.clientToken @unique`).
 *       Ürün/renk verilmezse iş emrinin hedefinden miras alınır; `colorId: null`
 *       açıkça "renksiz" demektir. Ağırlık, KK1 ağırlık girişi ayarı kapalıysa
 *       reddedilir (tüm giriş yollarında ortak choke-point).
 *
 *       Doğan top doğrudan `IN_PRODUCTION` + bu Tambur adımına bağlanır (açık
 *       hareketle) → operatör hemen kesebilir. Tamamlanmış iş emri bu işlemle
 *       yeniden açılır ve refakat kartı aktifleşir.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetStepId, initialQty, reason, clientToken]
 *             properties:
 *               targetStepId: { type: string, format: uuid }
 *               initialQty:   { type: number, description: "Metraj (m) — zorunlu" }
 *               reason:       { type: string, minLength: 3, maxLength: 500 }
 *               clientToken:  { type: string, format: uuid, description: "İdempotency anahtarı — MANTIKSAL deneme başına bir kez üretilir" }
 *               itemId:       { type: string, format: uuid, description: "Verilmezse iş emrinin hedef ürünü" }
 *               colorId:      { type: string, format: uuid, nullable: true, description: "Verilmezse iş emrinin hedef rengi; null = renksiz" }
 *               width:        { type: number, nullable: true }
 *               qualityGrade: { type: string }
 *               weightKg:     { type: number }
 *     responses:
 *       201: { description: "Top oluşturuldu ve Tambur adımına bağlandı" }
 *       400: { description: "Geçersiz gövde / sebep-metraj eksik / ürün çözülemedi / ağırlık girişi kapalı" }
 *       404: { description: "Adım bulunamadı" }
 *       409: { description: "Oturum başka istasyonda, iş emri ölü ya da idempotency çakışması" }
 */
router.post(
  "/manual/roll",
  verifyToken,
  requireAnyPermission("roll:manual-adjust", "mobile:tambur-duzelt"),
  manualController.createManualRoll,
);

/**
 * @openapi
 * /api/tambur/manual/produce:
 *   post:
 *     tags: [Tambur]
 *     summary: "Manuel Mod — kartsız BİTMİŞ ürün üret (doğrudan Bitmiş Depo)"
 *     description: |
 *       Tambur ekranını **refakat kartı olmadan** kullandırır: operatör ekrandaki
 *       kumaş / metraj / müşteri seçimini yapar, çıkan top doğrudan **Bitmiş Depo**'ya
 *       (`RollStatus.WAREHOUSE`) yazılır. Hiçbir iş emrine, adıma, partiye ya da
 *       `RollMovement`'a bağlanmaz (`currentStepId = null`).
 *
 *       **`POST /manual/roll` ile karıştırma:** orada `targetStepId` ZORUNLUDUR ve
 *       çıktı bir iş emri adımına bağlanır (`IN_PRODUCTION`) — o uç *"kart var ama
 *       top ekranda yok"* içindir. Burada kart YOKTUR (acil durum: top bir yerde
 *       takıldı ya da elde kalan bitmiş mal acilen sisteme alınacak).
 *
 *       **KK1 girişinin kopyası DEĞİLDİR.** KK1 = ham top girişi (olağan iş akışı);
 *       bu uç = bitmiş ürün (istisna). Fark tek satırda somuttur: statü **AÇIKÇA**
 *       `WAREHOUSE` verilir, `createInitialEntry`in renk sezgisine bırakılmaz —
 *       aksi halde **renksiz** (ham beyaz) bitmiş top sessizce Ham Stok'a düşer ve
 *       operatör onu Bitmiş Depo'da bulamaz. Barkod tip damgası da (H/F) statüden
 *       türer → renksiz bitmiş top "F" (final) barkod alır.
 *
 *       Kalıcı iz: `Roll.entrySource = TAMBUR_MANUAL` (kendi enum değeri; istek
 *       Tambur tabletinden gelse bile `SUPPLIER_RECEIPT`, Electron'dan gelmediği
 *       için de `MANUAL_ENTRY` DAMGALANMAZ — top detayında "Tambur (Manuel)") + audit
 *       `event = TAMBUR_MANUAL_PRODUCE` (sebep + operatör + makine + istasyon).
 *       `form = TOP` (Tambur bitmiş top üretir; şema varsayılanı).
 *
 *       Müşteri/sipariş **niyeti** topun `lastLabelSnapshot`'ına yazılır — gevşek
 *       model: BAĞ değil, baskı-anı bağlamı (Tambur kesimiyle AYNI çözümleyici).
 *       İkisi de boşsa `{stock:true}`. `clientToken` ZORUNLUDUR: ağ-retry'de
 *       mükerrer top doğmasın (`Roll.clientToken @unique`); tekrar denemede aynı
 *       top döner ve yanıt `idempotentReplay: true` taşır.
 *
 *       Ağırlık, KK1 ağırlık girişi ayarı kapalıysa reddedilir (tüm giriş
 *       yollarının ortak choke-point'i).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemId, initialQty, reason, clientToken]
 *             properties:
 *               itemId:            { type: string, format: uuid, description: "ZORUNLU — miras alınacak iş emri yok" }
 *               colorId:           { type: string, format: uuid, nullable: true, description: "Boş = renksiz; statüyü ETKİLEMEZ" }
 *               initialQty:        { type: number, description: "Metraj (m) — zorunlu" }
 *               qualityGrade:      { type: string, description: "Katalog kodu; verilmezse kalite Belirsiz" }
 *               width:             { type: number, nullable: true }
 *               weightKg:          { type: number }
 *               targetOrderLineId: { type: string, format: uuid, nullable: true, description: "Etiket niyeti — müşteriye önceliklidir" }
 *               targetCustomerId:  { type: string, format: uuid, nullable: true }
 *               markedForKartela:  { type: boolean }
 *               reason:            { type: string, minLength: 3, maxLength: 500 }
 *               clientToken:       { type: string, format: uuid, description: "İdempotency anahtarı — MANTIKSAL deneme başına bir kez üretilir" }
 *     responses:
 *       201: { description: "Bitmiş top Bitmiş Depo'ya eklendi (rollId/barcode/status/idempotentReplay)" }
 *       400: { description: "Geçersiz gövde / sebep-metraj-ürün eksik / müşteri pasif / ağırlık girişi kapalı" }
 *       404: { description: "Ürün, renk ya da kalite bulunamadı (pasif dahil)" }
 *       409: { description: "Çalışma oturumu yok (mobil) ya da clientToken farklı bir topla kullanılmış" }
 */
router.post(
  "/manual/produce",
  verifyToken,
  requireAnyPermission("roll:manual-adjust", "mobile:tambur-duzelt"),
  manualController.produceFinishedRoll,
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
  requireAnyPermission("quality:write", "mobile:tambur"),
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
  requireAnyPermission("quality:write", "mobile:tambur"),
  controller.finalizeOpenFabric,
);

/**
 * @swagger
 * /api/tambur/{id}/cut-warehouse:
 *   post:
 *     tags: [Tambur]
 *     summary: Top Kesme — depo (WAREHOUSE) topundan parça kes
 *     description: |
 *       Barkodlu depo topundan istenen metrede yeni child Roll oluşturur. Parent
 *       özellikleri (color, width, RollProperty, KURSUN_APPLIED, QC2_COMPLETED)
 *       inherit edilir. Multi-cut: aynı parent için tekrar tekrar çağrılabilir.
 *       Parent.currentQty düşer, parent yaşamaya devam eder (finalize'a kadar).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Kesim başarılı, child barkodlu top oluştu }
 *       400: { description: Parent açık kumaş / status WAREHOUSE değil / metre yetmiyor }
 */
router.post(
  "/:id/cut-warehouse",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:tambur"),
  controller.cutWarehouseRoll,
);

/**
 * @swagger
 * /api/tambur/{id}/finalize-warehouse-cut:
 *   post:
 *     tags: [Tambur]
 *     summary: Top Kesme bitir — parent topu arşivle, kalan için karar
 *     description: |
 *       Top Kesme oturumunu kapatır: parent Roll TAMBUR_CONSUMED'a çekilir.
 *       Kalan kumaş varsa `remainingAction`'a göre 1.KALITE/A1/FIRE child Roll
 *       oluşturulur veya discard edilir.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Top arşivlendi, kalan karar uygulandı }
 */
router.post(
  "/:id/finalize-warehouse-cut",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:tambur"),
  controller.finalizeWarehouseCut,
);

export default router;

