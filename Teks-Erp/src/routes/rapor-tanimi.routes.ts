// =============================================================================
// /api/rapor-tanimlari — kayıtlı/özel raporlar (Raporlar v2, R1-KAYIT; plan §3.2–3.4, §4.3)
// =============================================================================
// Kapı: kimlik + HERHANGİ bir rapor izni. Görme/çalıştırma yeni izin istemez (görünürlük + blok
// izinleri derleyicide); oluşturma/düzenleme `report:builder`; kategori yazımı `report:publish`
// (herkese açma servis kuralı). Sabit yollar (`/kategoriler`, `/dogrula`, `/anlik-goruntuler`)
// `/:id`den ÖNCE tanımlıdır. Gövdeler strict Zod; tanım gövdesi `rapor-tanimi.schema.ts`ten.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { REPORT_BUILDER_PERMISSION, REPORT_PERMISSION_CODES, REPORT_PUBLISH_PERMISSION } from "../constants/permission-catalog";
import { loadAccessContext } from "../services/reports/semantik/izin";
import { checkReportDefinition } from "../services/reports/semantik/rapor-tanimi.schema";
import { runParamsSchema } from "../services/reports/semantik/definition-run";
import * as definitions from "../services/rapor-tanimi.service";
import * as runs from "../services/rapor-kosu.service";
import * as versions from "../services/rapor-surum.service";
import * as shares from "../services/rapor-paylasim.service";
import * as categories from "../services/rapor-kategori.service";
import * as presets from "../services/rapor-on-ayar.service";
import * as snapshots from "../services/rapor-snapshot.service";

const router = Router();
router.use(verifyToken, requireAnyPermission(...REPORT_PERMISSION_CODES));

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (h: Handler) => (req: Request, res: Response, next: NextFunction) => {
  h(req, res).catch(next);
};
const actor = (req: Request): definitions.Actor => ({ userId: req.user!.userId, permissions: req.user!.permissions });
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const id = (req: Request, name = "id") => assertValidUuid(req.params[name], name);

const name = z.string().trim().min(1).max(150);
const listQuery = z
  .object({
    kapsam: z.enum(definitions.LIST_SCOPES).default("tumu"),
    kategoriId: z.string().uuid().optional(),
    durum: z.enum(definitions.DEFINITION_STATUSES).optional(),
    ara: z.string().max(100).optional(),
    /** Sistem raporunun katalog anahtarı (`sales/siparis-talep`) — temel rapor sayfası kendi tanımını (ön ayarlar) bulur. */
    anahtar: z.string().regex(/^[a-z]+\/[a-z0-9-]+$/, "Geçersiz rapor anahtarı").max(64).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const createBody = z
  .object({
    ad: name.optional(),
    aciklama: z.string().trim().max(1000).nullable().optional(),
    kategoriId: z.string().uuid().optional(),
    durum: z.enum(["TASLAK", "YAYINDA"]).default("TASLAK"),
    govde: z.unknown(),
    clientToken: z.string().uuid().optional(),
  })
  .strict();
const metaBody = z
  .object({ ad: name.optional(), aciklama: z.string().trim().max(1000).nullable().optional(), kategoriId: z.string().uuid().optional() })
  .strict();
const statusBody = z.object({ beklenen: z.enum(definitions.DEFINITION_STATUSES), hedef: z.enum(definitions.DEFINITION_STATUSES) }).strict();
const versionBody = z
  .object({ govde: z.unknown(), beklenenSurumId: z.string().uuid(), not: z.string().trim().max(500).nullable().optional(), clientToken: z.string().uuid().nullable().optional() })
  .strict();
const shareBody = z
  .object({
    gorunurluk: z.enum(definitions.VISIBILITIES),
    paylasimlar: z.array(z.object({ kullaniciId: z.string().uuid(), yetki: z.enum(["GOR", "DUZENLE"]) }).strict()).max(200),
  })
  .strict();
const runBody = z.object({ parametreler: runParamsSchema, yenile: z.boolean().default(false) }).strict();
const previewBody = z.object({ govde: z.unknown(), parametreler: runParamsSchema }).strict();
const presetBody = z
  .object({ ad: z.string().trim().min(1).max(100), parametreler: z.record(z.string(), z.unknown()), paylasimli: z.boolean().default(false), varsayilan: z.boolean().default(false) })
  .strict();
const snapshotBody = z.object({ parametreler: runParamsSchema, clientToken: z.string().uuid().optional() }).strict();
const categoryBody = z.object({ ad: z.string().trim().min(1).max(100), ustId: z.string().uuid().nullable().optional(), sira: z.number().int().min(0).max(10_000).optional() }).strict();
const pageQuery = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

// ── Paylaşım adayları ────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/rapor-tanimlari/paylasim-adaylari:
 *   get:
 *     tags: [Reports]
 *     summary: Paylaşım diyaloğu için etkin kullanıcılar (yalnız kimlik + ad; report:builder)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: ara, required: false, schema: { type: string, maxLength: 80 } }
 *     responses:
 *       200: { description: "Kullanıcı listesi (en çok 200)" }
 */
router.get("/paylasim-adaylari", requirePermission(REPORT_BUILDER_PERMISSION), wrap(async (req, res) => {
  const ara = z.string().trim().max(80).optional().parse(typeof req.query.ara === "string" ? req.query.ara : undefined);
  return ok(res, await shares.listShareCandidates(actor(req), ara));
}));

// ── Kategoriler ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/rapor-tanimlari/kategoriler:
 *   get:
 *     tags: [Reports]
 *     summary: Rapor kategorileri (en çok iki seviye)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Kategori listesi" }
 *   post:
 *     tags: [Reports]
 *     summary: Yeni rapor kategorisi (report:publish)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "Oluşturuldu" }
 */
