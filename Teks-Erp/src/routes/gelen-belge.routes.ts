// =============================================================================
// TeksERP — Gelen belge taslağı (`/api/gelen-belge/*`, Gülkesim OCR D2)
// =============================================================================
// Kapı sırası load-bearing: `router.use` satırı HER uçtan önce (kimlik → modül → gövde).
// Bu yol global 1 MB JSON katmanını ATLAR (`BUYUK_GOVDE_YOLLARI`) ve kendi 10 MB katmanını
// taşır — belge fotoğrafı base64 gövdeyle gelir (≤ 5 MB dosya, servis + DB CHECK).
// Okuma `gelen-belge:read`; tarama/taslak/satır yazma `gelen-belge:write`. Yalnız DRAFT yazılır;
// Onay (D4) `gelen-belge:approve` (SoD: Muhasebe/Süpervizör). D3b: `/okuma/durum` (servis var/yok + kuyruk),
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
import { approveDeliveryNote } from "../services/gelen-belge-onay.service";
import { withAutoWorkOrders } from "../services/gelen-belge-oto-is-emri.service";
import { applyBulkDeleteDeliveryNotes, BULK_DELETE_MAX, previewBulkDeleteDeliveryNotes } from "../services/gelen-belge-toplu-sil.service";
import { getIncomingDocSettings, updateIncomingDocSettings } from "../services/gelen-belge-ayar.service";
import { requireSettingsPassword } from "../middlewares/settings-password.middleware";
import { getRollTabletContext } from "../services/roll-tablet.service";
import { getDocumentScan, readDocumentScanContent, uploadDocumentScan } from "../services/gelen-belge-scan.service";
import { suggestForNote } from "../services/gelen-belge-eslestirme.service";
import { buildWorkOrderPlan } from "../services/gelen-belge-is-emri.service";
import { searchProcessChoiceValues } from "../services/helpers/process-choice-catalog.helper";
import { listSenderTemplates, updateSenderTemplate } from "../services/gelen-belge-sablon.service";
import { listCustomerDefaults, removeCustomerDefault, setCustomerDefault } from "../services/gelen-belge-varsayilan.service";
import { assertScanReadable, readerQueueCounts, requeueScanForReading } from "../services/gelen-belge-okuma.service";
import { readerJobStatus, requestImmediateReaderRun } from "../jobs/gelen-belge-okuma.job";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { readerHealth } from "../lib/gelen-belge/okuma-istemcisi";
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";

const router = Router();
router.use(verifyToken, requireGelenBelgeEnabled);
// Gövde katmanı kapıdan SONRA ayrı satırda: `test_module_flag_off §2a` kapıyı `use(verifyToken, <kapı>)` olarak ölçer.
router.use(express.json({ limit: BUYUK_GOVDE_LIMITI }));

type Handler = (req: Request) => Promise<{ status: number; data: unknown; warnings?: string[] }>;
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json({ success: true, data: out.data, ...(out.warnings?.length ? { warnings: out.warnings } : {}) });
  } catch (err) {
    next(err);
  }
};
const Id = z.uuid("Geçersiz kimlik");
const optText = (max: number) => z.string().trim().max(max, `En çok ${max} karakter`).nullable().optional();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı");
// Süzgeç günü takvimde VAR olmalı (2026-02-31 sessizce 3 Mart'a kaymaz → 400).
const RangeDay = Day.refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Tarih takvimde yok");
const Money = (label: string) => z.coerce.number().positive(`${label} sıfırdan büyük olmalı`).max(999_999, `${label} çok büyük`);

