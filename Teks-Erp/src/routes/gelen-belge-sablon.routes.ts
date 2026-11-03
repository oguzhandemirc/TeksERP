// =============================================================================
// Gelen belge KULLANICI ŞABLONU + BELGE TİPİ TANITMA uçları (S1) — `gelen-belge.routes.ts` içine `router.use` ile
// bağlanır: kimlik + modül kapısı + gövde katmanı üst router'dan miras (kapı sırası orada).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import { createUserTemplate, getUserTemplate, listUserTemplates, updateUserTemplate } from "../services/gelen-belge-ozel-sablon.service";
import { getScanWords, suggestFromScan } from "../services/gelen-belge-tanitma.service";

const router = Router();

type Handler = (req: Request) => Promise<{ status: number; data: unknown }>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json({ success: true, data: out.data });
  } catch (err) {
    next(err);
  }
};
const Id = z.uuid("Geçersiz kimlik");
const UserCode = z.string().regex(/^u-[a-z0-9][a-z0-9-]{0,61}$/, "Geçersiz kullanıcı şablonu kodu");
const Name = z.string().trim().min(2, "Şablon adı en az 2 karakter").max(80, "Şablon adı en çok 80 karakter");
const TemplateJson = z.record(z.string(), z.unknown());
const Rect = z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() });

const CreateBody = z.strictObject({ name: Name, template: TemplateJson, clientToken: Id.optional() });
const UpdateBody = z.strictObject({ expectedVersion: z.number().int().min(1).max(32000), template: TemplateJson, name: Name.optional() });
const SuggestBody = z.strictObject({
  scanId: Id,
  name: Name,
  assignments: z.array(z.strictObject({
    field: z.enum(["musteri", "partiNo", "toplamMetre", "evrakNo", "tarih", "siparisNo", "topAdet", "desen", "renk", "en"]),
    rect: Rect,
    section: z.boolean().optional(),
  })).min(1, "En az bir alan atayın").max(30),
  identifiers: z.array(z.string().trim().min(2).max(60)).min(1, "En az bir kimlik yazısı seçin").max(12),
  table: z.strictObject({
    columns: z.array(z.strictObject({ key: z.enum(["topNo", "kg", "m", "en"]), header: z.string().trim().min(1).max(40) })).min(1).max(8),
    totalsLabel: z.string().trim().max(40).nullable().optional(),
  }).optional(),
  sectionStartLabel: z.string().trim().max(40).nullable().optional(),
});

/**
 * @openapi
 * /api/gelen-belge/sablonlar/ozel:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Kullanıcı şablonları (u-…; panelde tanıtılan belge tipleri) — salt okunur
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "UserTemplateView[]" }
 *       403: { description: "MODULE_DISABLED ya da izin yok" }
 *   post:
 *     tags: [Gelen belge]
 *     summary: Kullanıcı şablonu oluştur (kod addan u-<slug>; v1 + sürüm satırı; clientToken replay)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "UserTemplateView" }
 *       400: { description: "USER_TEMPLATE_INVALID · USER_TEMPLATE_TOO_LARGE · doğrulama" }
 *       409: { description: "USER_TEMPLATE_CODE_TAKEN · CLIENT_TOKEN_COLLISION" }
 * /api/gelen-belge/sablonlar/ozel/{code}:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Kullanıcı şablonu + sürüm geçmişi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "UserTemplateView + versions[]" }
 *       404: { description: "USER_TEMPLATE_NOT_FOUND" }
 *   put:
 *     tags: [Gelen belge]
 *     summary: Kullanıcı şablonunu güncelle (sürüm+1; eski belgeler eski sürümde kalır). Pasife alma PATCH /sablonlar/{code}
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "UserTemplateView" }
 *       400: { description: "USER_TEMPLATE_INVALID · USER_TEMPLATE_FILE_READONLY" }
 *       404: { description: "USER_TEMPLATE_NOT_FOUND" }
 *       409: { description: "USER_TEMPLATE_VERSION_CHANGED (beklenen sürüm eski)" }
 * /api/gelen-belge/sablonlar/oneri:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Belge tipi tanıtma — kutu→alan atamaları + kimlik yazılarından anchor stratejili şablon önerisi ve aynı taramada önizleme (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ template, explain[], errors[], preview { matched, score, fields, blocks, lineCount, warnings } | null }" }
 *       404: { description: "DOCUMENT_SCAN_NOT_FOUND" }
 *       409: { description: "DOCUMENT_SCAN_NOT_READ" }
 * /api/gelen-belge/taramalar/{id}/kelimeler:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Taramanın OCR kelime kutuları (rect = OCR çerçevesi, photoRect = saklanan fotoğraf çerçevesi)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ imageWidth, imageHeight, rotation, words[] }" }
 *       404: { description: "DOCUMENT_SCAN_NOT_FOUND" }
 *       409: { description: "DOCUMENT_SCAN_NOT_READ" }
 */
router.get("/sablonlar/ozel", requirePermission("gelen-belge:template"), wrap(async () => ({ status: 200, data: await listUserTemplates() })));
router.post("/sablonlar/ozel", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 201, data: await createUserTemplate(CreateBody.parse(req.body), req.user!.userId) })));
router.get("/sablonlar/ozel/:code", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await getUserTemplate(UserCode.parse(req.params.code)) })));
router.put("/sablonlar/ozel/:code", requirePermission("gelen-belge:template"), wrap(async (req) => ({
  status: 200, data: await updateUserTemplate(UserCode.parse(req.params.code), UpdateBody.parse(req.body), req.user!.userId),
})));
router.post("/sablonlar/oneri", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await suggestFromScan(SuggestBody.parse(req.body)) })));
router.get("/taramalar/:id/kelimeler", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await getScanWords(Id.parse(req.params.id)) })));

export default router;
