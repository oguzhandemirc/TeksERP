// =============================================================================
// TeksERP - Belge şablon tasarımcısı uçları (/api/document-templates) — plan §3.10
// =============================================================================
// Okuma: DOCUMENT_DESIGN_READ · tasarım: DOCUMENT_TEMPLATE_DESIGN · yayın: DOCUMENT_TEMPLATE_PUBLISH
// (constants/document-design.ts; `admin:settings` emniyet supabı). Bayrak kapısı
// (`DOCUMENT_DESIGNER_DISABLED`) T1C'de bağlanır.

import { Router, type NextFunction, type Request, type Response } from "express";
import { DOCUMENT_DESIGN_READ, DOCUMENT_TEMPLATE_DESIGN, DOCUMENT_TEMPLATE_PUBLISH } from "../constants/document-design";
import { documentTemplateController as c } from "../controllers/document-template.controller";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import "../types/express-augment";
import { readDocumentDesignerEnabled } from "../services/system-setting.service";
import { AppError } from "../utils/app-error";
import { settingRowPath } from "../constants/panel-ayar-yolu";

const router = Router();
router.use(verifyToken);

// Tasarımcı kapısı (P-c): bayrak kapalıyken yalnız sözleşme okuması açık; editör "kapalı"
// ekranını çizer, diğer her uç 403 — kapalı bayrakla şablon/atama yazılamaz.
router.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.method === "GET" && /^\/contracts(\/|$)/.test(req.path)) return next();
  readDocumentDesignerEnabled()
    .then((on) =>
      next(on ? undefined : AppError.forbidden(`Belge tasarımcısı kapalı. ${settingRowPath("documentDesignerEnabled")} ayarından açılabilir.`, { code: "DOCUMENT_DESIGNER_DISABLED" })),
    )
    .catch(next);
});

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => {
  h(req, res).catch(next);
};

/**
 * @openapi
 * /api/document-templates/contracts:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Belge veri sözleşmeleri (tür listesi, sistemden kopyalanabilir mi)"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/contracts", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.listContracts));

/**
 * @openapi
 * /api/document-templates/contracts/{docType}:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Tek sözleşme: kök alanlar, tablolar, ayar şeması, iç alanlar, örnek adları"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/contracts/:docType", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.getContract));

/**
 * @openapi
 * /api/document-templates/system/{docType}:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Sistem tasarımının Liquid eşleniği + kopyada dondurulacak ayar (P-d)"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/system/:docType", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.getSystem));

/**
 * @openapi
 * /api/document-templates/assignments:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Tür varsayılanları + profil atamaları + etkilenen müşteri/fasoncu listesi"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/assignments", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.listAssignments));

/**
 * @openapi
 * /api/document-templates/defaults/{docType}:
 *   put:
 *     tags: [DocumentTemplates]
 *     summary: "Tür varsayılan şablonunu ata ya da kaldır (templateId null)"
 *     security: [{ bearerAuth: [] }]
 */
router.put("/defaults/:docType", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.setDefault));

/**
 * @openapi
 * /api/document-templates/profiles/{profileId}/{docType}:
 *   put:
 *     tags: [DocumentTemplates]
 *     summary: "Müşteri/fasoncu profiline şablon ata ya da kaldır (templateId null)"
 *     security: [{ bearerAuth: [] }]
 */
router.put("/profiles/:profileId/:docType", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.setProfile));

/**
 * @openapi
 * /api/document-templates/preview:
 *   post:
 *     tags: [DocumentTemplates]
 *     summary: "Kaydedilmemiş kaynağın önizlemesi (örnek senaryo ya da gerçek kayıt — kayıtta belge okuma izni de aranır)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/preview", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.preview));

/**
 * @openapi
 * /api/document-templates/sistem-onizleme/{docType}:
 *   post:
 *     tags: [DocumentTemplates]
 *     summary: "Sistem (yerleşik) tasarımın örnek veriyle önizlemesi — yazmaz; bilinmeyen tür 400, yerleşik çıktısı olmayan tür 409 NO_SYSTEM_PREVIEW"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/sistem-onizleme/:docType", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.systemPreview));

/**
 * @openapi
 * /api/document-templates/sample-sources/{docType}:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Önizlemede seçilebilir basılı belgeler (belge okuma izni de aranır)"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/sample-sources/:docType", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.sampleSources));

/**
 * @openapi
 * /api/document-templates:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Şablon listesi (?docType=&status=)"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.list));

/**
 * @openapi
 * /api/document-templates:
 *   post:
 *     tags: [DocumentTemplates]
 *     summary: "Yeni şablon (copyFrom system|template|blank; clientToken ile idempotent)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.create));

/**
 * @openapi
 * /api/document-templates/{id}:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Şablon detayı + yayındaki sürüm"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.get));

/**
 * @openapi
 * /api/document-templates/{id}:
 *   patch:
 *     tags: [DocumentTemplates]
 *     summary: "Şablon adı/açıklaması"
 *     security: [{ bearerAuth: [] }]
 */
router.patch("/:id", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.patch));

/**
 * @openapi
 * /api/document-templates/{id}/versions:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Sürüm listesi (yeniden eskiye)"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id/versions", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.listVersions));

/**
 * @openapi
 * /api/document-templates/{id}/versions/{vid}:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Tek sürüm (kaynak, CSS, ayar dahil)"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id/versions/:vid", requireAnyPermission(...DOCUMENT_DESIGN_READ), wrap(c.getVersion));

/**
 * @openapi
 * /api/document-templates/{id}/versions:
 *   post:
 *     tags: [DocumentTemplates]
 *     summary: "Yeni değişmez sürüm (baseVersionId bayatsa 409 TEMPLATE_VERSION_STALE; içerik aynıysa sürüm açılmaz)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/versions", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.saveVersion));

/**
 * @openapi
 * /api/document-templates/{id}/publish:
 *   post:
 *     tags: [DocumentTemplates]
 *     summary: "Sürümü yayınla (tüm örneklerle katı render; expectedPublishedVersionId farklıysa 409)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/publish", requireAnyPermission(...DOCUMENT_TEMPLATE_PUBLISH), wrap(c.publish));

/**
 * @openapi
 * /api/document-templates/{id}/archive:
 *   post:
 *     tags: [DocumentTemplates]
 *     summary: "Şablonu arşivle (atanmışsa 409 TEMPLATE_ASSIGNED + liste)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/archive", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.archive));

/**
 * @openapi
 * /api/document-templates/{id}/unarchive:
 *   post:
 *     tags: [DocumentTemplates]
 *     summary: "Şablonu arşivden çıkar"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/unarchive", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.unarchive));

/**
 * @openapi
 * /api/document-templates/{id}/delete-preview:
 *   get:
 *     tags: [DocumentTemplates]
 *     summary: "Silme önizlemesi: sürümler, atamalar, silinebilir mi"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id/delete-preview", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.deletePreview));

/**
 * @openapi
 * /api/document-templates/{id}:
 *   delete:
 *     tags: [DocumentTemplates]
 *     summary: "Hiç yayınlanmamış taslak şablonu sil (yayınlanmışsa 409 — arşivlenir)"
 *     security: [{ bearerAuth: [] }]
 */
router.delete("/:id", requireAnyPermission(...DOCUMENT_TEMPLATE_DESIGN), wrap(c.remove));

export default router;