const ScanBody = z.strictObject({
  contentBase64: z.string().min(1, "Dosya içeriği boş"),
  noteId: Id.nullable().optional(),
  pageNo: z.coerce.number().int().min(1).max(99).nullable().optional(),
  regionNo: z.coerce.number().int().min(1).max(9).nullable().optional(),
  barcodeText: optText(120),
  // D7: tablet özeti kendisi hesaplar; uyuşmazlık 400 DOCUMENT_SCAN_HASH_MISMATCH (eski istemci göndermez).
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, "Özet 64 onaltılık karakter olmalı").nullable().optional(),
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
// `skip` yalnız PARTIAL belgedeki topsuz FAILED satır içindir (girilmeyecek kalem → SKIPPED; belge kapanabilsin).
const LinePatch = LineBody.partial().extend({ skip: z.literal(true).optional() });
// processChoices (H9; D4-D1 her çeşit değeri): kabul edilen/düzeltilen işlem önerisi → yalnız PROCESS sözlüğü; lineId null = başlık.
const ApproveBody = z.strictObject({
  varianceReason: optText(500),
  processChoices: z.array(z.strictObject({ lineId: Id.nullable(), valueId: Id }), "Geçersiz işlem seçimi").max(500, "En çok 500 işlem seçimi").optional(),
});
const ListQuery = z.object({
  status: z.enum(DeliveryNoteStatus, "Tanınmayan durum süzgeci").optional(),
  sourceKind: z.enum(["OCR", "MANUAL", "IMPORT"], "Tanınmayan kaynak süzgeci").optional(),
  ownerCustomerId: z.union([z.string(), z.array(z.string())]).optional(),
  senderCustomerId: z.union([z.string(), z.array(z.string())]).optional(),
  q: z.string().max(64).optional(),
  // createdAt aralığı; gün-yalnız değer FABRİKA gününün başı/sonu (`resolveRangeStart/End`, src/constants/time.ts).
  from: RangeDay.optional(),
  to: RangeDay.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: "Başlangıç tarihi bitişten sonra olamaz", path: ["from"] });

/**
 * @openapi
 * /api/gelen-belge/taramalar:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Belge fotoğrafı/PDF yükle (base64; tür sihirli bayttan; HEIC okuma servisinde JPEG'e çevrilir; aynı sha256 = aynı kayıt, 200; PDF arşivdir — READ_FAILED doğar, okunmaz)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "scan künyesi (bayt yok)" }
 *       400: { description: "DOCUMENT_SCAN_INVALID · DOCUMENT_SCAN_TYPE · HEIC_CONVERT_FAILED" }
 *       413: { description: "DOCUMENT_SCAN_TOO_LARGE (5 MB; HEIC'te dönüşüm sonrası da)" }
 *       503: { description: "HEIC_CONVERT_UNAVAILABLE (HEIC geldi, okuma servisi yok/eski/ulaşılamaz — hiçbir şey yazılmaz)" }
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
  // PDF kuyruğa girmez (K6): dürtülecek iş yok.
  if (!r.duplicate && r.scan.status === "PENDING") requestImmediateReaderRun();
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
 *     summary: Taslaklar — liste + cursor + özet şeridi (durum/kaynak/sahip/gönderen/q/from–to süzgeci; tek where)
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
 *     summary: Satır düzelt (elle; gözden geçirildi sayılır). DRAFT belgede her satır; PARTIAL belgede yalnız topsuz FAILED satır (düzelt ya da skip true → SKIPPED; açık satır kalmazsa başlık APPROVED). 409 DELIVERY_NOTE_NOT_DRAFT · DELIVERY_NOTE_LINE_NOT_EDITABLE
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
/**
 * @openapi
 * /api/gelen-belge/okuma/durum:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Okuma servisi durumu (yok · var · erisilemiyor · gecersiz) + kuyruk sayıları + iş özeti
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "service, url, engine, version, pending, reading, failed, job" }
 * /api/gelen-belge/taramalar/{id}/oku:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Taramayı okumaya gönder (READ_FAILED → PENDING, deneme sıfır; işi dürter)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       202: { description: "Tarama künyesi (status, attempts)" }
 *       400: { description: "DOCUMENT_SCAN_PDF_NOT_READABLE (PDF otomatik okunmaz — K6)" }
 *       409: { description: "DOCUMENT_SCAN_ALREADY_READ · DOCUMENT_SCAN_STATE_CHANGED" }
 *       503: { description: "OCR_SERVICE_UNAVAILABLE (okuma servisi bu kurulumda yok)" }
 * /api/gelen-belge/irsaliyeler/{id}/eslestirme:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Gönderen / sahip / satır ürün-renk eşleme önerileri (alias önce; ≥0,90 öneri, 0,80–0,90 liste)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "sender, owner, process (başlık işlem metni → kurşun gramaj çeşidi; ALIAS|PATTERN|NONE, H9), processOptions (aktif gramaj çeşitleri; işlem metni yoksa boş), processGroups (yalnız kurşun dışı çeşit özelliği varsa: brode deseni vb. katalog; process.variants[] özellik başına ALIAS|PATTERN|NONE, D4-D1), lines[] (item, color, process) önerileri (salt okunur; öneri değer yazmaz)" }
 */
/**
 * @openapi
 * /api/gelen-belge/tablet-baglam:
 *   get:
 *     tags: [Gelen belge]
 *     summary: 'Tablet "Belge Tara" bağlamı — sahip adayları (aktif cariler, yalnız id+ad; KK1 bağlamıyla tek kaynak)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "customers[] (id, name)" }
 */
// D7: tarayan `customer:read` taşımaz; KK1 emanet seçicisinin opt-in allowlist'i (`getRollTabletContext`) yeniden kullanılır.
router.get("/tablet-baglam", requirePermission("gelen-belge:write"), wrap(async () => ({ status: 200, data: (await getRollTabletContext()).data })));
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
  // PDF (K6) servis olsa da okunmaz → 400, servis yokluğunun 503'ünden ÖNCE (cevap kuruluma göre değişmesin).
  await assertScanReadable(Id.parse(req.params.id));
  if (!getReaderUrl().url) throw new AppError("Okuma servisi bu kurulumda yok; taslağı elle ya da Excel'den doldurun.", 503, true, { code: "OCR_SERVICE_UNAVAILABLE" });
  const scan = await requeueScanForReading(Id.parse(req.params.id), req.user!.userId);
  requestImmediateReaderRun();
  return { status: 202, data: scan };
}));
// ── E3 hizmet ekseni ayarları (varsayılan ürün + inceleme kapısı) ────────────────────────────────────────────
const SettingsBody = z.strictObject({
  defaultItemId: Id.nullable().optional(),
  unreviewedApproval: z.enum(["WARN", "BLOCK"], "Seçenek WARN ya da BLOCK olmalı").optional(),
  autoWorkOrder: z.boolean(`Otomatik ${TERIM.terbiyeIsEmri.tekilKucuk} evet/hayır olmalı`).optional(),
  defaultRouteTemplateId: Id.nullable().optional(),
  routeSuggestionPriority: z.enum(["CUSTOMER_FIRST", "FACTORY_FIRST"], "Seçenek CUSTOMER_FIRST ya da FACTORY_FIRST olmalı").optional(),
});
/**
 * @openapi
 * /api/gelen-belge/ayarlar:
 *   get:
 *     tags: [GelenBelge]
 *     summary: Gelen belge ayarları — varsayılan ürün (ad + kullanılabilirlik) ve gözden geçirilmemiş hücreyle onay kipi
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "defaultItem (id, code, name, problem) | null · unreviewedApproval WARN|BLOCK · autoWorkOrder boolean · defaultRoute (id, name, problem) | null · routeSuggestionPriority CUSTOMER_FIRST|FACTORY_FIRST" }
 *   put:
 *     tags: [GelenBelge]
 *     summary: Gelen belge ayarlarını yaz (yalnız admin:settings + ayar şifresi); pasif/top doğuramayan ürün 400 GELEN_BELGE_DEFAULT_ITEM_INVALID
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               defaultItemId: { type: string, format: uuid, nullable: true }
 *               unreviewedApproval: { type: string, enum: [WARN, BLOCK] }
 *               autoWorkOrder: { type: boolean, description: "Onaydan sonra net desen gruplarına iş emri kendiliğinden (varsayılan false)" }
 *               defaultRouteTemplateId: { type: string, format: uuid, nullable: true, description: "Rota önerisinin fabrika varsayılanı; pasif/adımsız rota 400 GELEN_BELGE_DEFAULT_ROUTE_INVALID" }
 *               routeSuggestionPriority: { type: string, enum: [CUSTOMER_FIRST, FACTORY_FIRST] }
 *     responses:
 *       200: { description: Güncel ayarlar }
 */
