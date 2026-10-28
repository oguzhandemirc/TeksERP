// =============================================================================
// TeksERP — Gelen belge taslağı (`/api/gelen-belge/*`, Gülkesim OCR D2)
// =============================================================================
// Kapı sırası load-bearing: `router.use` satırı HER uçtan önce (kimlik → modül → gövde).
// Bu yol global 1 MB JSON katmanını ATLAR (`BUYUK_GOVDE_YOLLARI`) ve kendi 10 MB katmanını
// taşır — belge fotoğrafı base64 gövdeyle gelir (≤ 5 MB dosya, servis + DB CHECK).
// Okuma `gelen-belge:read`; tarama/taslak/satır yazma `gelen-belge:write`. Yalnız DRAFT yazılır;
// onay (D4, `gelen-belge:approve`) bu dosyada YOK. D3b: `/okuma/durum` (servis var/yok + kuyruk),
// `POST /taramalar/:id/oku` (servis yoksa 503 OCR_SERVICE_UNAVAILABLE), `/irsaliyeler/:id/eslestirme` (öneriler).
// =============================================================================
import { DeliveryNoteStatus } from "@prisma/client";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { BUYUK_GOVDE_LIMITI } from "../constants/body-limits";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireGelenBelgeEnabled } from "../middlewares/module.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import {
  addDeliveryNoteLines, createDeliveryNote, deleteDeliveryNote, deleteDeliveryNoteLine,
  getDeliveryNote, listDeliveryNotes, updateDeliveryNote, updateDeliveryNoteLine,
} from "../services/gelen-belge-note.service";
import { getDocumentScan, readDocumentScanContent, uploadDocumentScan } from "../services/gelen-belge-scan.service";
import { suggestForNote } from "../services/gelen-belge-eslestirme.service";
import { readerQueueCounts, requeueScanForReading } from "../services/gelen-belge-okuma.service";
import { readerJobStatus, requestImmediateReaderRun } from "../jobs/gelen-belge-okuma.job";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { readerHealth } from "../lib/gelen-belge/okuma-istemcisi";
import { AppError } from "../utils/app-error";

const router = Router();
router.use(verifyToken, requireGelenBelgeEnabled);
// Gövde katmanı kapıdan SONRA ayrı satırda: `test_module_flag_off §2a` kapıyı `use(verifyToken, <kapı>)` olarak ölçer.
router.use(express.json({ limit: BUYUK_GOVDE_LIMITI }));

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
const optText = (max: number) => z.string().trim().max(max, `En çok ${max} karakter`).nullable().optional();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı");
const Money = (label: string) => z.coerce.number().positive(`${label} sıfırdan büyük olmalı`).max(999_999, `${label} çok büyük`);

