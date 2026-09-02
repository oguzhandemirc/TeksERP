// =============================================================================
// TeksERP - Kurşun + QC2 Routes
// =============================================================================

import { Router } from "express";
import { KursunQcController } from "../controllers/kursun-qc.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireProductionEnabled } from "../middlewares/module.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";

const controller = new KursunQcController();
const router = Router();

// Modül kapısı — bu router'daki HER uç için (2026-09-02).
// ⚠️ Kapı `verifyToken`dan SONRA: kimliksiz istek 401 almalı, 403 değil
// (403 "kaynak var ama modül kapalı" bilgisini kimliksiz kişiye sızdırırdı).
// ⚠️ `router.use` ile TOPLU: uç uç yazılırsa biri unutulur ve unutulan uç
// sessizce açık kalır. Sıra da load-bearing — bu satırdan ÖNCE tanımlanan bir
// uç kapıyı HİÇ görmez (Express kayıt sırası; hata da log da üretmez).
router.use(verifyToken, requireProductionEnabled);

/**
 * @openapi
 * /api/kursun-qc/by-card/{barcode}:
 *   get:
 *     tags: [KursunQc]
 *     summary: Refakat kartı barkodu ile PROCESS_QC adımını ve açık topları getir
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Adım özeti ve top listesi }
 *       400: { description: Kart aktif değil veya adım bulunamadı }
 *       404: { description: Refakat kartı bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/by-card/:barcode",
  verifyToken,
  requireAnyPermission("quality:read", "mobile:kk2-kursun"),
  controller.getByCardBarcode
);

/**
 * @openapi
 * /api/kursun-qc/step/{stepId}:
 *   get:
 *     tags: [KursunQc]
 *     summary: PROCESS_QC adım özeti (test/admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Adım özeti }
 *       400: { description: Adım PROCESS_QC tipinde değil }
 *       404: { description: Adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/step/:stepId",
  verifyToken,
  requireAnyPermission("quality:read", "mobile:kk2-kursun"),
  controller.getStep
);

/**
 * @openapi
 * /api/kursun-qc/open-cards:
 *   get:
 *     tags: [KursunQc]
 *     summary: PROCESS_QC istasyonlarında açık top bekleyen aktif refakat kartları
 *     description: |
 *       Mobil "kamera simülasyonu" modal'ı için. Sahada operatör fiziksel kart
 *       yokken bu listeden seçim yapabilir. Filtre: PROCESS_QC adımı COMPLETED
 *       olmamış, en az bir açık top mevcut, WO'nun ACTIVE refakat kartı var.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Açık kart listesi }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/open-cards",
  verifyToken,
  requireAnyPermission("quality:read", "mobile:kk2-kursun"),
  controller.listOpenCards
);

/**
 * @openapi
 * /api/kursun-qc/complete-qc2:
 *   post:
 *     tags: [KursunQc]
 *     summary: Bir topun QC2'sini tamamlandı olarak işaretle (istasyon özellik modlarına göre uygular)
 *     description: |
 *       İstasyonun özellik listesi MODA göre uygulanır (2026-08-10): AUTO satırlar
 *       operatör göndermese de topa yazılır; OPTIONAL yalnız `properties` listesinde
 *       geldiyse; REQUIRED eksikse özellik adıyla 400. SEÇİM (CHOICE) tipli özellikte
 *       `valueCode` zorunludur (örn. GRAMAJ → "50GR"), BAYRAK (FLAG) tipte yasaktır.
 *       KURSUN özelliği topa gerçekten yazıldıysa KURSUN_APPLIED log'u atılır.
 *       Eski APK `properties` alanını hiç göndermez → yalnız AUTO uygulanır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollId, stepId]
 *             properties:
 *               rollId: { type: string, format: uuid }
 *               stepId: { type: string, format: uuid }
 *               notes:  { type: string }
 *               properties:
 *                 type: array
 *                 maxItems: 50
 *                 description: Operatör cevapları — AUTO satırlar için gerekmez.
 *                 items:
 *                   type: object
 *                   required: [propertyId]
 *                   properties:
 *                     propertyId: { type: string, format: uuid }
 *                     valueCode:
 *                       type: string
 *                       maxLength: 32
 *                       nullable: true
 *                       description: SEÇİM tipli özellikte katalog değer kodu (zorunlu); BAYRAK'ta gönderilmez.
 *     responses:
 *       201: { description: İşlem kaydedildi }
 *       400: { description: Top bu adımda değil }
 *       401: { description: Yetkisiz }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/complete-qc2",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:kk2-kursun"),
  controller.completeQc2
);

// K6 (2026-06-12): POST /undo-qc2 kaldırıldı — UI butonu 2026-06-07'de bilinçli
// silinmişti (yarım geri alma: KURSUN op + RollProperty topta kalıyordu), endpoint
// çağrısız duruyordu. Kurtarma yolu: kapalı kartı tekrar okut (reopen-preview → reopen).

/**
 * @openapi
 * /api/kursun-qc/report-error:
 *   post:
 *     tags: [KursunQc]
 *     summary: Topta hata tespiti — Tambur'da karara bağlanır
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
 *               startMeter:   { type: number, example: 120 }
 *               defectTypeId:
 *                 type: string
 *                 format: uuid
 *                 description: DefectType.id — operatör kataloğundan seçer, serbest metin kabul edilmez.
 *               clientErrorId: { type: string, format: uuid, description: Mobil offline kuyruğu için opsiyonel idempotency UUID }
 *     responses:
 *       201: { description: Hata kaydı oluşturuldu }
 *       400: { description: Metraj aralığı geçersiz veya hata tipi pasif }
 *       401: { description: Yetkisiz }
 *       404: { description: Top veya hata tipi bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/report-error",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:kk2-kursun"),
  controller.reportError
);

/**
 * @openapi
 * /api/kursun-qc/error:
 *   delete:
 *     tags: [KursunQc]
 *     summary: Tambur karar vermeden önce hata kaydını sil
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [errorId]
 *             properties:
 *               errorId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Silindi }
 *       400: { description: Tambur kararı verilmiş kayıt silinemez }
 *       401: { description: Yetkisiz }
 *       404: { description: Kayıt bulunamadı }
 *       500: { description: Sunucu hatası }
 */
