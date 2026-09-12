// =============================================================================
// TeksERP - Subcontractor (Fason) Routes
// =============================================================================

import { Router } from "express";
import { SubcontractorController } from "../controllers/subcontractor.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const MOBILE_FASON_READ = ["mobile:fason-sevk", "mobile:fason-kabul"] as const;

const controller = new SubcontractorController();
const router = Router();

/**
 * @openapi
 * /api/subcontractor/dispatch:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fasona sevk (Dispatch)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workOrderId, stepId, subcontractorId, rollIds]
 *             properties:
 *               workOrderId:     { type: string, format: uuid }
 *               stepId:          { type: string, format: uuid }
 *               subcontractorId: { type: string, format: uuid }
 *               rollIds:         { type: array, items: { type: string, format: uuid } }
 *               plateNumber:  { type: string }
 *               driverName:   { type: string }
 *               notes:        { type: string, description: "Genel sevk/nakliye notu" }
 *               instruction:  { type: string, description: "Fason talimatı (sevk notundan ayrı; boşsa adımın notu)" }
 *     responses:
 *       201: { description: Sevk belgesi oluşturuldu }
 */
router.post(
  "/dispatch",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-sevk"),
  controller.dispatch
);

/**
 * @openapi
 * /api/subcontractor/dispatch/bulk:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Masaüstü toplu fason sevki (top okutmadan)
 *     description: |
 *       Planlama ekranı için. Bir EXTERNAL adımda BEKLEYEN (status IN_PRODUCTION/STOCK,
 *       currentStepId=stepId) tüm topları planlanan/seçilen firmaya toplu sevk eder.
 *       Gerçek dispatch() yoluna delege eder → irsaliye + AT_SUBCONTRACTOR + audit.
 *       Sadece masaüstü (mobil saha zaten Fason Sevk kullanır).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workOrderId, stepId]
 *             properties:
 *               workOrderId:     { type: string, format: uuid }
 *               stepId:          { type: string, format: uuid }
 *               subcontractorId: { type: string, format: uuid, description: "Yoksa adımın plannedSubcontractorId'si" }
 *               instruction:     { type: string }
 *               plateNumber:     { type: string }
 *               driverName:      { type: string }
 *     responses:
 *       201: { description: Sevk belgesi oluşturuldu }
 *       400: { description: Fason adım değil / bekleyen top yok / firma planlanmamış }
 */
router.post(
  "/dispatch/bulk",
  verifyToken,
  requireAnyPermission("workorder:write", "subcontractor:write"),
  controller.bulkDispatch
);

/**
 * @openapi
 * /api/subcontractor/transfer-next:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fasondan fasona doğrudan aktarım (zımpara→boyahane, fabrikaya uğramadan)
 *     description: |
 *       Mevcut fason adımda fasonda (AT_SUBCONTRACTOR) bekleyen topları, içerideki
 *       "kabul + bir sonraki fasona sevk" zinciriyle tek tıkla aktarır. Metraj 1:1
 *       taşınır (kesin ölçüm boyahane dönüşünde). Sonraki adım EXTERNAL değilse
 *       reddeder (normal Fason Kabul kullanılmalı). Sadece masaüstü.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workOrderId, stepId]
 *             properties:
 *               workOrderId:         { type: string, format: uuid }
 *               stepId:              { type: string, format: uuid, description: "Mevcut (kaynak) fason adım" }
 *               nextSubcontractorId: { type: string, format: uuid, description: "Yoksa sonraki adımın plannedSubcontractorId'si" }
 *               instruction:         { type: string }
 *     responses:
 *       201: { description: Aktarıldı (kabul + sonraki fasona sevk) }
 *       400: { description: Fason adım değil / sonraki adım fason değil / aktarılacak top yok }
 */
router.post(
  "/transfer-next",
  verifyToken,
  requireAnyPermission("workorder:write", "subcontractor:write"),
  controller.transferToNextFason
);

