// =============================================================================
// TeksERP — Tezgah DURUŞU (MachineStopEvent) uçları · ELLE GİRİŞ (Faz 1b)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA (machine-run emsali): `verifyToken` → `requireMachineStopRegime`
// (D4-A1: dokuma ∨ üretim ∧ `uretim.makineDurusTakibi`; ayar kapalıyken dokuma kapısının aynısı) → izin. İki izin ailesi: `loom:manual-entry` (aç · kapa · geri al — vardiya amiri
// elle girişi) ve `loom:classify` (sınıfla · yeniden sınıfla — sebep KARARI).
// Tablet dilimi (2026-09-14): aç/kapa/sebep `requireAnyPermission(<web>, ...MOBILE_DOKUMA)`, geri alma
// `mobile:dokuma-geri-al`; YENİDEN sınıflandırma web-only. `source` izinden türetilir (`stopSourceFor`).
// Panel/tablet YÜZEYİ ayrı dilimdir; izinler SCREENLESS gerekçeli.
// =============================================================================
import { Router, type Request } from "express";
import { StationKind } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { readFilterList } from "../utils/query-parser";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireMachineStopRegime } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { classifyStop, closeManualStop, openManualStop, reclassifyStop, revokeStop } from "../services/machine-stop.service";
import { listMachineStops, listStopReclasses } from "../services/loom-list.service";
import { BULK_STOP_MAX, classifyBulkStops, closeBulkStops, openBulkStops, previewBulkStops, revokeBulkStops } from "../services/machine-stop-bulk.service";

const router = Router();
router.use(verifyToken, requireMachineStopRegime);

// Tablet: aç/kapa/sebep ekran izniyle (ayrı kod açılmadı — doff/koşum emsali), geri alma yetenek izniyle.
// D4-A1: kurşun/tambur/brode tableti `mobile:makine-durus` ile aç/kapa/sebep (geri alma ve yeniden sınıflama yok).
const MOBILE_DOKUMA = ["mobile:dokuma", "mobile:makine-durus"] as const;
const MOBILE_DOKUMA_GERI_AL = ["mobile:dokuma-geri-al"] as const;

/** Kim giriyor: web `loom:manual-entry` taşıyan VARDİYA AMİRİ, değilse tablet OPERATÖRÜ (1e hükmü 2026-09-14). */
function stopSourceFor(req: Request): "OPERATOR" | "SUPERVISOR" {
  return matchesPermission(req.user?.permissions ?? [], "loom:manual-entry") ? "SUPERVISOR" : "OPERATOR";
}

