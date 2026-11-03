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
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { addDeliveryNoteLines, createDeliveryNote, deleteDeliveryNote, deleteDeliveryNoteLine, getDeliveryNote, listDeliveryNotes, updateDeliveryNote, updateDeliveryNoteLine } from "../services/gelen-belge-note.service";
import { approveDeliveryNote } from "../services/gelen-belge-onay.service";
import { cancelDeliveryNote } from "../services/gelen-belge-iptal.service";
import { previewDeliveryNoteCancel } from "../services/gelen-belge-iptal-onizleme.service";
import { AUTO_WORK_ORDER_PERMISSIONS, assertRouteOverride, withAutoWorkOrders } from "../services/gelen-belge-oto-is-emri.service";
import { createWorkOrderFromNote } from "../services/gelen-belge-form-is-emri.service";
import { workOrderFormFieldShape } from "../controllers/workorder.controller";
import { getNoteParties } from "../services/gelen-belge-cok-parti.service";
import { applyBulkDeleteDeliveryNotes, BULK_DELETE_MAX, previewBulkDeleteDeliveryNotes } from "../services/gelen-belge-toplu-sil.service";
import { getIncomingDocSettings, updateIncomingDocSettings } from "../services/gelen-belge-ayar.service";
import { requireSettingsPassword } from "../middlewares/settings-password.middleware";
import { getRollTabletContext } from "../services/roll-tablet.service";
import { deskRouteSuggestion, listDeskKursunMachines } from "../services/gelen-belge-masa.service";
import { getDocumentScan, readDocumentScanContent } from "../services/gelen-belge-scan.service";
import { uploadScanWithDeviceRead } from "../services/gelen-belge-istemci-okuma.service";
import { suggestForNote } from "../services/gelen-belge-eslestirme.service";
import { buildWorkOrderPlan } from "../services/gelen-belge-is-emri.service";
import { searchProcessChoiceValues } from "../services/helpers/process-choice-catalog.helper";
import { BATCH_NO_KEY_RE, listSenderTemplates, MANUAL_BATCH_NO_KEY, updateSenderTemplate } from "../services/gelen-belge-sablon.service";
import { listCustomerDefaults, removeCustomerDefault, setCustomerDefault } from "../services/gelen-belge-varsayilan.service";
import { assertScanReadable, readerQueueCounts, requeueScanForReading } from "../services/gelen-belge-okuma.service";
import { getReadSummary } from "../services/gelen-belge-okuma-ozeti.service";
import { stationDocLookup, stationLookupStatus } from "../services/gelen-belge-istasyon-okutma.service";
import { readerJobStatus, requestImmediateReaderRun } from "../jobs/gelen-belge-okuma.job";
import { kickPhotoRetentionIfActive, requestImmediatePhotoRetentionRun } from "../jobs/gelen-belge-foto-saklama.job";
import { workOrderSourceNotes } from "../services/gelen-belge-ie-kaynak.service";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { readerHealth } from "../lib/gelen-belge/okuma-istemcisi";
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";
import gelenBelgeSablonRoutes from "./gelen-belge-sablon.routes";

