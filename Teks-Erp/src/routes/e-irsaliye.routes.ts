// =============================================================================
// TeksERP - e-İrsaliye uçları (/api/e-irsaliye) — plan §3.7 (E5-MOTOR)
// =============================================================================
// Modül kapısı YOK (plan P1: anahtar yok); belge doğuran her yazma ucu hazırlık
// kapısını SERVİSTE sorar (409 EIRSALIYE_NOT_CONFIGURED). İş serviste; burada yalnız
// izin + Zod + çağrı. XML yalnız `POST /:id/download` yanıtında döner: indirme sayacı
// yeniden üretim onayının girdisidir, sayacı atlayan salt-okur bir XML ucu açılmaz.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import * as svc from "../services/e-irsaliye/e-irsaliye.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken);

const READ = requirePermission("eirsaliye:read");
const WRITE = requirePermission("eirsaliye:write");
const UNDO = requirePermission("eirsaliye:undo");

type Handler = (req: Request) => Promise<unknown>;
const wrap = (h: Handler, status = 200) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => h(req))
    .then((data) => res.status(status).json({ success: true, data }), next);
};
const idOf = (req: Request, name = "id") => assertValidUuid(req.params[name], name);
const userOf = (req: Request) => req.user?.userId ?? null;

const txt = (max: number, ad: string) => z.string().max(max, `${ad} en fazla ${max} karakter olabilir`).nullable().optional();
const FieldsShape = {
  licensePlate: txt(32, "Araç plakası"),
  trailerPlate: txt(32, "Dorse plakası"),
  driverFirstName: txt(100, "Şoför adı"),
  driverFamilyName: txt(100, "Şoför soyadı"),
  driverNationalId: txt(11, "Şoför TCKN"),
  carrierName: txt(200, "Taşıyıcı unvanı"),
  carrierTaxId: txt(11, "Taşıyıcı VKN/TCKN"),
  recipientFirstName: txt(100, "Alıcı kişi adı"),
  recipientFamilyName: txt(100, "Alıcı kişi soyadı"),
};
const PrepareSchema = z.strictObject({ ...FieldsShape, clientToken: z.uuid("İşlem kimliği geçersiz").optional() });
const PatchSchema = z.strictObject(FieldsShape);
const RegenerateSchema = z.strictObject({ onay: z.boolean().optional() });
const DownloadSchema = z.strictObject({ version: z.number().int().positive("Sürüm 1 ya da büyük olmalı").optional() });
const MarkSentSchema = z.strictObject({
  confirmedEttn: z.uuid("Portal ETTN'i geçerli bir UUID olmalı").nullable().optional(),
  confirmedNo: z.string().trim().max(32, "Portal belge numarası en fazla 32 karakter").nullable().optional(),
});
const ResponseSchema = z.strictObject({
  durum: z.enum(["KABUL", "KISMI_KABUL", "REDDEDILDI", "HATA"], "Yanıt durumu KABUL, KISMI_KABUL, REDDEDILDI ya da HATA olmalı"),
  not: z.string().max(1000, "Not en fazla 1000 karakter olabilir").nullable().optional(),
  ozet: z.record(z.string(), z.unknown()).nullable().optional(),
});
const body = <T extends z.ZodType>(s: T, req: Request) => s.parse(req.body ?? {});