const listSchema = z
  .object({
    machineId: z.string().uuid("Geçersiz makine").optional(),
    open: z.literal("true").optional(),
    queue: z.literal("true").optional(),
    pendingEnd: z.literal("true").optional(),
    factoryDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz gün (YYYY-MM-DD)").optional(),
    shiftInstanceId: z.string().uuid("Geçersiz vardiya").optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    // İstasyon türü süzgeci (CSV / tekrarlı anahtar — `readFilterList`); yoksa bugünkü küme.
    stationKind: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

function parseStationKinds(raw: string | string[] | undefined): StationKind[] {
  const list = readFilterList(raw);
  const bad = list.filter((k) => !(Object.values(StationKind) as string[]).includes(k));
  if (bad.length) throw AppError.badRequest(`Geçersiz istasyon türü: ${bad.join(", ")}`, { code: "INVALID_STATION_KIND" });
  return list as StationKind[];
}

/**
 * @openapi
 * /api/machine-stops:
 *   get:
 *     tags: [MachineStops]
 *     summary: Duruş listesi — açık duruşlar (`open=true`), sınıflandırma kuyruğu (`queue=true`) ya da geçici (watchdog) kapanışı gerçek bitiş bekleyenler (`pendingEnd=true`)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Duruş listesi (geri alınmışlar hariç) }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requireAnyPermission("loom:manual-entry", "loom:classify", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    res.json(
      await listMachineStops({
        machineId: q.machineId,
        openOnly: q.open === "true",
        queueOnly: q.queue === "true",
        pendingEndOnly: q.pendingEnd === "true",
        factoryDay: q.factoryDay,
        shiftInstanceId: q.shiftInstanceId,
        limit: q.limit,
        stationKinds: parseStationKinds(q.stationKind),
      }),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-stops/{id}/reclasses:
 *   get:
 *     tags: [MachineStops]
 *     summary: Duruşun yeniden sınıflandırma DEFTERİ (from→to · kim · ne zaman · gerekçe; append-only)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Defter satırları (kronolojik) }
 *       404: { description: Duruş yok }
 */
router.get("/:id/reclasses", requireAnyPermission("loom:manual-entry", "loom:classify"), async (req, res, next) => {
  try {
    res.json(await listStopReclasses(assertValidUuid(req.params.id, "id")));
  } catch (e) {
    next(e);
  }
});

// ── Tezgah Salonu TOPLU duruş — yalnız panel (vardiya amiri `loom:manual-entry`); `/:id/*`ten ÖNCE bağlanır ──
const tooMany = `Tek seferde en çok ${BULK_STOP_MAX} tezgah seçilebilir.`;
const stopRowsSchema = z
  .array(z.object({ stopId: z.string().uuid("Geçersiz duruş") }).strict())
  .min(1, "En az bir tezgah seçin.")
  .max(BULK_STOP_MAX, tooMany);

const bulkPreviewSchema = z
  .object({
    action: z.enum(["OPEN", "CLOSE", "REVOKE"], { message: "Geçersiz işlem" }),
    machineIds: z.array(z.string().uuid("Geçersiz tezgah")).min(1, "En az bir tezgah seçin.").max(BULK_STOP_MAX, tooMany),
    at: z.coerce.date().nullish(),
  })
  .strict();

const bulkOpenSchema = z
  .object({
    startedAt: z.coerce.date({ message: "Başlangıç zamanı zorunlu" }),
    reasonCode: z.string().trim().min(1).max(64).nullish(),
    reasonNote: z.string().trim().max(300).nullish(),
    rows: z
      .array(z.object({ machineId: z.string().uuid("Geçersiz tezgah"), clientToken: z.string().uuid("Geçersiz istemci anahtarı") }).strict())
      .min(1, "En az bir tezgah seçin.")
      .max(BULK_STOP_MAX, tooMany),
  })
  .strict();

const bulkCloseSchema = z.object({ endedAt: z.coerce.date({ message: "Bitiş zamanı zorunlu" }), rows: stopRowsSchema }).strict();
const bulkRevokeSchema = z.object({ reason: z.string().trim().min(3, "Geri alma gerekçesi en az 3 karakter olmalı.").max(300), rows: stopRowsSchema }).strict();

/**
 * @openapi
 * /api/machine-stops/bulk/preview:
 *   post:
 *     tags: [MachineStops]
 *     summary: Toplu duruş aç / kapat / geri al ÖNİZLEMESİ — her tezgah adıyla, YAZMAZ
 *     description: >
 *       Satır sonucu OPEN · CLOSE · REVOKE (varsayılan seçili) ya da BLOCKED (sebepli — zaten duruşta,
 *       açık duruş yok, geçmiş saat çakışması STOP_OVERLAP, mühürlü/iptal vardiya). Satırlar tezgah kodu sırasında.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ action, at, rows[] }" }
 *       400: { description: Doğrulama / STOP_STAMP_OUT_OF_RANGE }
 */
router.post("/bulk/preview", requirePermission("loom:manual-entry"), async (req, res, next) => {
  try {
    res.json(await previewBulkStops(bulkPreviewSchema.parse(req.body ?? {})));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-stops/bulk/open:
 *   post:
 *     tags: [MachineStops]
 *     summary: Seçili tezgahlarda duruş AÇ (sebep bir kez) — sonuç PARÇALI olabilir
 *     description: >
 *       Her satır kendi transaction'ında, tezgah kodu sırasıyla; satır başına `clientToken` (aynı token'la yeniden
 *       gönderim özgün duruşu döndürür). Geçmiş başlangıç kapanmış bir duruşla örtüşürse satır 409 STOP_OVERLAP.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ requested, ok[], failed[] }" }
 *       400: { description: Doğrulama / REASON_CODE_INVALID / STOP_STAMP_OUT_OF_RANGE }
 */
router.post("/bulk/open", requirePermission("loom:manual-entry"), async (req, res, next) => {
  try {
    res.json(await openBulkStops(bulkOpenSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-stops/bulk/close:
 *   post:
 *     tags: [MachineStops]
 *     summary: Seçili açık duruşları KAPAT ("Hepsi çalıştı") — sonuç PARÇALI olabilir
 *     description: Aynı kullanıcının aynı bitişle yeniden gönderimi zaten kapanmış satırı `ok` (replayed) döner.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ requested, ok[], failed[] }" }
 *       400: { description: Doğrulama / STOP_STAMP_OUT_OF_RANGE }
 */
router.post("/bulk/close", requirePermission("loom:manual-entry"), async (req, res, next) => {
  try {
    res.json(await closeBulkStops(bulkCloseSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-stops/bulk/revoke:
 *   post:
 *     tags: [MachineStops]
 *     summary: Seçili açık duruşları GERİ AL (gerekçe bir kez; satır silinmez) — sonuç PARÇALI olabilir
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ requested, ok[], failed[] }" }
 *       400: { description: Doğrulama / REVOKE_REASON_REQUIRED }
 */
router.post("/bulk/revoke", requirePermission("loom:manual-entry"), async (req, res, next) => {
  try {
    res.json(await revokeBulkStops(bulkRevokeSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

// Sebep ata — sebep KARARI (`loom:classify`); önizleme aynı kaynaktan (`previewBulkStops`), izni ayrı rotada.
const bulkClassifyPreviewSchema = z
  .object({ machineIds: z.array(z.string().uuid("Geçersiz tezgah")).min(1, "En az bir tezgah seçin.").max(BULK_STOP_MAX, tooMany) })
  .strict();
const bulkClassifySchema = z
  .object({ reasonCode: z.string().trim().min(1, "Sebep seçin.").max(64), reasonNote: z.string().trim().max(300).nullish(), rows: stopRowsSchema })
  .strict();

/**
 * @openapi
 * /api/machine-stops/bulk/classify/preview:
 *   post:
 *     tags: [MachineStops]
 *     summary: Sebep ata önizlemesi — her tezgah adıyla; yalnız sebepsiz AÇIK duruş seçilebilir (YAZMAZ)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ action: CLASSIFY, at: null, rows[] }" }
 */
router.post("/bulk/classify/preview", requirePermission("loom:classify"), async (req, res, next) => {
  try {
    res.json(await previewBulkStops({ action: "CLASSIFY", machineIds: bulkClassifyPreviewSchema.parse(req.body ?? {}).machineIds }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/machine-stops/bulk/classify:
 *   post:
 *     tags: [MachineStops]
 *     summary: Seçili sebepsiz duruşlara SEBEP ATA (sebep bir kez; ilk sınıflandırma) — sonuç PARÇALI olabilir
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ requested, ok[], failed[] }" }
 *       400: { description: Doğrulama / REASON_CODE_INVALID }
 */
router.post("/bulk/classify", requirePermission("loom:classify"), async (req, res, next) => {
  try {
    res.json(await classifyBulkStops(bulkClassifySchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

const openSchema = z
  .object({
    machineId: z.string().uuid("Geçersiz makine"),
    startedAt: z.coerce.date().nullish(),
    reasonCode: z.string().trim().min(1).max(64).nullish(),
    reasonNote: z.string().trim().max(300).nullish(),
    beamSlot: z.number().int().min(1).max(8).nullish(),
    clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish(),
  })
  .strict();

/**
 * @openapi
 * /api/machine-stops:
 *   post:
 *     tags: [MachineStops]
 *     summary: Elle duruş AÇ (makine başına tek açık duruş)
 *     description: >
 *       `clientToken` idempotent — aynı anahtar aynı satırı döner; geri alınmış duruş
 *       yeniden açılmaz (409 STOP_REVOKED). Açık duruş varsa 409 STOP_ALREADY_OPEN.
 *       Sebep verilmezse sınıflandırma borcu doğar (`requiresReason`).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Duruş açıldı }
 *       400: { description: Geçersiz sebep kodu / pasif makine / STOP_STAMP_OUT_OF_RANGE (amir beyanı aralık dışı; tablet kırpılır + warnings) }
 *       409: { description: STOP_ALREADY_OPEN · STOP_REVOKED · SHIFT_CANCELLED }
 */
router.post("/", requireAnyPermission("loom:manual-entry", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const b = openSchema.parse(req.body ?? {});
    res.status(201).json(await openManualStop({ ...b, source: stopSourceFor(req) }, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

const closeSchema = z.object({ endedAt: z.coerce.date().nullish() }).strict();

/**
 * @openapi
 * /api/machine-stops/{id}/close:
 *   post:
 *     tags: [MachineStops]
 *     summary: Duruşu KAPAT (süre başlangıçtan hesaplanır)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kapatıldı }
 *       400: { description: STOP_END_BEFORE_START · STOP_STAMP_OUT_OF_RANGE (amir beyanı aralık dışı; tablet kırpılır + warnings) }
 *       409: { description: STOP_ALREADY_CLOSED · STOP_REVOKED · SHIFT_CANCELLED }
 */
router.post("/:id/close", requireAnyPermission("loom:manual-entry", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = closeSchema.parse(req.body ?? {});
    res.json(await closeManualStop(id, b.endedAt, req.user?.userId, stopSourceFor(req)));
  } catch (e) {
    next(e);
  }
});

const classifySchema = z
  .object({
    reasonCode: z.string().trim().min(1).max(64),
    reasonNote: z.string().trim().max(300).nullish(),
    beamSlot: z.number().int().min(1).max(8).nullish(),
  })
  .strict();

/**
 * @openapi
 * /api/machine-stops/{id}/classify:
 *   post:
 *     tags: [MachineStops]
 *     summary: İLK sınıflandırma (NULL → sebep) — kayıp sınıfı katalogdan kopyalanır
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sınıflandırıldı }
 *       400: { description: REASON_CODE_INVALID }
 *       409: { description: STOP_ALREADY_CLASSIFIED (yeniden sınıfla yolunu kullan) · STOP_REVOKED }
 */
router.post("/:id/classify", requireAnyPermission("loom:classify", ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = classifySchema.parse(req.body ?? {});
    res.json(await classifyStop(id, b, req.user?.userId, stopSourceFor(req)));
  } catch (e) {
    next(e);
  }
});

const reclassifySchema = z
  .object({
    fromReasonCode: z.string().trim().min(1).max(64),
    toReasonCode: z.string().trim().min(1).max(64),
    reason: z.string().trim().max(300).nullish(),
  })
  .strict();

/**
 * @openapi
 * /api/machine-stops/{id}/reclassify:
 *   post:
 *     tags: [MachineStops]
 *     summary: YENİDEN sınıflandırma (sebep → sebep) — değişim MachineStopReclass defterine düşer
 *     description: >
 *       `fromReasonCode` claim çıpasıdır: kayıtlı karar başkaysa 409 STOP_RECLASS_STALE.
 *       Ters yolu karşı kayıttır — aynı uç to→from ile.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yeniden sınıflandırıldı; defter satırı yazıldı }
 *       409: { description: STOP_RECLASS_STALE · STOP_NOT_CLASSIFIED · STOP_REVOKED }
 */
router.post("/:id/reclassify", requirePermission("loom:classify"), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = reclassifySchema.parse(req.body ?? {});
    res.json(await reclassifyStop(id, b, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

const revokeSchema = z.object({ reason: z.string().trim().min(3, "Geri alma gerekçesi en az 3 karakter olmalı.").max(300) }).strict();

/**
 * @openapi
 * /api/machine-stops/{id}/revoke:
 *   post:
 *     tags: [MachineStops]
 *     summary: Duruşu GERİ AL (damga — satır silinmez)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: STOP_ALREADY_REVOKED · SHIFT_CANCELLED }
 */
router.post("/:id/revoke", requireAnyPermission("loom:manual-entry", ...MOBILE_DOKUMA_GERI_AL), async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = revokeSchema.parse(req.body ?? {});
    res.json(await revokeStop(id, b.reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