// Okuma `gelen-belge:read`: gözden geçirme ekranı "varsayılan ürünle girecek: <ad>" ipucunu buradan basar.
router.get("/ayarlar", requirePermission("gelen-belge:read"), wrap(async () => ({ status: 200, data: await getIncomingDocSettings() })));
// Yazma yalnız `admin:settings` (Genel Ayarlar → Gelen Belge kategorisi ADMIN_ONLY); ayar şifresi kapısı izinden SONRA.
router.put("/ayarlar", requirePermission("admin:settings"), requireSettingsPassword, wrap(async (req) => ({ status: 200, data: await updateIncomingDocSettings(SettingsBody.parse(req.body), req.user!.userId) })));
router.get("/irsaliyeler/:id/eslestirme", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await suggestForNote(Id.parse(req.params.id)) })));

/**
 * @openapi
 * /api/gelen-belge/irsaliyeler/{id}/is-emri-plani:
 *   get:
 *     tags: [GelenBelge]
 *     summary: Belgeden iş emri planı (D4-D2) — doğan toplar işlem değeri (desen/gramaj) + ürüne göre gruplu; salt okunur
 *     description: İş emri panelden grup başına mevcut `POST /api/work-orders/quick-start` ile açılır (grup başına clientToken).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Plan (gruplar, müşteri partisi, rota önerisi: suggestedRouteTemplateId + suggestedRouteSource LAST_WORK_ORDER|CUSTOMER_ROUTE|FACTORY_DEFAULT + routeSuggestionNotes)" }
 *       404: { description: DELIVERY_NOTE_NOT_FOUND }
 *       409: { description: DELIVERY_NOTE_NOT_APPROVED (yalnız APPROVED/PARTIAL) }
 */
