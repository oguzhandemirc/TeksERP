// =============================================================================
// Gelen belge KULLANICI ŞABLONU + BELGE TİPİ TANITMA uçları (S1) — `gelen-belge.routes.ts` içine `router.use` ile
// bağlanır: kimlik + modül kapısı + gövde katmanı üst router'dan miras (kapı sırası orada).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.middleware";
import { createUserTemplate, editUserTemplate, getUserTemplate, listUserTemplates, updateUserTemplate } from "../services/gelen-belge-ozel-sablon.service";
import { previewUserTemplateReset, resetUserTemplates } from "../services/gelen-belge-sablon-sifirla.service";
import { getScanWords, suggestFromScan } from "../services/gelen-belge-tanitma.service";
import { ASSIGNABLE_FIELD_KEYS, MAX_TEMPLATE_IDENTIFIERS, MULTI_PARTY_RULES, UPDATE_KEEP_PARTS, type MultiPartyRule } from "../lib/gelen-belge/motor";

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

// Alan anahtarı: atanabilir katalog + şablonda bulunabilecek eski anahtarlar (bilinmeyen anahtar serviste 400 olur).
const FieldKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, "Geçersiz alan anahtarı");
const Rules = z.strictObject({ multiParty: z.enum(MULTI_PARTY_RULES as [MultiPartyRule, ...MultiPartyRule[]]).nullable().optional() });

