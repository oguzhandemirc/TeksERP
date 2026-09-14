// =============================================================================
// TeksERP — Tezgah DURUŞU (MachineStopEvent) uçları · ELLE GİRİŞ (Faz 1b)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA (machine-run emsali): `verifyToken` → `requireDokumaEnabled`
// → izin. İki izin ailesi: `loom:manual-entry` (aç · kapa · geri al — vardiya amiri
// elle girişi) ve `loom:classify` (sınıfla · yeniden sınıfla — sebep KARARI).
// Tablet dilimi (2026-09-14): aç/kapa/sebep `requireAnyPermission(<web>, ...MOBILE_DOKUMA)`, geri alma
// `mobile:dokuma-geri-al`; YENİDEN sınıflandırma web-only. `source` izinden türetilir (`stopSourceFor`).
// Panel/tablet YÜZEYİ ayrı dilimdir; izinler SCREENLESS gerekçeli.
// =============================================================================
import { Router, type Request } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { classifyStop, closeManualStop, openManualStop, reclassifyStop, revokeStop } from "../services/machine-stop.service";
import { listMachineStops, listStopReclasses } from "../services/loom-list.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);

// Tablet: aç/kapa/sebep ekran izniyle (ayrı kod açılmadı — doff/koşum emsali), geri alma yetenek izniyle.
const MOBILE_DOKUMA = ["mobile:dokuma"] as const;
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
    factoryDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz gün (YYYY-MM-DD)").optional(),
    shiftInstanceId: z.string().uuid("Geçersiz vardiya").optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

/**
 * @openapi
 * /api/machine-stops:
 *   get:
 *     tags: [MachineStops]
 *     summary: Duruş listesi — açık duruşlar (`open=true`) ya da sınıflandırma kuyruğu (`queue=true`)
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
        factoryDay: q.factoryDay,
        shiftInstanceId: q.shiftInstanceId,
        limit: q.limit,
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
