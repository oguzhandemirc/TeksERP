// =============================================================================
// TeksERP — Sertifikalar (`/api/certificates/*`, K4P-SERT)
// =============================================================================
// Kapı sırası load-bearing: `router.use` satırı HER uçtan önce. Bu yol global 1 MB JSON katmanını
// ATLAR (`BUYUK_GOVDE_YOLLARI`) ve kendi 8 MB katmanını taşır — belge eki base64 gövdeyle gelir.
// Okuma `certificate:read`; ekleme/yenileme/iptal/belge `certificate:write`.
// =============================================================================
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { CERTIFICATE_BODY_LIMIT } from "../constants/body-limits";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireKaliteGuvenceEnabled } from "../middlewares/module.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { createCertificate, renewCertificate, revokeCertificate, updateCertificate } from "../services/certificate.service";
import {
  CERTIFICATE_STANDARD_SUGGESTIONS, CERTIFICATE_STATUS_FILTERS, getCertificate, listCertificates, revokePreviewCertificate,
} from "../services/certificate-query.service";
import { deleteCertificateFile, readCertificateFile, uploadCertificateFile } from "../services/certificate-file.service";

const router = Router();
router.use(verifyToken, requireKaliteGuvenceEnabled, express.json({ limit: CERTIFICATE_BODY_LIMIT }));

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
const optText = (max: number) => z.string().max(max, `En çok ${max} karakter`).nullable().optional();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı");

const ListQuery = z.object({
  status: z.enum(CERTIFICATE_STATUS_FILTERS, "Tanınmayan durum süzgeci").optional(),
  days: z.coerce.number().int().min(0).max(3650).optional(),
  holder: z.enum(["OWN", "PARTNER"]).optional(),
  partnerId: z.union([z.string(), z.array(z.string())]).optional(),
  q: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const Fields = {
  holder: z.enum(["OWN", "PARTNER"], "Sahip Fabrika ya da İş ortağı olmalı"),
  partnerId: Id.nullable().optional(),
  standard: z.string().trim().min(1, "Standart boş olamaz").max(64, "En çok 64 karakter"),
  certificateNo: z.string().trim().min(1, "Sertifika numarası boş olamaz").max(80, "En çok 80 karakter"),
  issuer: optText(120),
  scope: optText(500),
  issuedOn: Day.nullable().optional(),
  expiresOn: Day,
  note: optText(500),
};
const CreateBody = z.strictObject({ clientToken: z.uuid("İşlem kimliği geçersiz").nullable().optional(), ...Fields });
const UpdateBody = z.strictObject(Fields);
const RenewBody = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz").nullable().optional(),
  ...Fields, holder: Fields.holder.optional(),
});
const RevokeBody = z.strictObject({ reason: z.string().trim().min(3, "İptal gerekçesi en az 3 karakter olmalı").max(500) });
// Beyan edilen mime alanı KASITLI yok — tür sihirli bayttan (`certificate-file.service`).
const FileBody = z.object({ fileName: z.string().max(400).nullable().optional(), contentBase64: z.string().min(1, "Dosya içeriği boş") });

/**
 * @openapi
 * /api/certificates:
 *   get:
 *     tags: [Kalite]
 *     summary: Sertifikalar — liste + cursor + özet şeridi (durum süzgeci active|expiring|expired|revoked|renewed|all)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "items, nextCursor, summary" }
 *       403: { description: "MODULE_DISABLED ya da izin yok" }
 *   post:
 *     tags: [Kalite]
 *     summary: Sertifika ekle (clientToken ile idempotent)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Sertifika }
 *       400: { description: "CERTIFICATE_PARTNER_REQUIRED · CERTIFICATE_DATE_INVALID" }
 * /api/certificates/standards:
 *   get:
 *     tags: [Kalite]
 *     summary: Önerilen standart listesi
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 */
router.get("/", requirePermission("certificate:read"), wrap(async (req) => ({ status: 200, data: await listCertificates(ListQuery.parse(req.query)) })));
router.post("/", requirePermission("certificate:write"), wrap(async (req) => ({ status: 201, data: await createCertificate(CreateBody.parse(req.body), req.user!.userId) })));
router.get("/standards", requirePermission("certificate:read"), wrap(async () => ({ status: 200, data: [...CERTIFICATE_STANDARD_SUGGESTIONS] })));