const router = Router();
router.use(verifyToken, requireGelenBelgeEnabled);
// Gövde katmanı kapıdan SONRA ayrı satırda: `test_module_flag_off §2a` kapıyı `use(verifyToken, <kapı>)` olarak ölçer.
router.use(express.json({ limit: BUYUK_GOVDE_LIMITI }));
// S1 kullanıcı şablonu + belge tipi tanıtma uçları — kapı ve gövde katmanı bu router'dan miras.
router.use(gelenBelgeSablonRoutes);

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
  contentBase64: z.string().min(1, "Dosya içeriği boş"), noteId: Id.nullable().optional(),
  pageNo: z.coerce.number().int().min(1).max(99).nullable().optional(), regionNo: z.coerce.number().int().min(1).max(9).nullable().optional(),
  barcodeText: optText(120),
  // D7: tablet özeti kendisi hesaplar; uyuşmazlık 400 DOCUMENT_SCAN_HASH_MISMATCH (eski istemci göndermez).
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, "Özet 64 onaltılık karakter olmalı").nullable().optional(),
  clientOcr: z.unknown().optional(), // S16c: katı şema serviste (`parseClientOcr`) — ihlal 400 CLIENT_OCR_INVALID (tablet clientOcr'sız tekrarlar)
});
const Header = {
  ownerCustomerId: Id.nullable().optional(),
  senderCustomerId: Id.nullable().optional(),
  senderText: optText(160),
  senderDocNo: optText(64),
  senderDocDate: Day.nullable().optional(),
  customerBatchNo: optText(64),
  // Müşterinin basılı "Sipariş No"su (S2b); sınır kolonun VarChar(64)'ü.
  customerOrderNo: optText(64),
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
// Parti no aday anahtarı (şablon alan anahtarı) — biçim tek kaynaktan; `MANUAL` yalnız sunucunun yazdığı işarettir.
const BatchNoKey = z.string().regex(BATCH_NO_KEY_RE, "Geçersiz parti no anahtarı").refine((v) => v !== MANUAL_BATCH_NO_KEY, "MANUAL anahtarı seçilemez (elle yazılan parti no anahtarsız gönderilir)");
// Gülkesim B: parti no + kurşun metresi yalnız başlık PATCH'inde (yaratma gövdesi değişmez; okuma katmanı doldurur).
const UpdateBody = z.strictObject({
  ...Header,
  ourBatchNo: optText(64),
  ourBatchNoKey: BatchNoKey.nullable().optional(),
  kursunMeters: Money("Kurşun metresi").nullable().optional(),
  kursunMetersReviewed: z.literal(true, "Gözden geçirme işareti yalnız true olabilir").optional(),
});
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
  // K27: WARN kipinde işi süren aynı belge no'lu eş varken operatörün "yine de onayla" kararı (BLOCK'ta yok sayılmaz → 409).
  confirmDuplicateDocNo: z.boolean("Onay bayrağı evet/hayır olmalı").optional(),
  processChoices: z.array(z.strictObject({ lineId: Id.nullable(), valueId: Id }), "Geçersiz işlem seçimi").max(500, "En çok 500 işlem seçimi").optional(),
  // P3 "Belge okut": onaydan sonra iş emri bu rotayla (öneri zinciri ve `autoWorkOrder` ayarı yerine); onay servisine gitmez.
  routeTemplateId: Id.optional(),
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
 *     summary: Belge fotoğrafı/PDF yükle (base64; tür sihirli bayttan; HEIC okuma servisinde JPEG'e çevrilir; aynı sha256 = aynı kayıt, 200; PDF arşivdir — READ_FAILED doğar, okunmaz; isteğe bağlı `clientOcr` = tabletin ML Kit okuması {engine:mlkit, width, height, rotation?, ms?, words[{t,c,l?,p?}] ≤4000, lines?[{c,p?}] ≤2000} → okuma servisi atlanır, taslak aynı istekte doğar (`deviceOcr` READ), işlenemezse sunucu okumasına düşer (FALLBACK))
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "scan künyesi (bayt yok)" }
 *       200: { description: "Aynı sha256 mevcut (duplicate) — serbest kayıt istenen taslağa bağlanır (boundTo); okunmuşsa satırlar saklı okuma sonucundan kurulur, zarf yoksa yeniden okumaya döner (restored[] REBUILT|REQUEUED)" }
 *       400: { description: "DOCUMENT_SCAN_INVALID · DOCUMENT_SCAN_TYPE · HEIC_CONVERT_FAILED · CLIENT_OCR_INVALID (hiçbir şey yazılmaz)" }
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
 *       410: { description: "Fotoğraf saklama ayarı gereği silindi (DOCUMENT_SCAN_PURGED, K28); satır/okuma/künye duruyor" }
 * /api/gelen-belge/is-emirleri/{id}/belgeler:
 *   get:
 *     tags: [Gelen belge]
 *     summary: İş emrinin geldiği gelen belgeler (K28 "Geldiği belge") — topların en yakın atasının belge satırından
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ total, notes: [{ id, noteNo, status, senderDocNo, scans: [{ id, pageNo, regionNo, mimeType, contentState FULL|REDUCED|PURGED, contentStateAt }] }] }" }
 *       404: { description: İş emri yok (WORK_ORDER_NOT_FOUND) }
 */
router.post("/taramalar", requirePermission("gelen-belge:write"), wrap(async (req) => {
  const r = await uploadScanWithDeviceRead(ScanBody.parse(req.body), req.user!.userId);
  // Yeni fotoğraf → okuma işini dürt (servis/modül yoksa iş kendi ön koşulunda durur; burada 503 YOK — yükleme elle taslak için de geçerli).
  // PDF kuyruğa girmez (K6): dürtülecek iş yok. Yeniden bağlanan okunmuş sayfa zarfsızsa kuyruğa döner (PENDING) — o da dürtülür.
  if (r.scan.status === "PENDING" && (!r.duplicate || r.deviceOcr === "FALLBACK" || r.restored?.some((o) => o.mode === "REQUEUED"))) requestImmediateReaderRun();
  return { status: r.duplicate ? 200 : 201, data: r };
}));
router.get("/taramalar/:id", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await getDocumentScan(Id.parse(req.params.id)) })));
router.get("/is-emirleri/:id/belgeler", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await workOrderSourceNotes(Id.parse(req.params.id)) })));
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
 *     summary: Taslaklar — liste + cursor + özet şeridi (durum/kaynak/sahip/gönderen/q/from–to süzgeci; tek where; q = numara · gönderen belge no · gönderen · müşteri parti no · müşteri sipariş no)
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
 *       200: { description: "Taslak + satır problems[] (FAILED|ITEM_UNRESOLVED|NEEDS_REVIEW|SUSPECT_VALUE) + satır itemFallback (id, name, source) | null + totalsCheck (+ document) + notices[] (code, title, detail) + perDocument { gate: code KURSUN_METERS_REQUIRED|KURSUN_METERS_REVIEW_PENDING|null, warnings, totalsBlocking } (yalnız gelenBelge.entryMode=PER_DOCUMENT iken)" }
 *   patch:
 *     tags: [Gelen belge]
 *     summary: Başlık düzelt — yalnız DRAFT (aksi 409 DELIVERY_NOTE_NOT_DRAFT); gövde yalnız tanımlı anahtarları yazar (customerOrderNo ≤ 64 dahil). ourBatchNo (+ ourBatchNoKey aday anahtarı; yoksa MANUAL; anahtar tek başına 400 DELIVERY_NOTE_BATCH_NO_KEY_WITHOUT_VALUE) · kursunMeters (> 0 → kaynak MANUAL, gözden geçirildi; null temizler) · kursunMetersReviewed true (değeri onaylar → MANUAL; metre yoksa 400 KURSUN_METERS_REQUIRED)
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
 *     summary: Taramayı okumaya gönder (READ_FAILED → PENDING, deneme sıfır; okunmuş ama bağlı DRAFT taslağa satır vermemiş sayfa → PENDING; işi dürter)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       202: { description: "Tarama künyesi (status, attempts)" }
 *       400: { description: "DOCUMENT_SCAN_PDF_NOT_READABLE (PDF otomatik okunmaz — K6)" }
 *       409: { description: "DOCUMENT_SCAN_ALREADY_READ (serbest ya da satırı taslakta) · DELIVERY_NOTE_NOT_DRAFT · DOCUMENT_SCAN_STATE_CHANGED" }
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
 *     summary: 'Tablet "Belge Tara" bağlamı — sahip adayları (aktif cariler, yalnız id+ad; KK1 bağlamıyla tek kaynak) + kurşun makineleri (Belge masası, K23)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "customers[] (id, name) · kursunMachines[] (id, code, name, stationId — kurşun istasyonlarının aktif makineleri; eski tablet okumaz)" }
 * /api/gelen-belge/rota-onerisi:
 *   get:
 *     tags: [Gelen belge]
 *     summary: 'Belge masası hazır iş emri ön seçimi — sahibin rota önerisi (plan ucu / otomatik iş emriyle tek zincir); salt okunur'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: sahip, required: false, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "routeTemplateId | null · routeName · source LAST_WORK_ORDER|CUSTOMER_ROUTE|FACTORY_DEFAULT | null · notes[]" }
 *       400: { description: "Geçersiz sahip kimliği" }
 */