router.get("/kategoriler", wrap(async (req, res) => ok(res, await categories.listCategories(req.query.pasifler === "1"))));
router.post("/kategoriler", requirePermission(REPORT_PUBLISH_PERMISSION), wrap(async (req, res) => ok(res, await categories.createCategory(categoryBody.parse(req.body), req.user!.userId), 201)));

/**
 * @openapi
 * /api/rapor-tanimlari/kategoriler/{id}:
 *   patch:
 *     tags: [Reports]
 *     summary: Kategori adı / üstü / sırası (report:publish; sistem kategorisi değişmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Güncellendi" }
 */
router.patch("/kategoriler/:id", requirePermission(REPORT_PUBLISH_PERMISSION), wrap(async (req, res) => ok(res, await categories.updateCategory(id(req), categoryBody.partial().strict().parse(req.body), req.user!.userId))));

/**
 * @openapi
 * /api/rapor-tanimlari/kategoriler/{id}/pasif:
 *   post:
 *     tags: [Reports]
 *     summary: Boş kategoriyi pasife al (report:publish)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Pasife alındı" }
 *       409: { description: "Kategori boş değil" }
 */
router.post("/kategoriler/:id/pasif", requirePermission(REPORT_PUBLISH_PERMISSION), wrap(async (req, res) => ok(res, await categories.deactivateCategory(id(req), req.user!.userId))));

// ── Doğrulama, önizleme, anlık görüntü ──────────────────────────────────────

/**
 * @openapi
 * /api/rapor-tanimlari/dogrula:
 *   post:
 *     tags: [Reports]
 *     summary: Rapor tanımı gövdesini doğrula (Türkçe hata + JSON yolu + öneri)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ gecerli, hatalar[] }" }
 */
router.post("/dogrula", wrap(async (req, res) => {
  const check = checkReportDefinition(z.object({ govde: z.unknown() }).strict().parse(req.body).govde);
  return ok(res, check.gecerli ? { gecerli: true, hatalar: [], gerekenIzinler: check.gerekenIzinler } : check);
}));

/**
 * @openapi
 * /api/rapor-tanimlari/onizle:
 *   post:
 *     tags: [Reports]
 *     summary: Kaydedilmemiş tanımı çalıştır (report:builder)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Blok sonuçları" }
 */
router.post("/onizle", requirePermission(REPORT_BUILDER_PERMISSION), wrap(async (req, res) => {
  const input = previewBody.parse(req.body);
  return ok(res, await runs.previewBody(input.govde, { parametreler: input.parametreler, yenile: false }, await loadAccessContext(req.user!)));
}));