router.get("/irsaliyeler/:id/is-emri-plani", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await buildWorkOrderPlan(Id.parse(req.params.id)) })));

const ProcessValueQuery = z.object({
  propertyId: Id,
  q: z.string().max(64, "Arama en çok 64 karakter").optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1, "limit en az 1").max(100, "limit en çok 100").default(50),
});
/**
 * @openapi
 * /api/gelen-belge/islem-degerleri:
 *   get:
 *     tags: [GelenBelge]
 *     summary: İşlem çeşidi değer araması (yüzlerce desen; sunucuda süzülür, liste + toplam + cursor tek where)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ property, items, total, nextCursor }" }
 *       400: { description: PROCESS_PROPERTY_INVALID }
 */
router.get("/islem-degerleri", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await searchProcessChoiceValues(ProcessValueQuery.parse(req.query)) })));

const BulkDeleteBody = z.strictObject({
  ids: z.array(Id).min(1, "En az bir belge seçin").max(BULK_DELETE_MAX, `Tek seferde en çok ${BULK_DELETE_MAX} belge silinir`),
});
/**
 * @openapi
 * /api/gelen-belge/irsaliyeler/toplu-sil/onizleme:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Toplu taslak silme ÖNİZLEMESİ — seçilen her belge için silinebilir mi + Türkçe nedeni, satır/sayfa sayısı; YAZMAZ
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [ids], properties: { ids: { type: array, items: { type: string, format: uuid }, maxItems: 200 } } } } } }
 *     responses:
 *       200: { description: "items[] (deletable, code, reason, lineCount, scanCount) + summary" }
 *       400: { description: Boş/200'den uzun ya da geçersiz kimlik }
 * /api/gelen-belge/irsaliyeler/toplu-sil:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Toplu taslak silme — her kayıt tekil DELETE yolundan (yalnız DRAFT, atomik claim, audit); kayıt başına sonuç, biri düşerse diğerleri sürer
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { content: { application/json: { schema: { type: object, required: [ids], properties: { ids: { type: array, items: { type: string, format: uuid }, maxItems: 200 } } } } } }
 *     responses:
 *       200: { description: "results[] (ok, status, code, message) + summary {deleted, failed}" }
 *       400: { description: Boş/200'den uzun ya da geçersiz kimlik }
 */