// D7: tarayan `customer:read` taşımaz; KK1 emanet seçicisinin opt-in allowlist'i (`getRollTabletContext`) yeniden kullanılır.
// K23: masa ekranı `station:read` taşımaz; makine listesi aynı uçta dar alanlarla gelir (alan eklemek eski tableti kırmaz).
router.get("/tablet-baglam", requirePermission("gelen-belge:write"), wrap(async () => ({
  status: 200,
  data: { ...(await getRollTabletContext()).data, kursunMachines: await listDeskKursunMachines() },
})));
const DeskSuggestionQuery = z.object({ sahip: Id.optional() });
router.get("/rota-onerisi", requirePermission("gelen-belge:write"), wrap(async (req) => ({
  status: 200,
  data: await deskRouteSuggestion(DeskSuggestionQuery.parse(req.query).sahip ?? null),
})));
/**
 * @openapi
 * /api/gelen-belge/irsaliyeler/{id}/okuma-ozeti:
 *   get:
 *     tags: [Gelen belge]
 *     summary: 'Tablet "Belge Tara" okuma özeti — durum (NO_PAGES|READING|NO_SERVICE|READ|PARTIAL|FAILED) + Türkçe neden, satır/gözden geçirme sayısı, toplam kapısı (salt okunur)'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "noteId, noteNo, noteStatus, state, reason, pages (total/waiting/read/failed), lineCount, reviewCount, totals (declared, ok, mismatches[]), warnings[], notices[] (code, title, detail — okuma uyarıları, detayla aynı helper), tanitim? ({ durum: TANITILDI, sablonKodu, sablonAdi } | { durum: TANITILMAMIS }; sistem şablonunda yok)" }
 *       404: { description: DELIVERY_NOTE_NOT_FOUND }
 */