/**
 * @openapi
 * /api/rapor-tanimlari/anlik-goruntuler/{id}:
 *   get:
 *     tags: [Reports]
 *     summary: Anlık görüntüyü aç (yalnız alan kişi)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Saklanan sonuç + itibarıyla zamanı" }
 */
router.get("/anlik-goruntuler/:id", wrap(async (req, res) => ok(res, await snapshots.getSnapshot(id(req), actor(req)))));

// ── Tanımlar ─────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/rapor-tanimlari:
 *   get:
 *     tags: [Reports]
 *     summary: Görünür rapor tanımları (liste + cursor + özet)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: anahtar, required: false, schema: { type: string }, description: "Sistem raporunun katalog anahtarı (ön ayar/varyant kaydı için tanımı bulur)" }
 *     responses:
 *       200: { description: "items, nextCursor, ozet" }
 *   post:
 *     tags: [Reports]
 *     summary: Özel rapor oluştur (report:builder; clientToken'lı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "Oluşturuldu" }
 *       400: { description: "RAPOR_TANIMI_BOZUK — hatalar[] JSON yoluyla" }
 */
router.get("/", wrap(async (req, res) => ok(res, await definitions.listDefinitions(listQuery.parse(req.query), actor(req)))));
router.post("/", requirePermission(REPORT_BUILDER_PERMISSION), wrap(async (req, res) => ok(res, await definitions.createDefinition(createBody.parse(req.body), actor(req)), 201)));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}:
 *   get:
 *     tags: [Reports]
 *     summary: Tanım + yürürlükteki gövde
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Tanım" }
 *       404: { description: "Yok ya da görünmüyor" }
 *   patch:
 *     tags: [Reports]
 *     summary: Ad / açıklama / kategori (report:builder)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Güncellendi" }
 *   delete:
 *     tags: [Reports]
 *     summary: Raporu arşive kaldır (durum geçişi; satır silinmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Arşivde" }
 */
router.get("/:id", wrap(async (req, res) => ok(res, await definitions.getDefinition(id(req), actor(req)))));
router.patch("/:id", requirePermission(REPORT_BUILDER_PERMISSION), wrap(async (req, res) => ok(res, await definitions.updateMeta(id(req), metaBody.parse(req.body), actor(req)))));
router.delete("/:id", wrap(async (req, res) => {
  const row = await definitions.loadVisible(id(req), actor(req));
  return ok(res, await definitions.changeStatus(row.id, row.status as definitions.DefinitionStatus, "ARSIV", actor(req)));
}));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/durum:
 *   post:
 *     tags: [Reports]
 *     summary: Durum geçişi TASLAK → YAYINDA → ARSIV (atomik; beklenen durum değiştiyse 409)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Yeni durum" }
 *       409: { description: "RAPOR_DURUM_CAKISMASI" }
 */
router.post("/:id/durum", wrap(async (req, res) => {
  const b = statusBody.parse(req.body);
  return ok(res, await definitions.changeStatus(id(req), b.beklenen, b.hedef, actor(req)));
}));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/calistir:
 *   post:
 *     tags: [Reports]
 *     summary: Kayıtlı raporu çalıştır (bloklar sırayla; izinsiz blok "yetkisiz" döner)
 *     description: "`yenile: true` önbelleği atlar (yeni hâlini al). Bozuk tanım 400 RAPOR_TANIMI_BOZUK."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Blok sonuçları + itibarıyla zamanı" }
 */
router.post("/:id/calistir", wrap(async (req, res) => {
  const input = runBody.parse(req.body);
  return ok(res, await runs.runDefinition(id(req), input, await loadAccessContext(req.user!), actor(req)));
}));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/surumler:
 *   get:
 *     tags: [Reports]
 *     summary: Değişmez sürümler (yeniden eskiye)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Sürüm listesi" }
 *   post:
 *     tags: [Reports]
 *     summary: Yeni sürüm kaydet (report:builder; beklenenSurumId yürürlükte değilse 409 RAPOR_SURUM_CAKISMASI)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [govde, beklenenSurumId]
 *             properties:
 *               govde: { type: object, description: "Rapor tanımı gövdesi" }
 *               beklenenSurumId: { type: string, format: uuid }
 *               not: { type: string, nullable: true }
 *               clientToken: { type: string, format: uuid, nullable: true, description: "İdempotency — aynı token aynı sürümü döndürür" }
 *     responses:
 *       201: { description: "Yeni sürüm" }
 *       409: { description: "RAPOR_SURUM_CAKISMASI" }
 */
router.get("/:id/surumler", wrap(async (req, res) => ok(res, await versions.listVersions(id(req), actor(req)))));
router.post("/:id/surumler", requirePermission(REPORT_BUILDER_PERMISSION), wrap(async (req, res) => ok(res, await versions.saveNewVersion(id(req), versionBody.parse(req.body), actor(req)), 201)));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/surumler/{surumId}:
 *   get:
 *     tags: [Reports]
 *     summary: Sürüm gövdesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: surumId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Sürüm" }
 *   delete:
 *     tags: [Reports]
 *     summary: Sürüm silinmez — her zaman 409 RAPOR_SURUMU_DEGISMEZ
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: surumId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       409: { description: "RAPOR_SURUMU_DEGISMEZ" }
 */
router.get("/:id/surumler/:surumId", wrap(async (req, res) => ok(res, await versions.getVersion(id(req), id(req, "surumId"), actor(req)))));
router.delete("/:id/surumler/:surumId", wrap(async (req, res) => versions.refuseVersionRemoval(id(req), id(req, "surumId"), actor(req))));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/paylasim:
 *   get:
 *     tags: [Reports]
 *     summary: Görünürlük + paylaşılan kullanıcılar
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Paylaşım" }
 *   put:
 *     tags: [Reports]
 *     summary: Paylaşımı TÜMÜYLE değiştir (sahip ya da report:publish; HERKES yalnız report:publish)
 *     description: Paylaşım görünürlük verir, veri yetkisi vermez.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Yeni paylaşım" }
 */
router.get("/:id/paylasim", wrap(async (req, res) => ok(res, await shares.listShares(id(req), actor(req)))));
router.put("/:id/paylasim", wrap(async (req, res) => ok(res, await shares.replaceShares(id(req), shareBody.parse(req.body), actor(req)))));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/on-ayarlar:
 *   get:
 *     tags: [Reports]
 *     summary: Ön ayarlar (kendi + paylaşımlı)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Ön ayar listesi" }
 *   post:
 *     tags: [Reports]
 *     summary: Ön ayar kaydet (kullanıcı × rapor başına tek varsayılan)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: "Oluşturuldu" }
 *       409: { description: "RAPOR_ON_AYAR_VARSAYILAN_CAKISMASI" }
 */