// `/irsaliyeler/:id` uçlarından ÖNCE: aynı derinlikteki POST yolları çakışmasın diye sabit yol önde.
router.post("/irsaliyeler/toplu-sil/onizleme", requirePermission("gelen-belge:write"), wrap(async (req) => ({ status: 200, data: await previewBulkDeleteDeliveryNotes(BulkDeleteBody.parse(req.body).ids) })));
router.post("/irsaliyeler/toplu-sil", requirePermission("gelen-belge:write"), wrap(async (req) => ({ status: 200, data: await applyBulkDeleteDeliveryNotes(BulkDeleteBody.parse(req.body).ids, req.user!.userId) })));

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

/**
 * @openapi
 * /api/gelen-belge/irsaliyeler/{id}/onay:
 *   post:
 *     tags: [Gelen belge]
 *     summary: Onayla → her satır emanet topu (STOCK, SEMI_FINISHED, sahipli); fiş kaptır — düşen satır FAILED, başlık APPROVED/PARTIAL; yeniden onay yalnız topsuz satırı işler
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               varianceReason: { type: string, maxLength: 500 }
 *               processChoices: { type: array, description: "Kabul edilen işlem önerileri (H9 gramaj, D4-D1 her çeşit değeri; metin başına tek) → PROCESS sözlüğü; değer yazmaz", items: { type: object, properties: { lineId: { type: string, format: uuid, nullable: true }, valueId: { type: string, format: uuid } } } }
 *     responses:
 *       200: { description: "{ note, summary: { entered, failed, skipped, replayed, rollIds }, autoWorkOrders? } + üst düzey warnings (başlık top adedi ↔ satır; gerekçeyle geçilen sayfa). autoWorkOrders yalnız `gelenBelge.autoWorkOrder` açıkken: { opened, manual, reason, groups: [{ key, itemName, targets, rollCount, outcome OPENED|SKIPPED|FAILED, workOrderNumber?, attached?, reason? }] }" }
 *       400: { description: "DELIVERY_NOTE_OWNER_REQUIRED · OWNER_CUSTOMER_INVALID (sahip pasif/bulunamadı) · DELIVERY_NOTE_LINE_UNRESOLVED · PROCESS_VALUE_INVALID (değer aktif işlem çeşidi değil) · PROCESS_CHOICE_CONFLICT · PROCESS_CHOICE_LINE_INVALID · PROCESS_CHOICE_TEXT_EMPTY" }
 *       403: { description: "MODULE_DISABLED (emanet) ya da izin yok" }
 *       409: { description: "TOTAL_MISMATCH (blok adet/kg/m; varianceReason ile geçilir) · DELIVERY_NOTE_PAGES_MISSING (varianceReason ile geçilir) · DELIVERY_NOTE_CHANGED (ön kontrolden sonra düzenlendi) · DELIVERY_NOTE_NOT_APPROVABLE · DELIVERY_NOTE_NO_OPEN_LINES" }
 */
router.post("/irsaliyeler/:id/onay", requirePermission("gelen-belge:approve"), wrap(async (req) => ({
  // Onay önce ve aynen; otomatik iş emri (ayar açıksa) onaydan SONRA, best-effort — `autoWorkOrders` yalnız ayar açıkken.
  ...(await approveDeliveryNote(Id.parse(req.params.id), ApproveBody.parse(req.body ?? {}), req.user!.userId).then((r) => withAutoWorkOrders(r, req.user!)).then(({ warnings, ...data }) => ({ status: 200, data, warnings }))),
})));