const CreateBody = z.strictObject({ name: Name, template: TemplateJson, clientToken: Id.optional() });
const UpdateBody = z.strictObject({ expectedVersion: z.number().int().min(1).max(32000), template: TemplateJson, name: Name.optional() });
const Identifier = z.string().trim().min(2).max(60);
const EditBody = z.strictObject({
  expectedVersion: z.number().int().min(1).max(32000),
  name: Name.optional(),
  identifiers: z.array(Identifier).min(1, "En az bir kimlik yazısı kalmalı").max(MAX_TEMPLATE_IDENTIFIERS, `En çok ${MAX_TEMPLATE_IDENTIFIERS} kimlik yazısı seçilebilir`).optional(),
  dropFields: z.array(FieldKey).min(1).max(60).optional(),
  // `multiParty: null` kuralı kaldırır (fabrika ayarına döner).
  rules: z.strictObject({ multiParty: z.enum(MULTI_PARTY_RULES as [MultiPartyRule, ...MultiPartyRule[]]).nullable() }).optional(),
});
const ResetPreviewQuery = z.strictObject({
  codes: z.string().trim().min(1, "En az bir kod verin").transform((v) => v.split(",").map((c) => c.trim()).filter(Boolean))
    .pipe(z.array(UserCode).min(1, "En az bir kod verin").max(100, "En çok 100 kod")),
});
const ResetBody = z.strictObject({
  items: z.array(z.strictObject({ code: UserCode, expectedVersion: z.number().int().min(1).max(32000) })).min(1, "En az bir belge tipi seçin").max(100, "En çok 100 belge tipi")
    .refine((xs) => new Set(xs.map((x) => x.code)).size === xs.length, "Aynı belge tipi iki kez seçilmiş"),
});
const SuggestBody = z.strictObject({
  scanId: Id,
  name: Name,
  assignments: z.array(z.strictObject({
    field: z.enum(ASSIGNABLE_FIELD_KEYS),
    rect: Rect,
    section: z.boolean().optional(),
  })).max(30),
  identifiers: z.array(Identifier).min(1, "En az bir kimlik yazısı seçin")
    .max(MAX_TEMPLATE_IDENTIFIERS, `En çok ${MAX_TEMPLATE_IDENTIFIERS} kimlik yazısı seçilebilir`),
  table: z.strictObject({
    columns: z.array(z.strictObject({ key: z.enum(["topNo", "kg", "m", "en"]), header: z.string().trim().min(1).max(40) })).min(1).max(8),
    totalsLabel: z.string().trim().max(40).nullable().optional(),
  }).optional(),
  sectionStartLabel: z.string().trim().max(40).nullable().optional(),
  // Güncelle kipi: önizleme bu kullanıcı şablonuyla birleşik koşar; `keep` = yeni öneride yoksa eskisinden taşınacak yapılar.
  // `drop`: eski tanımdan gelip bu sefer kaldırılan alanlar (2026-11-09); eski istemci göndermez → bugünkü davranış (korunur).
  base: z.strictObject({
    code: UserCode,
    keep: z.array(z.enum(UPDATE_KEEP_PARTS)).max(UPDATE_KEEP_PARTS.length),
    drop: z.array(FieldKey).max(ASSIGNABLE_FIELD_KEYS.length).optional(),
  }).optional(),
  // ③ Kurallar: yoksa fabrika ayarı (yeni tipte alan yazılmaz; güncellemede eski kural korunur, `null` kaldırır).
  rules: Rules.optional(),
// Güncellemede atanmayan eski alan aynen korunur → yeni atama şart değil; yeni tipte en az bir alan şart.
}).refine((b) => b.assignments.length > 0 || !!b.base, { path: ["assignments"], message: "En az bir alan atayın" });

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
 * /api/gelen-belge/sablonlar/ozel/sifirla-onizleme:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Belge tipi sıfırla ÖNİZLEMESİ (yazmaz) — şablon başına sürüm, okuma sayısı, belge durumları, açık taslaklar (≤50 + toplam), bağlı gönderen
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: codes, required: true, schema: { type: string }, description: "virgülle ayrılmış u-… kodları (1-100)" }
 *     responses:
 *       200: { description: "{ items: [{ code, name, version, isActive, hitCount, lastReadAt, notesByStatus, drafts[{ id, documentNo, senderDocNo, createdAt }], draftsTotal, sender }], failed: [{ code, reason: NOT_FOUND, message }] }" }
 *       400: { description: "doğrulama (geçersiz kod)" }
 * /api/gelen-belge/sablonlar/ozel/sifirla:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Belge tiplerini sıfırla = pasife al ("bu tipi unut"); kayıt başına atomik (code + expectedVersion + aktif), audit'li; eski belgeler değişmez; geri al PATCH /sablonlar/{code} isActive true
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ done: [{ code, version }], failed: [{ code, reason: NOT_FOUND | ALREADY_INACTIVE | VERSION_CHANGED, message }] }" }
 *       400: { description: "doğrulama (1-100 kayıt, tekil kod)" }
 * /api/gelen-belge/sablonlar/ozel/{code}/tanim:
 *   patch:
 *     tags: [Gelen belge]
 *     summary: Belge tipini fotoğrafsız düzenle — ad, kimlik yazıları, alan kaldır, kurallar (birleşim sunucuda; sürüm+1; kod değişmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "UserTemplateView + changes + warnings[] (değişiklik yoksa sürüm artmaz)" }
 *       400: { description: "USER_TEMPLATE_EDIT_INVALID (boş kimlik, olmayan alan) · USER_TEMPLATE_INVALID · doğrulama" }
 *       404: { description: "USER_TEMPLATE_NOT_FOUND" }
 *       409: { description: "USER_TEMPLATE_VERSION_CHANGED · USER_TEMPLATE_INACTIVE (sıfırlanmış tip)" }
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
 *       200: { description: "{ template, explain[], errors[], preview { matched, score, fields, blocks, lineCount, warnings } | null, benzerSablonlar: [{ kod, ad, skor }] (kimlik eşiğini geçen mevcut kullanıcı şablonları, güncellenen hariç, skor azalan) }" }
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
// Sabit yollar `/:code`dan ÖNCE (yoksa "sifirla-onizleme" kod sanılırdı).
router.get("/sablonlar/ozel/sifirla-onizleme", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await previewUserTemplateReset(ResetPreviewQuery.parse(req.query).codes) })));
router.post("/sablonlar/ozel/sifirla", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await resetUserTemplates(ResetBody.parse(req.body).items, req.user!.userId) })));
router.patch("/sablonlar/ozel/:code/tanim", requirePermission("gelen-belge:template"), wrap(async (req) => ({
  status: 200, data: await editUserTemplate(UserCode.parse(req.params.code), EditBody.parse(req.body), req.user!.userId),
})));
router.get("/sablonlar/ozel/:code", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await getUserTemplate(UserCode.parse(req.params.code)) })));
router.put("/sablonlar/ozel/:code", requirePermission("gelen-belge:template"), wrap(async (req) => ({
  status: 200, data: await updateUserTemplate(UserCode.parse(req.params.code), UpdateBody.parse(req.body), req.user!.userId),
})));
router.post("/sablonlar/oneri", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await suggestFromScan(SuggestBody.parse(req.body)) })));
router.get("/taramalar/:id/kelimeler", requirePermission("gelen-belge:template"), wrap(async (req) => ({ status: 200, data: await getScanWords(Id.parse(req.params.id)) })));

export default router;
