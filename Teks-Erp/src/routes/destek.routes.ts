// =============================================================================
// TeksERP - Etkili Destek talep uçları (`/api/etkili-destek`)
// =============================================================================
// Panel ve saha uygulaması → bu backend → destek merkezi. Uç sözleşmesi:
// `docs/ops/DESTEK-ENTEGRASYONU.md`. İzin kodu YOK: giriş yapmış her kullanıcı
// kendi taleplerini görür; firma geneli (`scope=tenant`) servis içinde
// `admin:settings`/sistem hesabıyla sınırlanır.
// Önek `/api/destek` DEĞİL: orası satıcıya giden eski destek talebinin (3d-2,
// `support.routes.ts`, `support:create` guard'ı her isteğe) yeridir; iki router aynı önekte çakışırdı.
//
// ⚠️ SIRA LOAD-BEARING: `/durum` destek kapısından ÖNCE tanımlanır (kapalıyken de
// `{ etkin: false }` dönmeli); diğer HER uç `router.use(requireSupportDeskEnabled)`
// satırından SONRA gelir.
// ⚠️ GÖVDE: global 1 MB JSON katmanı bu ön eki ATLAR (`BUYUK_GOVDE_YOLLARI`);
// gövdeyi yalnız ekli iki POST ucu kendi `SUPPORT_BODY_LIMIT` katmanıyla okur.
// =============================================================================

import express, { Request, Response, Router } from "express";
import { z } from "zod";
import { SUPPORT_BODY_LIMIT } from "../constants/body-limits";
import { readClientLabelHeaders } from "../constants/client-info";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireSupportDeskEnabled } from "../middlewares/destek.middleware";
import {
  type SupportActor,
  addMessage,
  attachmentContent,
  attachmentLink,
  closeTicket,
  getSupportStatus,
  getTicket,
  listTickets,
  markRead,
  openTicket,
  unreadCount,
} from "../services/destek.service";
import { SUPPORT_MAX_BASE64_CHARS, SUPPORT_MAX_FILES } from "../services/helpers/destek-attachment.helper";
import { AppError } from "../utils/app-error";

const router = Router();
router.use(verifyToken);

const jsonWithFiles = express.json({ limit: SUPPORT_BODY_LIMIT });

const STATUSES = ["NEW", "IN_PROGRESS", "WAITING_CUSTOMER", "ANSWERED", "CLOSED"] as const;
const shortText = (max: number) => z.string().trim().max(max, `En çok ${max} karakter olabilir.`);

const fileSchema = z.object({
  name: z.string().min(1, "Dosya adı boş olamaz.").max(255, "Dosya adı çok uzun."),
  contentType: z.string().min(1, "Dosya türü gerekli.").max(100),
  dataBase64: z.string().min(1, "Dosya içeriği boş.").max(SUPPORT_MAX_BASE64_CHARS + 1024, "Dosya 10 MB sınırını aşıyor."),
});
const filesSchema = z.array(fileSchema).max(SUPPORT_MAX_FILES, `En çok ${SUPPORT_MAX_FILES} dosya eklenebilir.`).optional();
const messageSchema = z.string().trim().min(1, "Mesaj boş olamaz.").max(20_000, "Mesaj en çok 20.000 karakter olabilir.");

const contextSchema = z
  .object({
    screen: shortText(200).optional(),
    path: shortText(500).optional(),
    relatedRecord: z.object({ type: shortText(50), ref: shortText(100), url: shortText(500).optional() }).strict().optional(),
    client: z
      .object({
        userAgent: shortText(500).optional(),
        browser: shortText(100).optional(),
        os: shortText(100).optional(),
        device: shortText(100).optional(),
        appVersion: shortText(50).optional(),
        locale: shortText(20).optional(),
      })
      .strict()
      .optional(),
    technical: z.record(z.string(), z.unknown()).optional(),
    // İstemci gönderse de YOK SAYILIR: ürün sürümünü sunucu yazar.
    productVersion: z.string().optional(),
    appVersion: z.string().optional(),
  })
  .strict();