// Tarayan `gelen-belge:read` taşımaz (D7): taslağın kendi okuma sonucunu yalnız bu özetten görür; ayrıntı panelde.
router.get("/irsaliyeler/:id/okuma-ozeti", requirePermission("gelen-belge:write"), wrap(async (req) => ({ status: 200, data: await getReadSummary(Id.parse(req.params.id)) })));
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
  unreviewedApproval: z.enum(["WARN", "BLOCK_SUSPECT", "BLOCK"], "Seçenek WARN, BLOCK_SUSPECT ya da BLOCK olmalı").optional(),
  get autoWorkOrder() { return z.boolean(`Otomatik ${TERIM.terbiyeIsEmri.tekilKucuk} evet/hayır olmalı`).optional(); },
  defaultRouteTemplateId: Id.nullable().optional(),
  routeSuggestionPriority: z.enum(["CUSTOMER_FIRST", "FACTORY_FIRST"], "Seçenek CUSTOMER_FIRST ya da FACTORY_FIRST olmalı").optional(),
  handwritingOutlierFactor: z.number("Şüpheli değer oranı sayı olmalı").min(2, "Şüpheli değer oranı en az 2 olmalı").max(20, "Şüpheli değer oranı en çok 20 olmalı").nullable().optional(),
  headerLineMeterSource: z.enum(["OUTPUT", "INPUT"], "Seçenek OUTPUT ya da INPUT olmalı").optional(),
  autoSenderFromTemplate: z.boolean("Şablondan gönderen evet/hayır olmalı").optional(),
  documentTotalCheck: z.enum(["INFO", "REQUIRE_REASON"], "Seçenek INFO ya da REQUIRE_REASON olmalı").optional(),
  batchNumberSource: z.enum(["SERIES", "DOCUMENT"], "Seçenek SERIES ya da DOCUMENT olmalı").optional(),
  entryMode: z.enum(["PER_LINE", "PER_DOCUMENT"], "Seçenek PER_LINE ya da PER_DOCUMENT olmalı").optional(),
  autoWorkOrderPatternless: z.enum(["SKIP", "OPEN"], "Seçenek SKIP ya da OPEN olmalı").optional(),
  formApproval: z.enum(["SEPARATE", "WITH_WORK_ORDER"], "Seçenek SEPARATE ya da WITH_WORK_ORDER olmalı").optional(),
  multiPartyWorkOrder: z.enum(["SINGLE", "PER_PARTY"], "Seçenek SINGLE ya da PER_PARTY olmalı").optional(),
  duplicateDocNo: z.enum(["BLOCK", "WARN", "ALLOW"], "Seçenek BLOCK, WARN ya da ALLOW olmalı").optional(),
  refakatAutoPrint: z.boolean("Refakat kartı otomatik yazdırma evet/hayır olmalı").optional(),
  stationDocLookup: z.boolean("İstasyonda belge okutma evet/hayır olmalı").optional(),
  photoRetention: z.enum(["FULL", "SHRINK_ON_APPROVAL", "DELETE_ON_APPROVAL", "DELETE_ON_DISPATCH"], "Seçenek FULL, SHRINK_ON_APPROVAL, DELETE_ON_APPROVAL ya da DELETE_ON_DISPATCH olmalı").optional(),
  desenRenkEslesme: z.enum(["KAPALI", "ONER", "NOT"], "Seçenek KAPALI, ONER ya da NOT olmalı").optional(),
  tabletIeGirisi: z.enum(["IKISI", "BELGE", "TOP"], "Seçenek IKISI, BELGE ya da TOP olmalı").optional(), tanitimGuveni: z.enum(["SOR", "SORMA"], "Seçenek SOR ya da SORMA olmalı").optional(),
});
/**
 * @openapi
 * /api/gelen-belge/ayarlar:
 *   get:
 *     tags: [GelenBelge]
 *     summary: Gelen belge ayarları — varsayılan ürün (ad + kullanılabilirlik) ve gözden geçirilmemiş hücreyle onay kipi
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "defaultItem (id, code, name, problem) | null · unreviewedApproval WARN|BLOCK_SUSPECT|BLOCK · autoWorkOrder boolean · defaultRoute (id, name, problem) | null · routeSuggestionPriority CUSTOMER_FIRST|FACTORY_FIRST · headerLineMeterSource OUTPUT|INPUT · autoSenderFromTemplate boolean · documentTotalCheck INFO|REQUIRE_REASON · batchNumberSource SERIES|DOCUMENT · entryMode PER_LINE|PER_DOCUMENT · autoWorkOrderPatternless SKIP|OPEN · formApproval SEPARATE|WITH_WORK_ORDER (her biri default* alanıyla) · refakatAutoPrint boolean · stationDocLookup boolean · photoRetention FULL|SHRINK_ON_APPROVAL|DELETE_ON_APPROVAL|DELETE_ON_DISPATCH (defaultPhotoRetention ile)" }
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
 *               unreviewedApproval: { type: string, enum: [WARN, BLOCK_SUSPECT, BLOCK], description: "BLOCK_SUSPECT yalnız şüpheli değerli satırda 409 DELIVERY_NOTE_SUSPECT_PENDING" }
 *               autoWorkOrder: { type: boolean, description: "Onaydan sonra net desen gruplarına iş emri kendiliğinden (varsayılan false)" }
 *               defaultRouteTemplateId: { type: string, format: uuid, nullable: true, description: "Rota önerisinin fabrika varsayılanı; pasif/adımsız rota 400 GELEN_BELGE_DEFAULT_ROUTE_INVALID" }
 *               routeSuggestionPriority: { type: string, enum: [CUSTOMER_FIRST, FACTORY_FIRST] }
 *               handwritingOutlierFactor: { type: number, minimum: 2, maximum: 20, nullable: true, description: "El yazısı şüpheli metre oranı K (null = varsayılan 4)" }
 *               headerLineMeterSource: { type: string, enum: [OUTPUT, INPUT], description: "Tablosuz belgede satır metresi: çıkış (varsayılan) ya da giriş toplamı" }
 *               autoSenderFromTemplate: { type: boolean, description: "Okunan şablonun gönderen carisi boş gönderene yazılır (varsayılan false)" }
 *               documentTotalCheck: { type: string, enum: [INFO, REQUIRE_REASON], description: "Belge geneli beyan (Müşteri MT) farkı: INFO bilgi, onay geçer (varsayılan) · REQUIRE_REASON gerekçesiz 409 TOTAL_MISMATCH" }
 *               batchNumberSource: { type: string, enum: [SERIES, DOCUMENT], description: "Gelen belgeden doğan partinin numarası: seriden (varsayılan) ya da belgedeki parti no'dan" }
 *               entryMode: { type: string, enum: [PER_LINE, PER_DOCUMENT], description: "Onay kipi: her satır bir top (varsayılan) ya da belge başına tek kayıt; PER_DOCUMENT varsayılan ürünsüz 400 GELEN_BELGE_PER_DOCUMENT_NEEDS_DEFAULT_ITEM" }
 *               autoWorkOrderPatternless: { type: string, enum: [SKIP, OPEN], description: "İşlem değeri çözülemeyen grupta otomatik iş emri: atla (varsayılan) ya da hedef değersiz aç" }
 *               formApproval: { type: string, enum: [SEPARATE, WITH_WORK_ORDER], description: "İş emri formundan okutulan belge: ayrı onay (varsayılan) ya da iş emri açan kaydeder (POST /irsaliyeler/{id}/is-emri)" }
 *               multiPartyWorkOrder: { type: string, enum: [SINGLE, PER_PARTY], description: "Çok partili belgeden iş emri: tek iş emri, partiler ayrı top (varsayılan) ya da her parti ayrı iş emri" }
 *               duplicateDocNo: { type: string, enum: [BLOCK, WARN, ALLOW], description: "Aynı gönderen belge no tekrar gelirse: engelle (varsayılan) · işi süren eş varken uyar (onay bayrağıyla geçer) · serbest" }
 *               refakatAutoPrint: { type: boolean, description: "İş emri açılınca refakat kartı istemcide kendiliğinden yazdırılır (varsayılan false)" }
 *               stationDocLookup: { type: boolean, description: "İstasyon tabletinde belge okutarak iş emri bulma (varsayılan false)" }
 *               photoRetention: { type: string, enum: [FULL, SHRINK_ON_APPROVAL, DELETE_ON_APPROVAL, DELETE_ON_DISPATCH], description: "Belge fotoğrafı saklama (K28): tam (varsayılan) · onayda küçült · onayda sil · sevkte sil; geçmiş onaylı belgelere de uygulanır" }
 *               desenRenkEslesme: { type: string, enum: [KAPALI, ONER, NOT], description: "Okunan desen/renk yazısı: kullanılmaz (varsayılan) · adı/kodu tutan kayıt önerilir · iş emri notuna eklenir" }
 *               tabletIeGirisi: { type: string, enum: [IKISI, BELGE, TOP], description: "Tablet iş emri girişi: belge ve top okutma (varsayılan) · yalnız belge okutma · yalnız top okutma" }
 *               tanitimGuveni: { type: string, enum: [SOR, SORMA], description: "Tanıtılan belgeye güven: okunanları onaylat (varsayılan) · tanıtılan belgeyi sormadan doldur (tanınmayanın tahmini dolmaz)" }
 *     responses:
 *       200: { description: Güncel ayarlar }
 */
