// =============================================================================
// TeksERP - Printed Document Routes (resmi belge defteri)
// =============================================================================
// İzinler docType'a göre kaynak modülün izinlerine eşlenir: belgeyi görme =
// modülün okuma izni; revizyon = modülün YAZMA izni (web; mobilde revizyon yok).

import { Router, Request, Response, NextFunction } from "express";
import { PrintedDocumentController } from "../controllers/printed-document.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";

const controller = new PrintedDocumentController();
const router = Router();

// docType → izin eşlemesi (kaynak modüllerin route'larıyla aynı kodlar).
const DOC_PERMISSIONS: Record<string, { read: string[]; write: string[] }> = {
  SHIPMENT_DISPATCH: {
    read: ["shipping:read", "shipping:write", "mobile:tarti-paket", "mobile:sevkiyat"],
    write: ["shipping:write"],
  },
  SUBCONTRACTOR_DISPATCH: {
    // mobile:hizli-is-emri — hızlı iş emri sevkinde çeki listesini basabilsin.
    read: [
      "workorder:read",
      "workorder:write",
      "mobile:fason-sevk",
      "mobile:fason-kabul",
      "mobile:hizli-is-emri",
    ],
    write: ["workorder:write"],
  },
  SUBCONTRACTOR_DIRECT_SHIP: {
    read: ["workorder:read", "workorder:write", "mobile:fason-sevk", "mobile:fason-kabul"],
    write: ["workorder:write"],
  },
  KARTELA_DISPATCH: {
    read: ["kartela:read", "kartela:write", "mobile:kartela-sevk", "mobile:kartela-kabul"],
    write: ["kartela:write"],
  },
};

/** docType path paramına göre ilgili modülün izinlerini uygular. */
function requireDocPermission(kind: "read" | "write") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const entry = DOC_PERMISSIONS[req.params.docType as string];
    if (!entry) {
      next(AppError.badRequest(`Bilinmeyen belge tipi: ${req.params.docType}`));
      return;
    }
    requireAnyPermission(...entry[kind])(req, res, next);
  };
}

/**
 * @openapi
 * /api/printed-documents/{docType}/sample-html:
 *   post:
 *     tags: [PrintedDocuments]
 *     summary: Belge Şablonu canlı önizlemesi — örnek veri + taslak config ile gerçek HTML
 *     description: |
 *       "Tanımlar → Belge Şablonları" panelinde admin içerik ayarını düzenlerken
 *       gördüğü önizleme. Gerçek renderHtml örnek veriyle + gönderilen taslak
 *       config ile çağrılır (TASLAK filigranlı) → önizleme baskıyla birebir aynı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: docType
 *         required: true
 *         schema: { type: string, enum: [SHIPMENT_DISPATCH, SUBCONTRACTOR_DISPATCH, SUBCONTRACTOR_DIRECT_SHIP, KARTELA_DISPATCH] }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               config: { type: object, nullable: true }
 *     responses:
 *       200: { description: text/html önizleme çıktısı }
 */
router.post(
  "/:docType/sample-html",
  verifyToken,
  requireAnyPermission("admin:settings"),
  controller.getSampleHtml
);

/**
 * @openapi
 * /api/printed-documents/{docType}/{sourceId}/current:
 *   get:
 *     tags: [PrintedDocuments]
 *     summary: Güncel belge (en yüksek versiyon; yoksa lazy-init dener, uygun değilse null=TASLAK)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: docType
 *         required: true
 *         schema: { type: string, enum: [SHIPMENT_DISPATCH, SUBCONTRACTOR_DISPATCH, SUBCONTRACTOR_DIRECT_SHIP, KARTELA_DISPATCH] }
 *       - in: path
 *         name: sourceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Belge (snapshot dahil) ya da data:null (taslak aşaması) }
 */
router.get(
  "/:docType/:sourceId/current",
  verifyToken,
  requireDocPermission("read"),
  controller.getCurrent
);

/**
 * @openapi
 * /api/printed-documents/{docType}/{sourceId}/html:
 *   get:
 *     tags: [PrintedDocuments]
 *     summary: Baskı-hazır HTML (TEK KAYNAK) — mobil + Electron aynısını basar
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: docType
 *         required: true
 *         schema: { type: string, enum: [SHIPMENT_DISPATCH, SUBCONTRACTOR_DISPATCH, SUBCONTRACTOR_DIRECT_SHIP, KARTELA_DISPATCH] }
 *       - in: path
 *         name: sourceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: text/html baskı çıktısı }
 *       409: { description: Kaynak henüz taslak (donmuş belge yok) }
 */
router.get(
  "/:docType/:sourceId/html",
  verifyToken,
  requireDocPermission("read"),
  controller.getHtml
);

/**
 * @openapi
 * /api/printed-documents/{docType}/{sourceId}/versions:
 *   get:
 *     tags: [PrintedDocuments]
 *     summary: Versiyon geçmişi (snapshot içeriği olmadan — hafif liste)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Versiyon listesi (yeniden eskiye) }
 */
router.get(
  "/:docType/:sourceId/versions",
  verifyToken,
  requireDocPermission("read"),
  controller.listVersions
);

/**
 * @openapi
 * /api/printed-documents/{docType}/{sourceId}/versions/{version}:
 *   get:
 *     tags: [PrintedDocuments]
 *     summary: Tek versiyonu snapshot'ıyla getir (eski versiyonu görüntüleme)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Belge versiyonu }
 *       404: { description: Versiyon bulunamadı }
 */
router.get(
  "/:docType/:sourceId/versions/:version",
  verifyToken,
  requireDocPermission("read"),
  controller.getVersion
);

/**
 * @openapi
 * /api/printed-documents/{docType}/{sourceId}/reissue:
 *   post:
 *     tags: [PrintedDocuments]
 *     summary: Gerekçeli revizyon — aktif belge SUPERSEDED, güncel veriden yeni versiyon donar
 *     security: [{ bearerAuth: [] }]
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
 *       201: { description: Yeni versiyon oluşturuldu }
 *       409: { description: VOIDED belge revize edilemez / durum çakışması }
 */
router.post(
  "/:docType/:sourceId/reissue",
  verifyToken,
  requireDocPermission("write"),
  controller.reissue
);

export default router;