// `mobile:tambur` — Tambur ekranı da işlenmemiş hata kaydını siliyor
// (`tamburService.deleteError` bilerek BU ucu kullanıyor; ayrı bir tambur ucu
// yok). 2026-08-17'ye kadar guard'da yoktu → Tambur operatörü sessiz 403.
router.delete(
  "/error",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:kk2-kursun", "mobile:tambur"),
  controller.deleteError
);

/**
 * @openapi
 * /api/kursun-qc/finish-step:
 *   post:
 *     tags: [KursunQc]
 *     summary: PROCESS_QC adımını kapat ve açık rolleri sonraki adıma taşı
 *     description: |
 *       Tüm açık rollerin QC2_COMPLETED işareti olmalı. Aksi halde 400 döner.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stepId]
 *             properties:
 *               stepId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Adım kapatıldı }
 *       400: { description: QC2 tamamlanmamış toplar var }
 *       401: { description: Yetkisiz }
 *       404: { description: Adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/finish-step",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:kk2-kursun"),
  controller.finishStep
);

/**
 * @openapi
 * /api/kursun-qc/reopen-step:
 *   post:
 *     tags: [KursunQc]
 *     summary: Yanlışlıkla kapatılan PROCESS_QC adımını yeniden aç
 *     description: |
 *       Geliştirme aşaması yardımcı endpoint'i — operatör adımı yanlışlıkla
 *       kapattığında kartı tekrar okutup devam edebilsin diye. Yalnızca roller
 *       hâlâ sonraki adımda bekliyorsa (ileri taşınmamışsa) çalışır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stepId]
 *             properties:
 *               stepId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Adım yeniden açıldı }
 *       400: { description: Adım kapalı değil veya toplar ileri taşınmış }
 *       401: { description: Yetkisiz }
 *       404: { description: Adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.post(
  "/reopen-step",
  verifyToken,
  requireAnyPermission("quality:write", "mobile:kk2-kursun"),
  controller.reopenStep
);

/**
 * @openapi
 * /api/kursun-qc/reopen-preview/{stepId}:
 *   get:
 *     tags: [KursunQc]
 *     summary: reopen-step öncesi salt-okunur önizleme (hangi toplar geri çekilecek)
 *     description: |
 *       Kapalı bir kart okutulduğunda operatöre onay göstermek için. Hiçbir şeyi
 *       değiştirmez; reopen güvenlik kontrollerini uygular, engel varsa
 *       canReopen=false + sebep döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Önizleme (canReopen + rolls) }
 *       400: { description: Adım PROCESS_QC tipinde değil }
 *       404: { description: Adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
router.get(
  "/reopen-preview/:stepId",
  verifyToken,
  requireAnyPermission("quality:read", "mobile:kk2-kursun"),
  controller.reopenPreview
);

// =============================================================================
// KURŞUN KUYRUĞU — Planlama (Electron) ekranı için
// =============================================================================

/**
 * @openapi
 * /api/kursun-qc/queue:
 *   get:
 *     tags: [KursunQc]
 *     summary: Tüm açık PROCESS_QC adımlarındaki bekleyen rollerin birleşik kuyruğu
 *     description: |
 *       Planlama drag-drop sayfası ve tablet operatörü tarafından okunur.
 *       Sıra: önce acil (isUrgent desc, urgentMarkedAt asc), sonra priority asc, sonra startedAt asc.
 *
 *       Her satırda `bypassAssigned` (bool) + `bypassMachineName` (atanan fiziksel
 *       kurşun makinesinin adı, dağıtılmamışsa null) gelir. Bu alanlar
 *       BİLGİLENDİRMEDİR: liste makine bazında GRUPLANMAZ — Kurşun Sırası ekranı
 *       `production.kursunBypassEnabled` açıkken zaten gizlenir (sırayı okuyan
 *       tablet kalmaz); alanların amacı karışık rejimde hangi işin dağıtıldığını
 *       ayırt etmektir. Makine bazlı izleme/gruplama Kurşun Dağıtım ucundadır
 *       (`GET /api/kursun-bypass/distribution`).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kuyruk listesi }
 *       500: { description: Sunucu hatası }
 */