// Okuma `gelen-belge:read`: gözden geçirme ekranı "varsayılan ürünle girecek: <ad>" ipucunu buradan basar.
router.get("/ayarlar", requirePermission("gelen-belge:read"), wrap(async () => ({ status: 200, data: await getIncomingDocSettings() })));
// Yazma yalnız `admin:settings` (Genel Ayarlar → Gelen Belge kategorisi ADMIN_ONLY); ayar şifresi kapısı izinden SONRA.
// K28: saklama kipi FULL değilse geçmiş onaylılara uygulama beklemeden başlar (iş kendi ön koşulunda durur).
router.put("/ayarlar", requirePermission("admin:settings"), requireSettingsPassword, wrap(async (req) => ({ status: 200, data: kickPhotoRetentionIfActive(await updateIncomingDocSettings(SettingsBody.parse(req.body), req.user!.userId)) })));
// ── K17: istasyonda belgeden iş emri bulma (eşleme okuması — hiçbir kayıt doğurmaz) ──────────────────────────
const STATION_LOOKUP_PERMISSIONS = ["gelen-belge:read", "mobile:kk2-kursun", "mobile:tambur"] as const;
const StationLookupBody = z.union([
  z.strictObject({
    contentBase64: z.string().min(1, "Dosya içeriği boş"),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, "Özet 64 onaltılık karakter olmalı").nullable().optional(),
  }),
  z.strictObject({ q: z.string().trim().min(2, "Aramak için en az 2 karakter yazın").max(64, "En çok 64 karakter") }),
], "Fotoğraf (contentBase64) ya da arama metni (q) gönderin");
/**
 * @openapi
 * /api/gelen-belge/istasyon-okutma:
 *   get:
 *     tags: [GelenBelge]
 *     summary: İstasyonda belge okutma açık mı (ayar `gelenBelge.stationDocLookup` + üretim modülü) ve okuma servisi var mı
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "enabled boolean · readerConfigured boolean" }
 *   post:
 *     tags: [GelenBelge]
 *     summary: "Eşleme okuması: belge fotoğrafı ya da fiş/evrak/parti no → bağlı iş emri(leri). Tarama/taslak/şablon satırı YAZMAZ"
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - { type: object, required: [contentBase64], properties: { contentBase64: { type: string }, sha256: { type: string } } }
 *               - { type: object, required: [q], properties: { q: { type: string, minLength: 2, maxLength: 64 } } }
 *     responses:
 *       200: { description: "outcome SINGLE|MULTIPLE|NO_WORK_ORDER|NO_DOCUMENT|NO_DOC_NO|UNREADABLE · source SAME_PHOTO|STORED_READ|OCR|SEARCH · read · notes[] · workOrders[] (cardBarcode, batchNumbers, documents) · message" }
 *       400: { description: "VALIDATION_ERROR · DOCUMENT_SCAN_INVALID · DOCUMENT_SCAN_TYPE · DOCUMENT_SCAN_PDF_NOT_READABLE" }
 *       403: { description: "GELEN_BELGE_STATION_LOOKUP_DISABLED (ayar kapalı) · MODULE_DISABLED (gelen belge / üretim)" }
 *       503: { description: "OCR_SERVICE_UNAVAILABLE (okuma servisi yok/ulaşılamaz) · HEIC_CONVERT_UNAVAILABLE" }
 */
