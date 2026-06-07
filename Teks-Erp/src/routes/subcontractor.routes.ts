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
 *               dyehouseNote: { type: string, description: "Boyahaneye özel talimat (sevk notundan ayrı)" }
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
 * /api/subcontractor/dispatches/{id}/dyehouse-note:
 *   patch:
 *     tags: [Subcontractor]
 *     summary: Sevkin boyahane notunu güncelle
 *     description: |
 *       Boyahane notu (dyehouseNote) snapshot'a dondurulmayan canlı kolondur;
 *       sevk fişi yazdırılmadan önce talimat eklenebilir/düzeltilebilir. Boş
 *       gönderilirse not temizlenir. İptal edilmiş sevkte düzenlenemez.
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
 *               dyehouseNote: { type: string, nullable: true, maxLength: 1000 }
 *     responses:
 *       200: { description: Boyahane notu güncellendi }
 *       404: { description: Sevk bulunamadı }
 *       409: { description: İptal edilmiş sevk }
 */
router.patch(
  "/dispatches/:id/dyehouse-note",
  verifyToken,
  requireAnyPermission("workorder:write", "mobile:fason-sevk"),
  controller.updateDyehouseNote
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
 * /api/subcontractor/pending-returns:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fasonda bekleyen sevkler (özet — rolls dahil değil)
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
 * /api/subcontractor/dispatches/{id}/print:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason sevk belgesi yazdırma snapshot'ı
 *     description: Sevk fişi belgesi için gerekli tüm verileri döner (toplar, WO, firma, totaller).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Snapshot verisi }
 *       404: { description: Sevk belgesi bulunamadı }
 */
router.get(
  "/dispatches/:id/print",
  verifyToken,
  requireAnyPermission("workorder:read", ...MOBILE_FASON_READ),
  controller.getDispatchPrint
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
 *       cancelledAt/By/Reason set edilir. Bu kabul'deki rulalar
 *       AT_SUBCONTRACTOR'a geri döner; "renk veren" kategoriden geldiyse
 *       Roll.colorId ve WO.targetProperties listesindeki RollProperty
 *       silinir. Sonraki adımda iz (kapalı movement, RollOperation, yeni
 *       fason sevki) varsa REDDEDİLİR.
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
 * @swagger
 * /api/subcontractor/receipts/{id}/cancel-preview:
 *   get:
 *     tags: [Subcontractor]
 *     summary: Fason kabul iptal önizlemesi
 *     description: |
 *       Receipt'ten türeyen "açık kumaş" Roll'larını ve her birinin downstream
 *       durumunu (operasyon/movement/tambur split/başka dispatch) listeler.
 *       Frontend, allSafe=true ise cascade iptal onayı sunar; false ise hangi
 *       roll'lar üzerinde işlem yapıldığını gösterip iptali engeller.
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