// ── E2 gönderen şablonları (`gelen-belge:template`) ───────────────────────────
const TemplateCode = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Geçersiz şablon kodu");
const TemplatePatch = z.strictObject({
  isActive: z.boolean("Aktiflik evet/hayır olmalı").optional(),
  senderCustomerId: Id.nullable().optional(),
  defaultOwnerCustomerId: Id.nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, "Değiştirilecek alan yok");
/**
 * @openapi
 * /api/gelen-belge/sablonlar:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Gönderen şablonları — dosyadaki motor şablonları + DB bağı (kod, sürüm, aktif, gönderen, varsayılan sahip, isabet); salt okunur
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "SenderTemplateView[] (satırı olmayan şablon id null)" }
 *       403: { description: "MODULE_DISABLED ya da izin yok" }
 * /api/gelen-belge/sablonlar/{code}:
 *   patch:
 *     tags: [Gelen belge]
 *     summary: Şablon bağını güncelle (isActive, senderCustomerId, defaultOwnerCustomerId); satır yoksa doğar
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "SenderTemplateView" }
 *       400: { description: "SENDER_TEMPLATE_CUSTOMER_INACTIVE · SENDER_TEMPLATE_CUSTOMER_NOT_FOUND · doğrulama" }
 *       404: { description: "SENDER_TEMPLATE_NOT_FOUND (yedek sözlük dahil)" }
 *       409: { description: "SENDER_TEMPLATE_CHANGED (araya başka yazım girdi)" }
 */
router.get("/sablonlar", requirePermission("gelen-belge:template"), wrap(async () => ({ status: 200, data: await listSenderTemplates() })));
router.patch("/sablonlar/:code", requirePermission("gelen-belge:template"), wrap(async (req) => ({
  status: 200, data: await updateSenderTemplate(TemplateCode.parse(req.params.code), TemplatePatch.parse(req.body), req.user!.userId),
})));

// ── E4 sahibe özel varsayılan ürün (`gelen-belge:template` — şablon yönetimiyle aynı kişi; SystemSetting değil, ayar şifresi yok)
const CustomerDefaultBody = z.strictObject({ defaultItemId: Id });
/**
 * @openapi
 * /api/gelen-belge/varsayilan-urunler:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Sahibe özel varsayılan ürünler (müşteri → ürün; problem dolu = onayda 409 verecek)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "CustomerDefaultView[] { customerId, customer, item, problem, updatedAt }" }
 *       403: { description: "MODULE_DISABLED ya da izin yok" }
 * /api/gelen-belge/varsayilan-urunler/{customerId}:
 *   put:
 *     tags: [Gelen belge]
 *     summary: Müşterinin varsayılan ürününü yaz (yoksa doğar); ürünsüz satır onayda bu üründen doğar (fabrika ayarını ezer)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: customerId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, required: [defaultItemId], properties: { defaultItemId: { type: string, format: uuid } } }
 *     responses:
 *       200: { description: "CustomerDefaultView" }
 *       400: { description: "GELEN_BELGE_CUSTOMER_INVALID (yok/pasif) · GELEN_BELGE_DEFAULT_ITEM_INVALID (iplik/pasif/bulunamadı) · doğrulama" }
 *       409: { description: "GELEN_BELGE_CUSTOMER_DEFAULT_CHANGED (araya başka yazım girdi)" }
 *   delete:
 *     tags: [Gelen belge]
 *     summary: Müşterinin varsayılan ürününü kaldır (saf yapılandırma — sert silme); sonra fabrika ayarı geçerli
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: customerId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ customerId }" }
 *       404: { description: "GELEN_BELGE_CUSTOMER_DEFAULT_NOT_FOUND" }
 *       409: { description: "GELEN_BELGE_CUSTOMER_DEFAULT_CHANGED" }
 */
router.get("/varsayilan-urunler", requirePermission("gelen-belge:template"), wrap(async () => ({ status: 200, data: await listCustomerDefaults() })));
router.put("/varsayilan-urunler/:customerId", requirePermission("gelen-belge:template"), wrap(async (req) => ({
  status: 200, data: await setCustomerDefault(Id.parse(req.params.customerId), CustomerDefaultBody.parse(req.body).defaultItemId, req.user!.userId),
})));
router.delete("/varsayilan-urunler/:customerId", requirePermission("gelen-belge:template"), wrap(async (req) => ({
  status: 200, data: await removeCustomerDefault(Id.parse(req.params.customerId), req.user!.userId),
})));

export default router;