router.get("/istasyon-okutma", requireAnyPermission(...STATION_LOOKUP_PERMISSIONS), wrap(async () => ({ status: 200, data: await stationLookupStatus() })));
router.post("/istasyon-okutma", requireAnyPermission(...STATION_LOOKUP_PERMISSIONS), wrap(async (req) => ({ status: 200, data: await stationDocLookup(StationLookupBody.parse(req.body)) })));
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
 *               confirmDuplicateDocNo: { type: boolean, description: "K27 WARN kipinde işi süren aynı belge no'lu eşe rağmen onayla (BLOCK'ta 409 kalır)" }
 *               processChoices: { type: array, description: "Kabul edilen işlem önerileri (H9 gramaj, D4-D1 her çeşit değeri; metin başına tek) → PROCESS sözlüğü; değer yazmaz", items: { type: object, properties: { lineId: { type: string, format: uuid, nullable: true }, valueId: { type: string, format: uuid } } } }
 *               routeTemplateId: { type: string, format: uuid, description: "İş emri ekranından \"Belge okut\": onaydan sonra iş emri bu rotayla açılır (öneri zinciri ve autoWorkOrder ayarı yerine); onaydan ÖNCE doğrulanır" }
 *     responses:
 *       200: { description: "{ note, summary: { entered, failed, skipped, replayed, rollIds }, autoWorkOrders? } + üst düzey warnings (başlık top adedi ↔ satır; gerekçeyle geçilen sayfa). autoWorkOrders yalnız `gelenBelge.autoWorkOrder` açıkken: { opened, manual, reason, groups: [{ key, itemName, targets, rollCount, outcome OPENED|SKIPPED|FAILED, workOrderNumber?, attached?, reason? }] }" }
 *       400: { description: "DELIVERY_NOTE_OWNER_REQUIRED · OWNER_CUSTOMER_INVALID (sahip pasif/bulunamadı) · DELIVERY_NOTE_LINE_UNRESOLVED · PROCESS_VALUE_INVALID (değer aktif işlem çeşidi değil) · PROCESS_CHOICE_CONFLICT · PROCESS_CHOICE_LINE_INVALID · PROCESS_CHOICE_TEXT_EMPTY · GELEN_BELGE_ROUTE_OVERRIDE_INVALID (routeTemplateId pasif/adımsız/bulunamadı — onay koşmaz)" }
 *       403: { description: "MODULE_DISABLED (emanet; routeTemplateId varken üretim) · GELEN_BELGE_ROUTE_OVERRIDE_FORBIDDEN (routeTemplateId var, iş emri açma izni yok — onay koşmaz) ya da izin yok" }
 *       409: { description: "DELIVERY_NOTE_DUPLICATE_DOC_NO (BLOCK) · DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE (WARN; details.peers, confirmDuplicateDocNo ile geçilir) · KURSUN_METERS_REQUIRED · KURSUN_METERS_REVIEW_PENDING · DELIVERY_NOTE_ENTRY_MODE_MIXED (PER_DOCUMENT) · TOTAL_MISMATCH (blok adet/kg/m; varianceReason ile geçilir) · DELIVERY_NOTE_PAGES_MISSING (varianceReason ile geçilir) · DELIVERY_NOTE_CHANGED (ön kontrolden sonra düzenlendi) · DELIVERY_NOTE_NOT_APPROVABLE · DELIVERY_NOTE_NO_OPEN_LINES" }
 */
router.post("/irsaliyeler/:id/onay", requirePermission("gelen-belge:approve"), wrap(async (req) => {
  const id = Id.parse(req.params.id);
  const { routeTemplateId, ...body } = ApproveBody.parse(req.body ?? {});
  // Açık rota isteği onaydan ÖNCE doğrulanır (fail-closed: yerine getirilemiyorsa onay yok); istek yoksa `{}` = bugünkü yol.
  const opts = await assertRouteOverride(routeTemplateId, req.user!);
  // Onay önce ve aynen; otomatik iş emri (ayar açıksa ya da rota istendiyse) onaydan SONRA, best-effort.
  const out = await approveDeliveryNote(id, body, req.user!.userId).then((r) => withAutoWorkOrders(r, req.user!, opts)).then(({ warnings, ...data }) => ({ status: 200, data, warnings }));
  // K28: onay commit oldu → fotoğraf saklama işi beklemeden (kip FULL ise tur hiçbir şey yapmaz).
  requestImmediatePhotoRetentionRun();
  return out;
}));