const openSchema = z.object({
  type: z.enum(["BUG", "QUESTION", "REQUEST"], { message: "Talep türü BUG, QUESTION ya da REQUEST olmalı." }),
  subject: z.string().trim().min(1, "Konu boş olamaz.").max(200, "Konu en çok 200 karakter olabilir."),
  message: messageSchema,
  clientToken: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/, "clientToken 1–100 karakter [A-Za-z0-9_.:-] olmalı (önerilen UUID)."),
  context: contextSchema.optional(),
  files: filesSchema,
});
const replySchema = z.object({ message: messageSchema, files: filesSchema });
const idParam = z.object({ id: z.uuid("Geçersiz kimlik.") });
const scopeSchema = z.enum(["mine", "tenant"], { message: "scope mine ya da tenant olmalı." }).default("mine");
const listSchema = z.object({
  scope: scopeSchema,
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(STATUSES, { message: "Geçersiz durum." })).optional()),
  page: z.coerce.number().int().min(1, "page en az 1 olmalı.").optional(),
  limit: z.coerce.number().int().min(1).max(100, "limit en çok 100 olabilir.").optional(),
});
const variantSchema = z.object({ variant: z.enum(["original", "thumb"]).default("original") });

/** Kimlik YALNIZ oturumdan: gövdedeki `user`/`tenant`/`isTenantAdmin` hiçbir yere okunmaz. */
function actorOf(req: Request): SupportActor {
  if (!req.user) throw AppError.unauthorized("Kimlik doğrulama gerekli.");
  return { userId: req.user.userId, permissions: req.user.permissions, isSystemAccount: req.isSystemAccount === true };
}

/**
 * @openapi
 * /api/etkili-destek/durum:
 *   get:
 *     tags: [Destek]
 *     summary: Destek talebi özelliği bu kurulumda açık mı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, data: { etkin } }" }
 *       401: { description: Yetkisiz }
 */
router.get("/durum", (req: Request, res: Response) => {
  res.json(getSupportStatus(actorOf(req)));
});

router.use(requireSupportDeskEnabled);

/**
 * @openapi
 * /api/etkili-destek/talepler:
 *   post:
 *     tags: [Destek]
 *     summary: Destek talebi aç (ekler JSON içinde base64)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Talep açıldı (aynı clientToken tekrarında 200) }
 *       400: { description: Doğrulama hatası }
 *       403: { description: Özellik kapalı (MODULE_DISABLED) }
 *       502: { description: Destek merkezine ulaşılamadı }
 *   get:
 *     tags: [Destek]
 *     summary: Taleplerim / firmanın talepleri (scope=tenant yalnız yönetici)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ items, total, page, limit }" }
 *       403: { description: Yetkisiz kapsam (FORBIDDEN) ya da özellik kapalı }
 */
router.post("/talepler", jsonWithFiles, async (req: Request, res: Response) => {
  const body = openSchema.parse(req.body ?? {});
  const { kind, version } = readClientLabelHeaders(req.headers);
  const meta = { kind, version };
  const result = await openTicket(actorOf(req), body, meta);
  res.status(result.data.idempotentReplay ? 200 : 201).json(result);
});

router.get("/talepler", async (req: Request, res: Response) => {
  res.json(await listTickets(actorOf(req), listSchema.parse(req.query)));
});

/**
 * @openapi
 * /api/etkili-destek/talepler/{id}:
 *   get:
 *     tags: [Destek]
 *     summary: Talep ayrıntısı ve yazışma
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Talep görünümü }
 *       404: { description: Talep yok ya da erişilemiyor (NOT_FOUND) }
 */
router.get("/talepler/:id", async (req: Request, res: Response) => {
  res.json(await getTicket(actorOf(req), idParam.parse(req.params).id));
});