/**
 * @openapi
 * /api/subcontractor/fason-ceki-draft:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Erken TASLAK fason çeki (sevkten önce, durum değiştirmez)
 *     description: |
 *       Bir sonraki fason adımı için (boyahane), önceki fasonda (zımpara)
 *       AT_SUBCONTRACTOR bekleyen topları projekte ederek TASLAK filigranlı çeki
 *       HTML'i döndürür. Hiçbir kayıt/stok/durum değiştirmez (read-only). Mal
 *       fabrikaya uğramadan fasondan fasona gidecekse boyahane çekisini erken basmak için.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: workOrderId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: "{ html } — TASLAK çeki" }
 *       400: { description: Fason adım değil / firma planlanmamış / önceki fasonda mal yok }
 */
router.get(
  "/fason-ceki-draft",
  verifyToken,
  requireAnyPermission("workorder:read", "subcontractor:read"),
  controller.fasonCekiDraft
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/instruction:
 *   patch:
 *     tags: [Subcontractor]
 *     summary: Sevkin fason talimatını güncelle
 *     description: |
 *       Fason talimatı (instruction) snapshot'a dondurulmayan canlı kolondur;
 *       sevk fişi yazdırılmadan önce talimat eklenebilir/düzeltilebilir. Boş
 *       gönderilirse talimat temizlenir. İptal edilmiş sevkte düzenlenemez.
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
 *             properties:
 *               instruction: { type: string, nullable: true, maxLength: 1000 }
 *     responses:
 *       200: { description: Fason talimatı güncellendi }
 *       404: { description: Sevk bulunamadı }
 *       409: { description: İptal edilmiş sevk }
 */
router.patch(
  "/dispatches/:id/instruction",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-sevk"),
  controller.updateInstruction
);

/**
 * @openapi
 * /api/subcontractor/receive:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason mal kabul — orijinal Roll'ları SUBCONTRACTOR_CONSUMED'a çeker
 *     description: |
 *       Boyahane gibi açık kumaş döndüren fasonlar için: orijinal toplar terminal'e
 *       (`SUBCONTRACTOR_CONSUMED`) çekilir; yeni Roll burada AÇILMAZ. Receipt'e
 *       `appliedColorId` + `appliedPropertyIds` yazılır — Kurşun/KK2'de operatör
 *       açık kumaş Roll oluşturduğunda bu kimliği inherit eder.
 *
 *       `appliedColorId` verilmezse fason kategorisi `appliesColor=true` ise
 *       WO.targetColor otomatik; değilse null. `appliedPropertyIds` verilmezse
 *       `appliesProperty=true` ise WO.targetProperties otomatik; değilse [].
 *
 *       Bu adımın tüm outstanding'i consumed olunca step COMPLETED. Sonraki step
 *       PENDING kalır (Roll yok); Kurşun/KK2'de ilk açık kumaş açıldığında ACTIVE.
 *
 *       KISMİ KABUL (2026-08-19): `returns[].receivedQty` kalanın altındaysa top
 *       tüketilmez — AT_SUBCONTRACTOR kalır, currentQty kalana iner; kalan ikinci
 *       teslimatla (yeni makbuz) ya da `close-remainder` ile kapanır. Aynı sevkin
 *       ikinci+ teslimatında doğan toplar YENİ parti numarası alır. `clientToken`
 *       idempotency anahtarıdır (kısmi teslimatta replay'in tek kimliği).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workOrderId, stepId, subcontractorId, returns]
 *             properties:
 *               workOrderId:        { type: string, format: uuid }
 *               stepId:             { type: string, format: uuid }
 *               subcontractorId:    { type: string, format: uuid }
 *               manifestNo:         { type: string, nullable: true, description: "Fason firma irsaliye no (opsiyonel)" }
 *               notes:              { type: string }
 *               appliedColorId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: Receipt seviyesinde uygulanan renk (UI override; verilmezse appliesColor=true kategoride WO.targetColor otomatik)
 *               appliedPropertyIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Receipt seviyesinde uygulanan özellikler (UI override; verilmezse appliesProperty=true kategoride WO.targetProperties otomatik)
 *               returns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [rollId]
 *                   properties:
 *                     rollId: { type: string, format: uuid }
 *                     notes:  { type: string, nullable: true, description: "Bu topa dair kabul notu" }
 *                     receivedQty: { type: number, nullable: true, description: "KISMİ kabul: bu teslimatta gelen metraj (verilmez/kalanı aşarsa TAM kabul)" }
 *               clientToken: { type: string, format: uuid, nullable: true, description: "İdempotency anahtarı (retry'da aynı token)" }
 *               newRolls:
 *                 type: array
 *                 description: |
 *                   Opsiyonel — fasondan gelen açık kumaş parçaları. Verilirse
 *                   Receipt anında yeni open-fabric Roll'lar otomatik doğar ve
 *                   rotadaki bir sonraki adıma (fason veya internal) bağlanır.
 *                   Verilmezse Kurşun/KK2 operatörü manuel `open-fabric` çağırır.
 *                 items:
 *                   type: object
 *                   required: [qty]
 *                   properties:
 *                     qty:      { type: number, description: Açık kumaş metresi }
 *                     weightKg: { type: number, nullable: true }
 *                     notes:    { type: string, nullable: true }
 *     responses:
 *       201: { description: Mal kabul oluşturuldu (orijinal Roll'lar consumed) }
 *       400: { description: Validasyon hatası / top bu adımda fason'da değil }
 *       401: { description: Yetkisiz }
 *       404: { description: İş emri/adım bulunamadı }
 */
router.post(
  "/receive",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-kabul"),
  controller.receive
);

/**
 * @openapi
 * /api/subcontractor/close-remainder:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fasonda kalan metrajı "gelmeyecek" kararıyla kapat (fire)
 *     description: |
 *       Kısmi teslimat sonrası fasonda bekleyen kalan (ya da hiç dönmemiş top)
 *       fire kararıyla kapatılır: top SUBCONTRACTOR_CONSUMED olur, kalan metraj
 *       sapma defterine (RollVariance SCRAP, source=SUBCONTRACTOR_REMAINDER)
 *       yazılır, açık sevk kalemi remainderClosedAt ile damgalanır. Sebep
 *       ZORUNLU — fire kataloğundan (ReasonPreset ROLL_SCRAP; "Diğer" → açıklama).
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stepId, rollId, reasonCode]
 *             properties:
 *               stepId:     { type: string, format: uuid }
 *               rollId:     { type: string, format: uuid }
 *               reasonCode: { type: string, maxLength: 64 }
 *               reasonText: { type: string, nullable: true, maxLength: 500 }
 *     responses:
 *       200: { description: Kalan kapatıldı, fire deftere yazıldı }
 *       400: { description: Validasyon / geçersiz sebep / adım fason değil }
 *       409: { description: Top bu adımda fasonda beklemiyor / eşzamanlı işlem }
 */
router.post(
  "/close-remainder",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-kabul"),
  controller.closeRemainder
);

/**
 * @openapi
 * /api/subcontractor/reopen-remainder:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Kalan-gelmeyecek kararını geri al (fire kaydı terslenir)
 *     description: |
 *       close-remainder topu SUBCONTRACTOR_CONSUMED yapar ve o andan sonra o
 *       kabulün iptali 409 verir. Geri alma yolu olmadan yanlış girilen bir metraj
 *       KALICI oluyordu (defterde sahte fire + sahte üretim; düzeltmenin tek yolu
 *       DB müdahalesi). Bu uç topu AT_SUBCONTRACTOR'a döndürür, sevk kaleminin
 *       remainderClosedAt damgasını kaldırır, movement'ı yeniden açar ve sapma
 *       satırını SİLMEZ - reversedAt ile işaretler (append-only defter).
 *
 *       Kapı topun GEÇMİŞİNDEN kurulur, durumundan değil: bu adımda o topun
 *       kapama damgalı sevk kalemi yoksa 409 REMAINDER_NOT_CLOSED_AT_STEP (tam
 *       kabulle tüketilmiş top ya da başka adımın stepId'si bu yoldan fasona
 *       diriltilemez); doğrudan müşteriye sevk edilmiş top 409 ROLL_DIRECT_SHIPPED;
 *       topun durumu uygun değilse 409 REMAINDER_NOT_CLOSED; eşzamanlı geri almada
 *       409 REMAINDER_ALREADY_REOPENED. Geri alma iş emrini ve refakat kartını da
 *       diriltir (COMPLETED → IN_PROGRESS / ACTIVE).
 *     responses ek: 409 kodları details.code altında döner.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stepId, rollId]
 *             properties:
 *               stepId: { type: string, format: uuid }
 *               rollId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Kapama geri alındı, top yeniden fasonda }
 *       409: { description: Kalan kapatılmamış / eşzamanlı işlem }
 */
router.post(
  "/reopen-remainder",
  verifyToken,
  // Düzeltme yetkisi: fason yazma ya da elle stok düzeltme. YENİ İZİN KODU YOK
  // (sahada atanması unutulabilecek bir adım daha eklemeye değmez — 2026-08-01 dersi).
  requireAnyPermission("workorder:write", "roll:manual-adjust", "mobile:fason-kabul"),
  controller.reopenRemainder
);

/**
 * @openapi
 * /api/subcontractor/pending-returns:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fasonda bekleyen sevkler (özet — rolls dahil değil)
 *     description: |
 *       `rollCount`/`totalQty` yalnız AT_SUBCONTRACTOR topları sayar (kabul akışı).
 *       `awaitingDispatch=true` olan satırlar fason adımında DURAN ama henüz
 *       fasona ÇIKMAMIŞ topları işaret eder (konum düzeltmesi sonrası) —
 *       kabul akışına girmez, yalnız "sevk bekliyor" rozetiyle görünür;
 *       adedi `awaitingDispatchRollCount` alanındadır.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bekleyen sevk gruplari (rollCount+totalQty aggregate) }
 */
router.get(
  "/pending-returns",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.pendingReturns
);

router.get(
  "/pending-returns/step/:stepId",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.pendingReturnDetail
);

router.get(
  "/dispatches",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.listDispatches
);

router.get(
  "/dispatches/:id",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.getDispatch
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/dye-overlay:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason sevk irsaliyesinin canlı talimat alanları (istenen renk + fason talimatı)
 *     description: Donmuş içerik PrintedDocument'te; burada yalnız kasten canlı tutulan talimat alanları döner.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: requestedColor + instruction + stepNote + instructionLocked }
 *       404: { description: Sevk belgesi bulunamadı }
 */
router.get(
  "/dispatches/:id/dye-overlay",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.getDispatchDyeOverlay
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/cancel:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason sevkini iptal et (soft cancel)
 *     description: |
 *       Sevk silinmez, cancelledAt/cancelledById/cancelReason set edilir.
 *       Toplar STOCK'a geri döner (currentStepId temizlenir). Mal kabul yapılmış
 *       sevk iptal edilemez.
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
 *     responses:
 *       200: { description: Sevk iptal edildi }
 *       400: { description: Geçersiz sebep }
 *       404: { description: Sevk bulunamadı }
 *       409: { description: Zaten iptal edilmiş veya mal kabul yapılmış }
 */
router.post(
  "/dispatches/:id/cancel",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-sevk"),
  controller.cancelDispatch
);

/**
 * @openapi
 * /api/subcontractor/dispatches/cancel-bulk:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Birden çok fason sevkini tek çağrıda iptal et
 *     description: |
 *       Tekil iptalin aynısını her sevk için ayrı transaction'da koşar. SONUÇ
 *       PARÇALIDIR: iptal edilemeyen sevkler `failed[]` içinde somut sebebiyle
 *       döner (hepsi-ya-hiç DEĞİL). İş emrini iptal etmeden önce fasondaki malı
 *       tek onayla içeri almak için.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dispatchIds, reason]
 *             properties:
 *               dispatchIds:
 *                 type: array
 *                 maxItems: 50
 *                 items: { type: string, format: uuid }
 *               reason: { type: string, minLength: 3, maxLength: 500 }
 *     responses:
 *       200: { description: "Sonuç (parçalı olabilir): cancelled, cancelledNos, failed[]" }
 *       400: { description: Geçersiz sebep / boş liste / sınır aşıldı }
 */
router.post(
  "/dispatches/cancel-bulk",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-sevk"),
  controller.cancelDispatchBulk
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/direct-ship-preview:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fasondan doğrudan sevk önizlemesi (salt-okunur — etkilenecek toplar/adımlar + aday siparişler)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Önizleme }
 *       404: { description: Sevk bulunamadı }
 */
router.get(
  "/dispatches/:id/direct-ship-preview",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-sevk"),
  controller.getDirectShipPreview
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/direct-ship:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fasondan doğrudan sevk (fason son durak — mal dönmeden sevk; WO kapanır)
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
 *               orderLineAllocations:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     orderLineId: { type: string, format: uuid }
 *                     qty: { type: number }
 *     responses:
 *       200: { description: Doğrudan sevk edildi }
 *       400: { description: Geçersiz istek }
 *       404: { description: Sevk bulunamadı }
 *       409: { description: İptal/kabul edilmiş veya toplar değişmiş }
 */
router.post(
  "/dispatches/:id/direct-ship",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-sevk"),
  controller.directShip
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/undo-transfer-preview:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason→fason aktarımı geri alma önizlemesi (salt-okunur — born toplar + kaynak kabuller + güvenlik)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Önizleme }
 *       404: { description: Sevk bulunamadı }
 */
router.get(
  "/dispatches/:id/undo-transfer-preview",
  verifyToken,
  requireAnyPermission("workorder:write", "subcontractor:write"),
  controller.getUndoTransferPreview
);

/**
 * @openapi
 * /api/subcontractor/dispatches/{id}/undo-transfer:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason→fason aktarımı geri al (boyahane sevki + kaynak kabul iptal → mal kaynak fasona döner)
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
 *     responses:
 *       200: { description: Aktarım geri alındı }
 *       400: { description: Aktarım çıktısı değil / geçersiz istek }
 *       404: { description: Sevk bulunamadı }
 *       409: { description: Toplar işlenmiş veya değişmiş — geri alınamaz }
 */
router.post(
  "/dispatches/:id/undo-transfer",
  verifyToken,
  requireAnyPermission("workorder:write", "subcontractor:write"),
  controller.undoTransfer
);

router.get(
  "/receipts",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.listReceipts
);

router.get(
  "/receipts/:id/print",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.getReceiptPrint
);

router.get(
  "/receipts/:id",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.getReceipt
);

/**
 * @openapi
 * /api/subcontractor/receipts/{id}/cancel:
 *   post:
 *     tags: [Subcontractor]
 *     summary: Fason kabulü iptal et (soft cancel)
 *     description: |
 *       Mal kabul yanlış girilmişse geri alır. Kabul belgesi silinmez,
 *       cancelledAt/By/Reason set edilir. Kabulde SUBCONTRACTOR_CONSUMED'a
 *       çekilen ORİJİNAL rulolar AT_SUBCONTRACTOR'a geri döner; kabulde DOĞAN
 *       açık-kumaş Roll'lar (parentReceiptId) CANCELLED'e çekilir ve receipt'e
 *       yazılan renk/özellik (KartelaReceiptItem property) kayıtları silinir.
 *       Sonraki adımda iz (kapalı movement, RollOperation, yeni fason sevki)
 *       varsa REDDEDİLİR.
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
 *     responses:
 *       200: { description: Kabul iptal edildi, rulolar geri çekildi }
 *       400: { description: Geçersiz sebep veya kabul boş }
 *       404: { description: Kabul belgesi bulunamadı }
 *       409: { description: Zaten iptal edilmiş veya sonraki adımda iz var }
 */
router.post(
  "/receipts/:id/cancel",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-kabul"),
  controller.cancelReceipt
);

/**
 * @openapi
 * /api/subcontractor/receipts/{id}/cancel-preview:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason kabul iptal önizlemesi
 *     description: |
 *       Receipt'ten türeyen "açık kumaş" Roll'larını ve her birinin downstream
 *       durumunu (operasyon/movement/tambur split/başka dispatch) listeler.
 *       Ayrıca K14 parti-tutarlılık engelini (`batchMismatch`) döner — iptal
 *       tx'indeki guard ile AYNI yardımcıdan gelir, aynı metni basar.
 *       Frontend, allSafe=true ise cascade iptal onayı sunar; false ise hangi
 *       roll'lar üzerinde işlem yapıldığını / hangi partilerin birleştirilmesi
 *       gerektiğini gösterip iptali engeller.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Önizleme verisi }
 *       404: { description: Kabul belgesi bulunamadı }
 *       409: { description: Zaten iptal edilmiş veya WO COMPLETED }
 */
router.get(
  "/receipts/:id/cancel-preview",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-kabul"),
  controller.getCancelPreview
);

export default router;