// ── K15: onaylı belge iptali — önizleme + iptal (`gelen-belge:cancel`; SoD) ──
const CancelBody = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz"),
  reason: z.string("İptal sebebi zorunludur").trim().min(3, "İptal sebebi en az 3 karakter olmalı").max(300, "İptal sebebi en fazla 300 karakter"),
  get workOrderIds() { return z.array(Id, `Geçersiz ${TERIM.terbiyeIsEmri.tekilKucuk} listesi`).max(50, `Tek iptalde en fazla 50 ${TERIM.terbiyeIsEmri.tekilKucuk}`).optional(); },
});
/**
 * @openapi
 * /api/gelen-belge/irsaliyeler/{id}/iptal-onizleme:
 *   get:
 *     tags: [Gelen belge]
 *     summary: "Onaylı belge iptalinin önizlemesi (yazmaz): belgeden doğan her top (no, metre, durum, nerede, sonuç CANCEL|SKIP|BLOCKED + engeller), bağlı canlı iş emirleri (başlamamışsa seçilebilir; başka kaynaklı top sayısı), engel listesi"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ note, cancellable, rolls[], workOrders[], blockers[{ code, message, rollId?, workOrderId? }], summary }" }
 *       404: { description: DELIVERY_NOTE_NOT_FOUND }
 * /api/gelen-belge/irsaliyeler/{id}/iptal:
 *   post:
 *     tags: [Gelen belge]
 *     summary: "Onaylı (APPROVED/PARTIAL) belgeyi iptal et — tek tx: belge CANCELLED, toplar ters kayıtla (ROLL_CANCEL) düşer, seçilen başlamamış iş emirleri iptal; satırlar/defter durur; belge mükerrer denetiminden çıkar. clientToken ile idempotent."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, reason]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               reason: { type: string, minLength: 3, maxLength: 300 }
 *               workOrderIds: { type: array, maxItems: 50, items: { type: string, format: uuid }, description: "Belgeyle birlikte iptal edilecek başlamamış iş emirleri (önizlemedeki selectable)" }
 *     responses:
 *       200: { description: "{ note, cancelledRollCount, cancelledWorkOrders[{ id, workOrderNumber }] }" }
 *       400: { description: "Doğrulama · CANCEL_REASON_REQUIRED · DELIVERY_NOTE_CANCEL_WO_INVALID (seçilen iş emri belgeyle ilgisiz)" }
 *       403: { description: "İzin yok (gelen-belge:cancel) · MODULE_DISABLED" }
 *       404: { description: DELIVERY_NOTE_NOT_FOUND }
 *       409: { description: "DELIVERY_NOTE_NOT_CANCELLABLE (taslak/onaylanıyor/zaten iptal) · DELIVERY_NOTE_CANCEL_BLOCKED (details.blockers) · CLIENT_TOKEN_COLLISION" }
 */
router.get("/irsaliyeler/:id/iptal-onizleme", requirePermission("gelen-belge:cancel"), wrap(async (req) => ({ status: 200, data: await previewDeliveryNoteCancel(Id.parse(req.params.id)) })));
router.post("/irsaliyeler/:id/iptal", requirePermission("gelen-belge:cancel"), wrap(async (req) => ({
  status: 200, data: await cancelDeliveryNote(Id.parse(req.params.id), CancelBody.parse(req.body ?? {}), req.user!.userId),
})));