router.get("/:id/on-ayarlar", wrap(async (req, res) => ok(res, await presets.listPresets(id(req), actor(req)))));
router.post("/:id/on-ayarlar", wrap(async (req, res) => ok(res, await presets.createPreset(id(req), presetBody.parse(req.body), actor(req)), 201)));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/on-ayarlar/{onAyarId}:
 *   patch:
 *     tags: [Reports]
 *     summary: Ön ayarı değiştir (yalnız sahibi; varsayilan:false varsayılanı kaldırır)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: onAyarId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "Güncellendi" }
 */
router.patch("/:id/on-ayarlar/:onAyarId", wrap(async (req, res) => ok(res, await presets.updatePreset(id(req), id(req, "onAyarId"), presetBody.partial().strict().parse(req.body), actor(req)))));

/**
 * @openapi
 * /api/rapor-tanimlari/{id}/anlik-goruntu:
 *   post:
 *     tags: [Reports]
 *     summary: Bu hâlini sakla — sunucuda koşulan sonucun anlık görüntüsü (clientToken'lı)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: "Görüntü özeti" }
 *   get:
 *     tags: [Reports]
 *     summary: Bu rapordaki kendi anlık görüntülerim
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "items, nextCursor" }
 */
router.post("/:id/anlik-goruntu", wrap(async (req, res) => {
  const input = snapshotBody.parse(req.body);
  return ok(res, await snapshots.takeSnapshot(id(req), input, await loadAccessContext(req.user!), actor(req)), 201);
}));
router.get("/:id/anlik-goruntu", wrap(async (req, res) => {
  const q = pageQuery.parse(req.query);
  return ok(res, await snapshots.listSnapshots(id(req), actor(req), q.cursor, q.limit));
}));

export default router;
