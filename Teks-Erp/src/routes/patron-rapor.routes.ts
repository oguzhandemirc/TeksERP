// =============================================================================
// TeksERP - Patron raporu ucu (V5a, 2026-11-13) — `/api/patron/v1/raporlar`
// =============================================================================
// İstek üzerine oluştur + sakla + geçmiş. Düzenli hesap yok. Biçim bulut `ReportRequest`/`ReportRequestDetail`.
// Toplu kapı kimlik + `patron-app:login`; raporun KENDİ ERP izni, modül ve rapor kapısı serviste (anahtar gövdeden gelir).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { PATRON_LOGIN_PERMISSION } from "../constants/permission-catalog";
import { AppError } from "../utils/app-error";
import {
  createPatronReportRun, deletePatronReportRun, getPatronReportRun, listPatronReportRuns, patronReportCatalog, type PatronReportUser,
} from "../services/patron-rapor/kosum.service";
import { patronReportFile } from "../services/patron-rapor/disa-aktar/dosya.service";

const router = Router();
// ⚠️ Toplu kapı: bu satırdan ÖNCE tanımlanan uç kapısız kalır (Express kayıt sırası).
router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION));

const userOf = (req: Request): PatronReportUser => ({ userId: req.user!.userId, permissions: req.user!.permissions });

const createSchema = z.strictObject({
  clientToken: z.string().uuid("clientToken UUID olmalı"),
  raporAnahtari: z.string().min(1, "raporAnahtari zorunlu").max(80),
  parametreler: z.record(z.string(), z.unknown()).default({}),
});
const listSchema = z.strictObject({
  raporAnahtari: z.string().min(1).max(80).optional(),
  imlec: z.string().uuid("imlec geçersiz").optional(),
  limit: z.coerce.number().int().min(1, "limit 1–100 olmalı").max(100, "limit 1–100 olmalı").default(20),
});
const idSchema = z.string().uuid("Koşum kimliği geçersiz");

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw AppError.badRequest(r.error.issues[0]?.message ?? "İstek geçersiz", { code });
  return r.data;
}

const send = (status: number, fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    res.status(status).json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

/**
 * @openapi
 * /api/patron/v1/raporlar/katalog:
 *   get:
 *     tags: [Patron]
 *     summary: İstenebilir raporlar + her birinin son koşumu
 *     description: Kullanıcının ERP izni, modül ve rapor görünürlüğüyle süzülür; satır bulut `rapor-katalogu` biçimi + `sonKosum`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ raporlar: KatalogSatiri[] }" }
 *       403: { description: patron-app:login yok }
 */
router.get("/katalog", send(200, (req) => patronReportCatalog(userOf(req))));

/**
 * @openapi
 * /api/patron/v1/raporlar:
 *   post:
 *     tags: [Patron]
 *     summary: Raporu şimdi oluştur (eşzamanlı hesap, sonuç saklanır)
 *     description: Aynı clientToken tek koşum. Kullanıcı başına eşzamanlı tek hesap ve saatlik tavan; 60 sn zaman aşımı HATA olarak saklanır.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, raporAnahtari]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               raporAnahtari: { type: string, maxLength: 80 }
 *               parametreler: { type: object }
 *     responses:
 *       201: { description: ReportRequestDetail }
 *       400: { description: Parametre geçersiz (PARAMETRE_GECERSIZ) }
 *       403: { description: Rapor izni yok, modül ya da rapor kapalı }
 *       404: { description: Rapor patron uygulamasından istenemez (RAPOR_BILINMIYOR) }
 *       429: { description: Hesap sürüyor (RAPOR_SIRADA) ya da saatlik tavan (RAPOR_TAVAN) }
 *   get:
 *     tags: [Patron]
 *     summary: Kullanıcının rapor koşum geçmişi (en yeni önce)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: raporAnahtari, schema: { type: string, maxLength: 80 } }
 *       - { in: query, name: imlec, schema: { type: string, format: uuid } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       200: { description: "Page<ReportRequest>" }
 *       400: { description: Sorgu geçersiz }
 */
router.post("/", send(201, (req) => createPatronReportRun(userOf(req), parse(createSchema, req.body, "PATRON_RAPOR_ISTEK"))));
router.get("/", send(200, (req) => listPatronReportRuns(userOf(req), parse(listSchema, req.query, "PATRON_RAPOR_SORGU"))));

/**
 * @openapi
 * /api/patron/v1/raporlar/{id}:
 *   get:
 *     tags: [Patron]
 *     summary: Tek koşum ve saklı sonucu
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: ReportRequestDetail }
 *       404: { description: Koşum yok ya da başkasına ait }
 *   delete:
 *     tags: [Patron]
 *     summary: Kendi koşumunu sil (soft delete)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ id, silindi: true }" }
 *       404: { description: Koşum yok, başkasına ait ya da hâlâ hazırlanıyor }
 */
router.get("/:id", send(200, (req) => getPatronReportRun(userOf(req), parse(idSchema, req.params.id, "PATRON_RAPOR_KIMLIK"))));
router.delete("/:id", send(200, (req) => deletePatronReportRun(userOf(req), parse(idSchema, req.params.id, "PATRON_RAPOR_KIMLIK"))));

/**
 * @openapi
 * /api/patron/v1/raporlar/{id}/dosya:
 *   get:
 *     tags: [Patron]
 *     summary: Kendi koşumunun dosyası (saklı sonuçtan; Excel ya da PDF'e çevrilecek HTML)
 *     description: Rapor yeniden hesaplanmaz. İkisi de aynı spec'ten (PDF = Excel); HTML dış kaynak yüklemez. Saatler fabrika diliminde.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: bicim, required: true, schema: { type: string, enum: [xlsx, html] } }
 *     responses:
 *       200: { description: Dosya (Content-Disposition attachment) }
 *       400: { description: Biçim ya da kimlik geçersiz (PATRON_RAPOR_BICIM) }
 *       404: { description: Koşum yok ya da başkasına ait }
 *       409: { description: Koşum dosya olarak indirilemiyor — HATA'lı ya da sunum zarfsız (DISA_AKTARILAMAZ) }
 */
router.get("/:id/dosya", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parse(idSchema, req.params.id, "PATRON_RAPOR_KIMLIK");
    const file = await patronReportFile(userOf(req), id, req.query.bicim);
    res.set({ "Cache-Control": "no-store", "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "X-Content-Type-Options": "nosniff" });
    res.status(200).send(file.body);
  } catch (error) {
    next(error);
  }
});

export default router;