/**
 * @openapi
 * /api/etkili-destek/talepler/{id}/mesajlar:
 *   post:
 *     tags: [Destek]
 *     summary: Talebe yanıt yaz (ekler JSON içinde base64)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Güncel talep görünümü }
 *       409: { description: Kapanıştan 14 gün geçmiş (REOPEN_WINDOW_EXPIRED) }
 */
router.post("/talepler/:id/mesajlar", jsonWithFiles, async (req: Request, res: Response) => {
  const { id } = idParam.parse(req.params);
  res.status(201).json(await addMessage(actorOf(req), id, replySchema.parse(req.body ?? {})));
});

/**
 * @openapi
 * /api/etkili-destek/talepler/{id}/kapat:
 *   post:
 *     tags: [Destek]
 *     summary: Talebi "çözüldü" olarak kapat
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Talep görünümü (status CLOSED) }
 */
router.post("/talepler/:id/kapat", async (req: Request, res: Response) => {
  res.json(await closeTicket(actorOf(req), idParam.parse(req.params).id));
});

/**
 * @openapi
 * /api/etkili-destek/talepler/{id}/okundu:
 *   post:
 *     tags: [Destek]
 *     summary: Talebi okundu işaretle (rozet sıfırlanır)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ lastReadAt }" }
 */
router.post("/talepler/:id/okundu", async (req: Request, res: Response) => {
  res.json(await markRead(actorOf(req), idParam.parse(req.params).id));
});

/**
 * @openapi
 * /api/etkili-destek/okunmamis:
 *   get:
 *     tags: [Destek]
 *     summary: Menü rozeti — okunmamış ekip yanıtı sayısı (5 sn zaman aşımı)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: scope, schema: { type: string, enum: [mine, tenant] } }
 *     responses:
 *       200: { description: "{ count, tickets }" }
 */
router.get("/okunmamis", async (req: Request, res: Response) => {
  const { scope } = z.object({ scope: scopeSchema }).parse(req.query);
  res.json(await unreadCount(actorOf(req), scope));
});

/**
 * @openapi
 * /api/etkili-destek/ekler/{id}/baglanti:
 *   get:
 *     tags: [Destek]
 *     summary: Ekin 5 dk geçerli indirme bağlantısı
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: variant, schema: { type: string, enum: [original, thumb] } }
 *     responses:
 *       200: { description: "{ url, expiresAt }" }
 *       410: { description: Ek saklama süresi doldu (ATTACHMENT_EXPIRED) }
 */
router.get("/ekler/:id/baglanti", async (req: Request, res: Response) => {
  const { id } = idParam.parse(req.params);
  res.json(await attachmentLink(actorOf(req), id, variantSchema.parse(req.query).variant));
});

/**
 * @openapi
 * /api/etkili-destek/ekler/{id}/icerik:
 *   get:
 *     tags: [Destek]
 *     summary: Ekin baytları (sunucu merkezden indirip aynen akıtır; görsel inline, PDF attachment)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: variant, schema: { type: string, enum: [original, thumb] } }
 *     responses:
 *       200: { description: "Dosya baytları (image/png|jpeg|webp|gif, application/pdf)" }
 *       410: { description: Ek saklama süresi doldu (ATTACHMENT_EXPIRED) }
 *       502: { description: Merkez ulaşılamadı ya da izinsiz tür/adres (DESTEK_ULASILAMADI) }
 */
router.get("/ekler/:id/icerik", async (req: Request, res: Response) => {
  const { id } = idParam.parse(req.params);
  const file = await attachmentContent(actorOf(req), id, variantSchema.parse(req.query).variant);
  const ext = file.contentType.split("/")[1] === "jpeg" ? "jpg" : file.contentType.split("/")[1];
  res.set({
    "Content-Type": file.contentType,
    "Content-Length": String(file.body.length),
    "Content-Disposition": `${file.disposition}; filename="ek-${id}.${ext}"`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  res.status(200).end(file.body);
});

export default router;