// ── OIE: iş emri formundan okutulan belge → kayıt + iş emri tek istekte (`gelenBelge.formApproval = WITH_WORK_ORDER`) ──
const FormWorkOrderBody = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz"),
  ownerCustomerId: Id,
  ourBatchNo: optText(64),
  ourBatchNoKey: BatchNoKey.nullable().optional(),
  kursunMeters: Money("Kurşun metresi"),
  // K29 S14b: yoksa rotasız (yalnız "Rota uygulaması: Okutmayla"; SIRALI'da servis onaydan ÖNCE 400 GELEN_BELGE_ROUTE_REQUIRED).
  routeTemplateId: Id.optional(),
  stepPlanning: z.array(z.strictObject({ sequence: z.number().int().min(1).max(200), plannedMachineId: Id.nullable().optional() }), "Geçersiz adım planı").max(200).optional(),
  targetValues: z.array(z.strictObject({ propertyId: Id, valueId: Id }), "Geçersiz hedef değer").max(50).optional(),
  notes: optText(1000),
  // S1 çok partili belge: ≥2 parti → parti başına top; mode verilmezse fabrika ayarı (varsayılan SINGLE).
  parties: z.array(z.strictObject({
    blockNo: z.number().int().min(1).max(99),
    batchNo: optText(64),
    meters: z.number().positive("Parti metresi sıfırdan büyük olmalı").max(1_000_000),
    targetValues: z.array(z.strictObject({ propertyId: Id, valueId: Id }), "Geçersiz hedef değer").max(50).optional(),
    stepPlanning: z.array(z.strictObject({ sequence: z.number().int().min(1).max(200), plannedMachineId: Id.nullable().optional() }), "Geçersiz adım planı").max(200).optional(),
  }), "Geçersiz parti listesi").min(2, "Çok parti için en az iki parti gerekir").max(30).optional(),
  mode: z.enum(["SINGLE", "PER_PARTY"], "Seçenek SINGLE ya da PER_PARTY olmalı").optional(),
  // K27 WARN: işi süren aynı belge no'lu eşe rağmen kaydet.
  confirmDuplicateDocNo: z.boolean("Onay bayrağı evet/hayır olmalı").optional(),
  // K30 S16a: iş emri formunun alanları (quickStart ile aynı Zod; tarih yalnız ISO).
  ...workOrderFormFieldShape,
});
/**
 * @openapi
 * /api/gelen-belge/irsaliyeler/{id}/is-emri:
 *   post:
 *     tags: [Gelen belge]
 *     summary: "İş emri formundan kayıt: not alanları → sistem onayı (PER_DOCUMENT, tek top = kursunMeters) → iş emri (seçilen rota, hedef değer, adım planı). Yalnız gelenBelge.formApproval=WITH_WORK_ORDER; gelen-belge:approve aranmaz. clientToken ile idempotent (yarıda kalan istek aynı token'la tamamlanır)."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, ownerCustomerId, kursunMeters]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               ownerCustomerId: { type: string, format: uuid }
 *               ourBatchNo: { type: string, maxLength: 64, nullable: true }
 *               ourBatchNoKey: { type: string, nullable: true }
 *               kursunMeters: { type: string, description: "Ondalık metre (operatörün gördüğü → gözden geçirilmiş sayılır)" }
 *               routeTemplateId: { type: string, format: uuid, description: "Yoksa iş emri ROTASIZ açılır (adımlar istasyonda okutuldukça eklenir) — yalnız production.routeMode=SCAN; SIRALI'da 400 GELEN_BELGE_ROUTE_REQUIRED, belge onaylanmaz" }
 *               stepPlanning: { type: array, items: { type: object, properties: { sequence: { type: integer }, plannedMachineId: { type: string, format: uuid, nullable: true } } } }
 *               targetValues: { type: array, items: { type: object, properties: { propertyId: { type: string, format: uuid }, valueId: { type: string, format: uuid } } } }
 *               notes: { type: string, maxLength: 1000, nullable: true }
 *               parties: { type: array, minItems: 2, description: "Çok partili belge (S1): parti başına top; blockNo /partiler'den", items: { type: object, properties: { blockNo: { type: integer }, batchNo: { type: string, nullable: true }, meters: { type: number }, targetValues: { type: array }, stepPlanning: { type: array } } } }
 *               mode: { type: string, enum: [SINGLE, PER_PARTY], description: "Çok partide: tek iş emri (partiler ayrı top) ya da her parti ayrı iş emri; verilmezse fabrika ayarı gelenBelge.multiPartyWorkOrder (varsayılan SINGLE)" }
 *               targetItemId: { type: string, format: uuid, description: "Hedef kumaş; belge onayında topların ürünü olur (top doğuramazsa 400 GELEN_BELGE_TARGET_ITEM_INVALID). Yoksa varsayılan ürün (bugünkü)" }
 *               targetColorId: { type: string, format: uuid }
 *               width: { type: number, exclusiveMinimum: 0, description: "En (cm)" }
 *               targetQuantity: { type: number, exclusiveMinimum: 0, description: "Hedef metraj (m); PER_PARTY kipinde 400 GELEN_BELGE_FORM_TARGET_PER_PARTY" }
 *               targetWeight: { type: number, exclusiveMinimum: 0, description: "Hedef kg; PER_PARTY kipinde 400 GELEN_BELGE_FORM_TARGET_PER_PARTY" }
 *               plannedStartDate: { type: string, description: "ISO tarih/zaman" }
 *               plannedEndDate: { type: string, description: "ISO tarih/zaman" }
 *               foldType: { type: string, description: "Kat tipi; verilirse istasyon varsayılanını ezer" }
 *               orderLineIds: { type: array, items: { type: string, format: uuid }, description: "Sipariş kalemleri (quick-start kuralı)" }
 *     responses:
 *       201: { description: "{ workOrderId, workOrderNo, batchNumber, rollId } (+ warnings)" }
 *       400: { description: "Doğrulama · GELEN_BELGE_ROUTE_OVERRIDE_INVALID · GELEN_BELGE_ROUTE_REQUIRED (rota yok + SIRALI; belge onaylanmaz) · GELEN_BELGE_PER_DOCUMENT_NEEDS_DEFAULT_ITEM · OWNER_CUSTOMER_INVALID · GELEN_BELGE_TARGET_ITEM_INVALID · GELEN_BELGE_FORM_TARGET_PER_PARTY" }
 *       403: { description: "GELEN_BELGE_FORM_APPROVAL_DISABLED (ayar ayrı onay) · MODULE_DISABLED (üretim) · iş emri açma izni yok" }
 *       409: { description: "DELIVERY_NOTE_NOT_READ (okuma READ/PARTIAL değil) · DELIVERY_NOTE_NOT_APPROVABLE · DELIVERY_NOTE_ROLL_MISSING · onay kapıları · token çakışması" }
 */
/**
 * @openapi
 * /api/gelen-belge/irsaliyeler/{id}/partiler:
 *   get:
 *     tags: [Gelen belge]
 *     summary: Çok partili belgenin parti özeti (parti no, sipariş no, yazan top, satır sayısı, metre, kg + canlı uyarılar) ve fabrika varsayılan kipi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ parties[], warnings[], multi, defaultMode SINGLE|PER_PARTY }" }
 *       404: { description: "DELIVERY_NOTE_NOT_FOUND" }
 */
router.get("/irsaliyeler/:id/partiler", requirePermission("gelen-belge:read"), wrap(async (req) => ({ status: 200, data: await getNoteParties(Id.parse(req.params.id)) })));
router.post("/irsaliyeler/:id/is-emri", requireAnyPermission(...AUTO_WORK_ORDER_PERMISSIONS), wrap(async (req) => {
  const { warnings, ...data } = await createWorkOrderFromNote(Id.parse(req.params.id), FormWorkOrderBody.parse(req.body ?? {}), req.user!);
  requestImmediatePhotoRetentionRun(); // WITH_WORK_ORDER kipi belgeyi de onaylar (K28).
  return { status: 201, data, warnings };
}));

// ── E2 gönderen şablonları (`gelen-belge:template`) ───────────────────────────
const TemplateCode = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Geçersiz şablon kodu");
const TemplatePatch = z.strictObject({
  isActive: z.boolean("Aktiflik evet/hayır olmalı").optional(),
  senderCustomerId: Id.nullable().optional(),
  defaultOwnerCustomerId: Id.nullable().optional(),
  batchNoKey: BatchNoKey.nullable().optional(),
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
 *     summary: Şablon bağını güncelle (isActive, senderCustomerId, defaultOwnerCustomerId, batchNoKey — parti no aday anahtarı, null temizler); satır yoksa doğar
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