const ScanBody = z.strictObject({
  contentBase64: z.string().min(1, "Dosya içeriği boş"),
  noteId: Id.nullable().optional(),
  pageNo: z.coerce.number().int().min(1).max(99).nullable().optional(),
  regionNo: z.coerce.number().int().min(1).max(9).nullable().optional(),
  barcodeText: optText(120),
});
const Header = {
  ownerCustomerId: Id.nullable().optional(),
  senderCustomerId: Id.nullable().optional(),
  senderText: optText(160),
  senderDocNo: optText(64),
  senderDocDate: Day.nullable().optional(),
  customerBatchNo: optText(64),
  processText: optText(120),
  pageCount: z.coerce.number().int().min(1).max(99).nullable().optional(),
  declaredTopCount: z.coerce.number().int().min(1).max(9999).nullable().optional(),
  totalsDeclared: z.record(z.string(), z.unknown()).nullable().optional(),
};
const LineBody = z.strictObject({
  lineKind: z.enum(["TOP", "ARABA"], "Satır türü TOP ya da ARABA olmalı").optional(),
  blockNo: z.coerce.number().int().min(1).max(99).optional(),
  senderRollNo: optText(64),
  meters: Money("Metraj"),
  weightKg: Money("Kilo").nullable().optional(),
  widthCm: Money("En").nullable().optional(),
  itemText: optText(160),
  itemId: Id.nullable().optional(),
  colorText: optText(120),
  colorId: Id.nullable().optional(),
  processText: optText(120),
  needsReview: z.boolean().optional(),
});
const CreateBody = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz").nullable().optional(),
  sourceKind: z.enum(["MANUAL", "IMPORT"], "Kaynak MANUAL ya da IMPORT olmalı"),
  scanIds: z.array(Id).max(20).optional(),
  lines: z.array(LineBody).max(500, "Tek seferde en çok 500 satır").optional(),
  ...Header,
});
const UpdateBody = z.strictObject(Header);
const LinesBody = z.strictObject({
  // Parti kimliği: zaman aşımı tekrarı aynı token'la gelir, satırlar ikilenmez (`lineBatchReplay`).
  clientToken: z.uuid("İşlem kimliği geçersiz").nullable().optional(),
  lines: z.array(LineBody).min(1, "En az bir satır gerekli").max(500, "Tek seferde en çok 500 satır"),
});
const LinePatch = LineBody.partial();
const ListQuery = z.object({
  status: z.enum(DeliveryNoteStatus, "Tanınmayan durum süzgeci").optional(),
  sourceKind: z.enum(["OCR", "MANUAL", "IMPORT"], "Tanınmayan kaynak süzgeci").optional(),
  ownerCustomerId: z.union([z.string(), z.array(z.string())]).optional(),
  senderCustomerId: z.union([z.string(), z.array(z.string())]).optional(),
  q: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * @openapi
 * /api/gelen-belge/taramalar:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Belge fotoğrafı/PDF yükle (base64; tür sihirli bayttan; aynı sha256 = aynı kayıt, 200)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "scan künyesi (bayt yok)" }
 *       400: { description: "DOCUMENT_SCAN_INVALID · DOCUMENT_SCAN_TYPE" }
 *       413: { description: "DOCUMENT_SCAN_TOO_LARGE (5 MB)" }
 * /api/gelen-belge/taramalar/{id}:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Tarama künyesi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Künye }
 * /api/gelen-belge/taramalar/{id}/icerik:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Tarama ikili içeriği (inline)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: İkili }
 */
router.post("/taramalar", requirePermission("gelen-belge:write"), wrap(async (req) => {
  const r = await uploadDocumentScan(ScanBody.parse(req.body), req.user!.userId);
  // Yeni fotoğraf → okuma işini dürt (servis/modül yoksa iş kendi ön koşulunda durur; burada 503 YOK — yükleme elle taslak için de geçerli).
  if (!r.duplicate) requestImmediateReaderRun();
  return { status: r.duplicate ? 200 : 201, data: r };
}));
router.get("/taramalar/:id", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await getDocumentScan(Id.parse(req.params.id)) })));
router.get("/taramalar/:id/icerik", requirePermission("gelen-belge:read"), async (req, res, next) => {
  try {
    const f = await readDocumentScanContent(Id.parse(req.params.id));
    res.setHeader("Content-Type", f.mimeType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=0");
    res.status(200).end(f.content);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/gelen-belge/irsaliyeler:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Taslaklar — liste + cursor + özet şeridi (durum/kaynak/sahip/gönderen/q süzgeci; tek where)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "items, nextCursor, summary" }
 *       403: { description: "MODULE_DISABLED ya da izin yok" }
 *   post:
 *     tags: [Gelen belge]
 *     summary: Taslak aç (MANUAL/IMPORT; numara GB serisinden doğuşta; clientToken ile idempotent; satırlar toplu — satır ucu da `clientToken` parti kimliği taşır)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Taslak }
 *       409: { description: "DELIVERY_NOTE_DUPLICATE_DOC_NO · DOCUMENT_SCAN_NOT_FREE" }
 * /api/gelen-belge/irsaliyeler/{id}:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Taslak ayrıntısı (satırlar + tarama künyeleri)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Taslak }
 *   patch:
 *     tags: [Gelen belge]
 *     summary: Başlık düzelt — yalnız DRAFT (aksi 409 DELIVERY_NOTE_NOT_DRAFT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Taslak }
 *   delete:
 *     tags: [Gelen belge]
 *     summary: Taslağı sil — yalnız DRAFT (deftere hiç yazmamış taslak sınıfı; aksi 409)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ id, noteNo }" }
 * /api/gelen-belge/irsaliyeler/{id}/satirlar:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Satır ekle (tek ya da toplu — Excel içe aktarma istemci tarafında satıra çevirir)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       201: { description: Satırlar }
 * /api/gelen-belge/irsaliyeler/{id}/satirlar/{lineId}:
 *   patch:
 *     tags: [Gelen belge]
 *     summary: Satır düzelt (elle; gözden geçirildi sayılır)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Satır }
 *   delete:
 *     tags: [Gelen belge]
 *     summary: Satır sil (yalnız DRAFT taslakta)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: lineId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ id }" }
 */
