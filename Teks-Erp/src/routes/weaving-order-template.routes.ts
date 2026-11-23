// =============================================================================
// TeksERP — ÖZEL DOKUMA İŞ EMRİ ŞABLONLARI · /api/weaving-order-templates · dokuma modülü
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` → izin. Yeni izin kodu yok: okuma
// `weavingorder:read`, yazma `weavingorder:write` (şablon dokuma iş emri formunu ön-doldurur).
// Gövde allowlist'i serviste (Zod `.strict()`). Sil = pasife al.
// =============================================================================
import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { WeavingOrderTemplateService } from "../services/weaving-order-template.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";

export const weavingOrderTemplateService = new WeavingOrderTemplateService({
  modelName: "weavingOrderTemplate",
  tableName: "WEAVING_ORDER_TEMPLATE",
  // `?search=` yok: katlanmış gölge kolonu yok ve seçici tüm etkin şablonları tek seferde çizer.
  defaultInclude: {
    item: { select: { id: true, code: true, name: true } },
    subcontractor: { select: { id: true, code: true, name: true } },
  },
  // Ad tekilliği aranmaz (katlanmış ad gölgesi yok): şablon bir kısayoldur, kimlik değil.
  entityLabel: "dokuma şablonu",
});

const controller = new BaseController(weavingOrderTemplateService);
const router = Router();
router.use(verifyToken, requireDokumaEnabled);
const read = requirePermission("weavingorder:read");
const write = requirePermission("weavingorder:write");

/**
 * @openapi
 * /api/weaving-order-templates:
 *   get:
 *     tags: [WeavingOrderTemplates]
 *     summary: Özel dokuma iş emri şablonları ("Dokuma İş Emri oluştur" › Özel)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: filter[isActive]
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, example: "sortOrder:asc" }
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *   post:
 *     tags: [WeavingOrderTemplates]
 *     summary: Şablon oluştur — allowlist (name · description · itemId · executionKind · subcontractorId · plannedM · notes · sortOrder)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Tanınmayan alan · kumaş olmayan kart · pasif fasoncu · içeride + fasoncu (WEAVING_TEMPLATE_PARTY_XOR) }
 */
router.get("/", read, controller.findAll);
router.post("/", write, controller.create);

/**
 * @openapi
 * /api/weaving-order-templates/{id}:
 *   get:
 *     tags: [WeavingOrderTemplates]
 *     summary: Şablon detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 *   patch:
 *     tags: [WeavingOrderTemplates]
 *     summary: Şablonu güncelle ya da etkinleştir (iş emirleri etkilenmez — şablon yalnız ön-dolgudur)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Tanınmayan alan ya da geçersiz referans }
 *   delete:
 *     tags: [WeavingOrderTemplates]
 *     summary: Şablonu pasife al (silme yok)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.get("/:id", read, controller.findById);
router.patch("/:id", write, controller.update);
router.delete("/:id", write, controller.remove);

export default router;