/**
 * @openapi
 * /api/e-irsaliye/readiness:
 *   get:
 *     tags: [EIrsaliye]
 *     summary: "Hazırlık durumu (HAZIR / YAPILANDIRILMAMIS) + eksikler — kart ve ayar rozeti"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/readiness", READ, wrap(() => svc.getReadiness()));

/**
 * @openapi
 * /api/e-irsaliye/by-shipment/{shipmentId}:
 *   get:
 *     tags: [EIrsaliye]
 *     summary: "Sevkiyatın canlı ve geçmiş e-İrsaliye kayıtları, olaylar, XML sürüm özetleri (gövdesiz), 'kaynak değişti' uyarısı"
 *     security: [{ bearerAuth: [] }]
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "e-İrsaliye hazırla (TASLAK) — taşıma önerisiyle; clientToken ile idempotent"
 *     description: "409 EIRSALIYE_NOT_CONFIGURED (+eksikler) · 409 EIRSALIYE_ALREADY_EXISTS · 400 EIRSALIYE_EXPORT · 409 EIRSALIYE_SHIPMENT_NOT_DISPATCHED / EIRSALIYE_BEFORE_EFFECTIVE_DATE"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/by-shipment/:shipmentId", READ, wrap((req) => svc.getForShipment(idOf(req, "shipmentId"))));
router.post("/by-shipment/:shipmentId", WRITE, wrap((req) => {
  const { clientToken, ...fields } = body(PrepareSchema, req);
  return svc.prepare(idOf(req, "shipmentId"), fields, clientToken, userOf(req));
}, 201));

/**
 * @openapi
 * /api/e-irsaliye/{id}:
 *   patch:
 *     tags: [EIrsaliye]
 *     summary: "Taşıma / alıcı kişi alanları — yalnız TASLAK, OLUSTURULDU, HATA; TCKN/VKN sunucuda doğrulanır"
 *     security: [{ bearerAuth: [] }]
 */
router.patch("/:id", WRITE, wrap((req) => svc.updateFields(idOf(req), body(PatchSchema, req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/generate:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Üret: numara + ETTN + XML v1 (TASLAK → OLUSTURULDU); 400 EIRSALIYE_VALIDATION + hatalar"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/generate", WRITE, wrap((req) => svc.generate(idOf(req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/regenerate:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Yeniden üret (XML v+1); indirilmiş XML'de gövdede onay:true ister (409 EIRSALIYE_ALREADY_DOWNLOADED)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/regenerate", WRITE, wrap((req) => svc.regenerate(idOf(req), body(RegenerateSchema, req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/download:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "XML indir (yanıtta xml + dosyaAdi); güncel sürümde indirme sayacını artırır"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/download", WRITE, wrap((req) => svc.download(idOf(req), body(DownloadSchema, req).version, userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/send:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Bağdaştırıcıyla gönder (gönderim yeteneği olan yöntemde; dışa aktarda 400)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/send", WRITE, wrap((req) => svc.send(idOf(req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/mark-sent:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Elle: portala yüklendi olarak işaretle (yalnız dışa aktar); portal ETTN/no teyidi isteğe bağlı"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/mark-sent", WRITE, wrap((req) => svc.markSent(idOf(req), body(MarkSentSchema, req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/poll:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Bağdaştırıcıdan durum sorgula (GONDERILDI → KABUL / KISMI_KABUL / REDDEDILDI / HATA)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/poll", WRITE, wrap((req) => svc.poll(idOf(req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/response:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Elle alıcı yanıtı kaydet (yalnız dışa aktar)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/response", WRITE, wrap((req) => svc.recordResponse(idOf(req), body(ResponseSchema, req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/undo-preview:
 *   get:
 *     tags: [EIrsaliye]
 *     summary: "Geri alma önizlemesi — etkiler ve engel"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id/undo-preview", UNDO, wrap((req) => svc.getUndoPreview(idOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/undo-sent:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Gönderim kaydını geri al (karşı olay; yalnız dışa aktar)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/undo-sent", UNDO, wrap((req) => svc.undoSent(idOf(req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/undo-response:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Yanıt kaydını geri al (karşı olay; yalnız dışa aktar)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/undo-response", UNDO, wrap((req) => svc.undoResponse(idOf(req), userOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/cancel-preview:
 *   get:
 *     tags: [EIrsaliye]
 *     summary: "İptal önizlemesi — boşta kalacak numara uyarısı"
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:id/cancel-preview", WRITE, wrap((req) => svc.getCancelPreview(idOf(req))));

/**
 * @openapi
 * /api/e-irsaliye/{id}/cancel:
 *   post:
 *     tags: [EIrsaliye]
 *     summary: "Yerel iptal (TASLAK / OLUSTURULDU / HATA → IPTAL)"
 *     security: [{ bearerAuth: [] }]
 */
router.post("/:id/cancel", WRITE, wrap((req) => svc.cancel(idOf(req), userOf(req))));

export default router;
