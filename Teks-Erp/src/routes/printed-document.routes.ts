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
// EXPORT: `scripts/test_workorder_documents.ts` bunu okuyup belge LİSTESİ izniyle
// BASKI iznini karşılaştırır — ayrışırlarsa operatör satırı görür, basamaz ve
// hiçbir yerde sebep görünmez (sessiz 403).
export const DOC_PERMISSIONS: Record<string, { read: string[]; write: string[] }> = {
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
    // mobile:hizli-is-emri — `GET /work-orders/:id/documents` bu belgeyi listeler;
    // listede GÖRÜNÜP basılamayan belge sessiz bir 403 kapanıdır (operatör satıra
    // basar, hiçbir şey olmaz). Liste izniyle baskı izni HİZALI tutulmalı.
    read: [
      "workorder:read",
      "workorder:write",
      "mobile:fason-sevk",
      "mobile:fason-kabul",
      "mobile:hizli-is-emri",
    ],
    write: ["workorder:write"],
  },
  KARTELA_DISPATCH: {
    read: ["kartela:read", "kartela:write", "mobile:kartela-sevk", "mobile:kartela-kabul"],
    write: ["kartela:write"],
  },
  // Fason kabul makbuzu — fason okuma/yazma + mobil fason kabul.
  // mobile:hizli-is-emri: yukarıdaki DIRECT_SHIP ile aynı gerekçe (liste ↔ baskı hizası).
  SUBCONTRACTOR_RECEIPT: {
    read: [
      "workorder:read",
      "workorder:write",
      "mobile:fason-kabul",
      "mobile:fason-sevk",
      "mobile:hizli-is-emri",
      "subcontractor:read",
    ],
    write: ["workorder:write"],
  },
  // Sevkiyat-türevli belge (kalite sertifikası) — sevkiyat izinleri.
  QUALITY_CERTIFICATE: {
    read: ["shipping:read", "shipping:write", "mobile:sevkiyat", "report:quality"],
    write: ["shipping:write"],
  },
  // İade irsaliyesi — iade okuma/yazma.
  RETURN_DISPATCH: {
    read: ["return:read", "return:write", "mobile:iade"],
    write: ["return:write"],
  },
  // ── Ticaret paketi: iç depo belgeleri (2026-08-13) ────────────────────────
  // Liste izniyle BASKI izni hizalı tutulur: belgeyi ekranda görüp basamamak
  // sessiz bir 403 kapanıdır (operatör satıra basar, hiçbir şey olmaz).
  TRANSFER_DISPATCH: {
    read: ["warehouse:transfer", "warehouse:read", "warehouse:write"],
    write: ["warehouse:transfer"],
  },
  GOODS_RECEIPT: {
    read: ["goods-receipt:read", "goods-receipt:write"],
    write: ["goods-receipt:write"],
  },
  // Ön muhasebe çıktıları (2026-08-14). READ, WRITE'ı KAPSAR — yazabilen okur.
  // ⚠️ Revizyon (write) `finance:invoice`/`finance:payment` ister, `finance:write`
  // DEĞİL: taslak kurabilen kişi resmi belgeyi revize edememeli — o, deftere
  // işlemiş bir kaydın kâğıdını değiştirmektir.
  INVOICE_INTERNAL: {
    read:  ["finance:read", "finance:write", "finance:invoice"],
    write: ["finance:invoice"],
  },
  PAYMENT_RECEIPT: {
    read:  ["finance:read", "finance:write", "finance:payment"],
    write: ["finance:payment"],
  },
  // Resmi ön muhasebe belgeleri (2026-08-15, J2 #18). READ, WRITE'ı KAPSAR.
  // ⚠️ Revizyon (write) burada `finance:write`tir — fatura/makbuzdaki
  // `finance:invoice`/`finance:payment` DEĞİL. Gerekçe simetrik: orada belge
  // deftere İŞLEMİŞ bir kaydın kâğıdıdır (revize eden kişi o kaydı doğuran
  // yetkiye sahip olmalı); burada belge hiçbir deftere yazmayan bir OKUMANIN
  // kâğıdıdır ve onu düzenleyen izin `finance:write`tir. Kaynak uçlarla
  // (`POST /reconciliation-letters`, `POST /cheque-delivery-notes`) HİZALI —
  // ayrışırsa kullanıcı belgeyi doğurabilir ama revize edemez.
  // ⚠️ `report:finance` READ'e eklendi: muhasebe raporlarını okuyan kişi (cari
  // ekstre / yaşlandırma) mutabakat mektubunu da açabilmeli; o izin zaten aynı
  // tutar bilgisini gösteriyor, yeni bir şey sızmaz.
  RECONCILIATION_LETTER: {
    read:  ["finance:read", "finance:write", "report:finance"],
    write: ["finance:write"],
  },
  CHEQUE_DELIVERY_NOTE: {
    read:  ["finance:read", "finance:write", "finance:cheque", "report:finance"],
    write: ["finance:write"],
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
 *       - in: query
 *         name: currentTemplate
 *         required: false
 *         description: "1 → içerik donuk kalır, görünüm (şablon+künye) güncel ayardan çözülür"
 *         schema: { type: string, enum: ["1", "true"] }
 *       - in: query
 *         name: sections
 *         required: false
 *         description: "Tek seferlik liste seçimi (CSV). Sevk irsaliyesi: urun,cuval,ceki. Kalıcı bölüm ayarını EZER, hiçbir yere yazılmaz. Boş/geçersiz → kalıcı ayar geçerli."
 *         schema: { type: string, example: "cuval,ceki" }
 *       - in: query
 *         name: merge
 *         required: false
 *         description: "1 → listeler aynı sayfada akar. Varsayılan: her liste kendi sayfasından başlar."
 *         schema: { type: string, enum: ["1", "true"] }
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