// ── D3b okuma durumu / okut / eşleme ──────────────────────────────────────────
// Servis yok → "yok" (taslak elle sürer; çıkışsız kapı değil). Sağlık yoklaması canlı (5 s), adres maskelenmez (köken; sır yok).
router.get("/okuma/durum", requirePermission("gelen-belge:read"), wrap(async () => {
  const u = getReaderUrl();
  const counts = await readerQueueCounts();
  const job = readerJobStatus();
  if (!u.url) return { status: 200, data: { service: u.source === "gecersiz" ? "gecersiz" : "yok", url: null, engine: null, version: null, ...counts, job } };
  const h = await readerHealth(u.url);
  return { status: 200, data: { service: h.ok ? "var" : "erisilemiyor", url: u.url, engine: h.engine, version: h.version, code: h.code, ...counts, job } };
}));
// Okut: PENDING ise dürtme; READ_FAILED ise yeniden kuyruğa (attempts sıfır). Servis yoksa 503 — fotoğraf durur, taslak elle.
router.post("/taramalar/:id/oku", requirePermission("gelen-belge:write"), wrap(async (req) => {
  if (!getReaderUrl().url) throw new AppError("Okuma servisi bu kurulumda yok; taslağı elle ya da Excel'den doldurun.", 503, true, { code: "OCR_SERVICE_UNAVAILABLE" });
  const scan = await requeueScanForReading(Id.parse(req.params.id), req.user!.userId);
  requestImmediateReaderRun();
  return { status: 202, data: scan };
}));
router.get("/irsaliyeler/:id/eslestirme", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await suggestForNote(Id.parse(req.params.id)) })));

router.get("/irsaliyeler", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await listDeliveryNotes(ListQuery.parse(req.query)) })));
router.post("/irsaliyeler", requirePermission("gelen-belge:write"), wrap(async (req) => ({ status: 201, data: await createDeliveryNote(CreateBody.parse(req.body), req.user!.userId) })));
router.get("/irsaliyeler/:id", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await getDeliveryNote(Id.parse(req.params.id)) })));
router.patch("/irsaliyeler/:id", requirePermission("gelen-belge:write"), wrap(async (req) => ({ status: 200, data: await updateDeliveryNote(Id.parse(req.params.id), UpdateBody.parse(req.body), req.user!.userId) })));
router.delete("/irsaliyeler/:id", requirePermission("gelen-belge:write"), wrap(async (req) => ({ status: 200, data: await deleteDeliveryNote(Id.parse(req.params.id), req.user!.userId) })));
router.post("/irsaliyeler/:id/satirlar", requirePermission("gelen-belge:write"), wrap(async (req) => {
  // Tek satır gövdesi de kabul: `{ meters, … }` → `{ lines: [ … ] }` (panel tek satır ekler, Excel toplu yollar).
  const body = Array.isArray((req.body as { lines?: unknown })?.lines) ? LinesBody.parse(req.body) : { clientToken: null, lines: [LineBody.parse(req.body)] };
  return { status: 201, data: await addDeliveryNoteLines(Id.parse(req.params.id), body.lines, req.user!.userId, body.clientToken) };
}));
router.patch("/irsaliyeler/:id/satirlar/:lineId", requirePermission("gelen-belge:write"), wrap(async (req) => ({
  status: 200, data: await updateDeliveryNoteLine(Id.parse(req.params.id), Id.parse(req.params.lineId), LinePatch.parse(req.body), req.user!.userId),
})));
router.delete("/irsaliyeler/:id/satirlar/:lineId", requirePermission("gelen-belge:write"), wrap(async (req) => ({
  status: 200, data: await deleteDeliveryNoteLine(Id.parse(req.params.id), Id.parse(req.params.lineId), req.user!.userId),
})));

export default router;