// Yetki: kalite/tablet okuyucularına EK OLARAK kurşun dağıtımcısı. Planlamacı
// `quality:read` almadan kuyruğu izleyebilmeli — dağıtım ekranı bu kuyruğun
// üzerine kuruluyor ve "kurşunu izleyen kişi = kaliteci" varsayımı bu fabrikada
// artık geçerli değil (kurşun istasyonunda tablet YOK).
router.get(
  "/queue",
  verifyToken,
  requireAnyPermission(
    "quality:read",
    "mobile:kk2-kursun",
    "workorder:distribute",
    "mobile:kursun-dagitim",
  ),
  controller.listQueue,
);

/**
 * @openapi
 * /api/kursun-qc/queue/reorder:
 *   patch:
 *     tags: [KursunQc]
 *     summary: Kuyruktaki rollerin önceliklerini batch güncelle
 *     description: |
 *       Drag-drop sonrası planlama yeni sırayı (yüksek priority = yukarıda)
 *       gönderir. Yalnızca açık (status != COMPLETED) PROCESS_QC adımları güncellenir.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, priority]
 *                   properties:
 *                     id:       { type: string, format: uuid, description: WorkOrderStep.id }
 *                     priority: { type: integer, minimum: 0 }
 *     responses:
 *       200: { description: Güncellenen kayıt sayısı }
 *       400: { description: Geçersiz gövde }
 *       401: { description: Yetkisiz }
 *       500: { description: Sunucu hatası }
 */
// Yetki 2026-08-05'te GENİŞLEDİ — `urgent` ucuyla aynı kümeye getirildi.
// Eskiden DAR'dı (`quality:write`) ve gerekçesi "priority TABLET akışının çalışma
// sırasıdır, dağıtımcının sıralayacak bir şeyi yok" idi. O gerekçe Kurşun Sırası
// ile Kurşun Dağıtım ekranları BİRLEŞTİĞİNDE düştü: sıralama artık dağıtımcının
// kendi çalışma sırası (hangi işi önce hangi makineye vereceği) ve bekleyen liste
// ile dağıtım listesi AYNI listedir. Dar bırakmak, birleşik ekranda kullanamayacağı
// bir sürükleme kolu gösterip 403 aldırmak olurdu.
//
// Sıralama bir PLANLAMA kararıdır, kalite kararı değil — `urgent` ucu bu ayrımı
// 2026-08-01'de zaten yapmıştı; iki uç şimdi aynı üç izni kabul ediyor.
router.patch(
  "/queue/reorder",
  verifyToken,
  requireAnyPermission(
    "quality:write",
    "workorder:distribute",
    "mobile:kursun-dagitim",
  ),
  controller.reorderQueue,
);

/**
 * @openapi
 * /api/kursun-qc/queue/{stepId}/urgent:
 *   patch:
 *     tags: [KursunQc]
 *     summary: Kurşun kuyruğunda bir WO'nun (WorkOrderStep) "acil" rozetini aç/kapat
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isUrgent]
 *             properties:
 *               isUrgent: { type: boolean }
 *     responses:
 *       200: { description: Güncel kayıt }
 *       400: { description: Adım PROCESS_QC değil veya tamamlanmış }
 *       401: { description: Yetkisiz }
 *       404: { description: Adım bulunamadı }
 *       500: { description: Sunucu hatası }
 */
// Yetki: "acil" bir PLANLAMA kararıdır, kalite kararı değil — dağıtımcı
// (`workorder:distribute` / mobil ikizi) kuyruğu izlerken doğrudan
// işaretleyebilmeli. Yazma ucu olduğu için `quality:read` yeterli DEĞİL.
router.patch(
  "/queue/:stepId/urgent",
  verifyToken,
  requireAnyPermission(
    "quality:write",
    "workorder:distribute",
    "mobile:kursun-dagitim",
  ),
  controller.setQueueUrgent,
);

export default router;