/**
 * @openapi
 * /api/certificates/{id}:
 *   get:
 *     tags: [Kalite]
 *     summary: Sertifika ayrıntısı + belge künyeleri (bayt yok)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Sertifika }
 *   put:
 *     tags: [Kalite]
 *     summary: Etkin sertifikanın künyesini düzelt (iptal/yenilenmiş 409 CERTIFICATE_NOT_ACTIVE)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Sertifika }
 * /api/certificates/{id}/renew:
 *   post:
 *     tags: [Kalite]
 *     summary: Yenile — yeni satır (renewsId); eskisi etkisizleşir
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Yeni sertifika }
 *       409: { description: "CERTIFICATE_NOT_ACTIVE · CERTIFICATE_ALREADY_RENEWED" }
 * /api/certificates/{id}/revoke-preview:
 *   get:
 *     tags: [Kalite]
 *     summary: İptal önizlemesi (etkilenen kayıt + ekleri)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Önizleme }
 * /api/certificates/{id}/revoke:
 *   post:
 *     tags: [Kalite]
 *     summary: İptal et (gerekçe ≥ 3; atomik claim)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Sertifika }
 */
router.get("/:id", requirePermission("certificate:read"), wrap(async (req) => ({ status: 200, data: await getCertificate(Id.parse(req.params.id)) })));
router.put("/:id", requirePermission("certificate:write"), wrap(async (req) => ({ status: 200, data: await updateCertificate(Id.parse(req.params.id), UpdateBody.parse(req.body), req.user!.userId) })));
router.post("/:id/renew", requirePermission("certificate:write"), wrap(async (req) => {
  const body = RenewBody.parse(req.body);
  return { status: 201, data: await renewCertificate(Id.parse(req.params.id), { ...body, holder: body.holder ?? "OWN" }, req.user!.userId) };
}));
router.get("/:id/revoke-preview", requirePermission("certificate:write"), wrap(async (req) => ({ status: 200, data: await revokePreviewCertificate(Id.parse(req.params.id)) })));
router.post("/:id/revoke", requirePermission("certificate:write"), wrap(async (req) => ({ status: 200, data: await revokeCertificate(Id.parse(req.params.id), RevokeBody.parse(req.body).reason, req.user!.userId) })));

/**
 * @openapi
 * /api/certificates/{id}/files:
 *   post:
 *     tags: [Kalite]
 *     summary: Belge eki yükle (base64; PDF/JPEG/PNG sihirli bayttan; ≤ 5 MB; aynı dosya mevcut kaydı döner)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Yeni belge }
 *       200: { description: Aynı dosya zaten kayıtlı }
 *       400: { description: "CERTIFICATE_FILE_TYPE · CERTIFICATE_FILE_TOO_LARGE" }
 * /api/certificates/{id}/files/{fileId}:
 *   get:
 *     tags: [Kalite]
 *     summary: Belgeyi indir (ikili; Content-Disposition attachment)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: fileId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Dosya }
 *   delete:
 *     tags: [Kalite]
 *     summary: Belgeyi kaldır (yalnız iptal edilmemiş sertifikada)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: fileId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Kaldırılan belge künyesi }
 */
router.post("/:id/files", requirePermission("certificate:write"), wrap(async (req) => {
  const out = await uploadCertificateFile(Id.parse(req.params.id), FileBody.parse(req.body), req.user!.userId);
  return { status: out.duplicate ? 200 : 201, data: out };
}));
router.get("/:id/files/:fileId", requirePermission("certificate:read"), async (req, res, next) => {
  try {
    const f = await readCertificateFile(Id.parse(req.params.id), Id.parse(req.params.fileId));
    const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.setHeader("Content-Type", f.mimeType);
    res.setHeader("Content-Length", String(f.content.length));
    res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).end(Buffer.from(f.content));
  } catch (err) {
    next(err);
  }
});
router.delete("/:id/files/:fileId", requirePermission("certificate:write"), wrap(async (req) => ({ status: 200, data: await deleteCertificateFile(Id.parse(req.params.id), Id.parse(req.params.fileId), req.user!.userId) })));

export default router;
