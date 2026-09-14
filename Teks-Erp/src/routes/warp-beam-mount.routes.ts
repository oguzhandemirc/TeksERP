// =============================================================================
// TeksERP — Levent TEZGAH BAĞI uçları (devere Faz 3): tak · sök · tüket · düzelt · bitir · hurda · geri al
// =============================================================================
// `warp-beam.routes.ts`in ALT yönlendiricisi — üç kapı (verifyToken → requireDevereEnabled) orada
// takılıdır, burada yalnız izin. Tablet: Devere ekranı `mobile:devere` (tak · düzelt); Tezgah ekranı
// `mobile:dokuma` (sök · tüket · bitir — tezgahtaki levente dokunur); hurda + geri almalar yıkıcı
// yetenek `warpbeam:cancel` / `mobile:devere-iptal`. Bayrak kapısı (409 WARP_MOUNT_TRACKING_OFF)
// serviste — izin katalogda hep vardır, yetenek bayrakla "yok" olur (kapalıyken sıfır fark).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { WarpBeamMountMethod, WarpLengthSource } from "@prisma/client";
import { requireAnyPermission } from "../middlewares/rbac.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { cancelStatusEvent, dismountBeam, listMountedOnMachine, mountBeam } from "../services/warp-beam-mount.service";
import { adjustBeam, cancelConsumed, consumeBeam, exhaustBeam, scrapBeam, scrapPreview } from "../services/warp-beam-consume.service";
import "../types/express-augment";

const router = Router();

const MOBILE_DEVERE = ["mobile:devere"] as const;
const MOBILE_DOKUMA = ["mobile:dokuma"] as const;
const MOBILE_DEVERE_IPTAL = ["mobile:devere-iptal"] as const;

const qty = z.union([z.number(), z.string().min(1)]);
const qtyOrNull = qty.nullable().optional();
const reasonText = z.string().trim().max(300).nullable().optional();
const reasonRequired = z.string().trim().min(3, "Gerekçe en az 3 karakter").max(300);

const mountSchema = z
  .object({
    machineId: z.string().uuid(),
    position: z.number().int().min(1).max(32),
    mountMethod: z.nativeEnum(WarpBeamMountMethod).nullable().optional(),
    beamRole: z.string().trim().max(32).nullable().optional(),
    setupStartedAt: z.coerce.date().nullable().optional(),
    setupMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
    machineCounter: qtyOrNull,
    clientToken: z.string().uuid().nullable().optional(),
  })
  .strict();

const dismountSchema = z
  .object({
    remainingM: qtyOrNull,
    lengthSource: z.nativeEnum(WarpLengthSource).nullable().optional(),
    machineCounter: qtyOrNull,
    reason: reasonText,
  })
  .strict();

const consumeSchema = z
  .object({
    lengthM: qty,
    lengthSource: z.nativeEnum(WarpLengthSource),
    machineCounter: qtyOrNull,
    fabricLengthM: qtyOrNull,
    grossKg: qtyOrNull,
    tareKg: qtyOrNull,
    reason: reasonText,
    clientToken: z.string().uuid().nullable().optional(),
  })
  .strict();

const adjustSchema = z
  .object({ direction: z.enum(["IN", "OUT"]), lengthM: qty, reasonCode: z.string().trim().min(1).max(64), reason: reasonText, lengthSource: z.nativeEnum(WarpLengthSource).nullable().optional() })
  .strict();

const exhaustSchema = z
  .object({
    residualM: qtyOrNull,
    grossKg: qtyOrNull,
    tareKg: qtyOrNull,
    lengthSource: z.nativeEnum(WarpLengthSource).nullable().optional(),
    reasonCode: z.string().trim().max(64).nullable().optional(),
    reason: reasonText,
    machineCounter: qtyOrNull,
  })
  .strict();

const scrapSchema = z.object({ reasonCode: z.string().trim().min(1).max(64), reason: reasonText }).strict();
const cancelSchema = z.object({ reason: reasonRequired }).strict();

/**
 * @openapi
 * /api/warp-beams/mounted/{machineId}:
 *   get:
 *     tags: [WarpBeams]
 *     summary: Makinede şu an bağlı leventler (yuva sırasıyla, kalan m) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste (bayrak kapalıysa boş) }
 */
router.get("/mounted/:machineId", requireAnyPermission("warpbeam:read", ...MOBILE_DEVERE, ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    res.json(await listMountedOnMachine(assertValidUuid(req.params.machineId, "machineId")));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/mount:
 *   post:
 *     tags: [WarpBeams]
 *     summary: Leventi tezgaha TAK (READY → MOUNTED; makine + yuva; yöntem bayrakla zorunlu) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Takıldı (warnings — yarım levent · yöntem önerisi) }
 *       400: { description: WARP_BEAM_MACHINE_NOT_LOOM · WARP_SLOT_OUT_OF_RANGE · WARP_MOUNT_METHOD_REQUIRED }
 *       409: { description: WARP_MOUNT_TRACKING_OFF · WARP_BEAM_STATE · WARP_SLOT_BUSY }
 */
router.post("/:id/mount", requireAnyPermission("warpbeam:write", ...MOBILE_DEVERE), async (req, res, next) => {
  try {
    res.json(await mountBeam(assertValidUuid(req.params.id, "id"), mountSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/dismount:
 *   post:
 *     tags: [WarpBeams]
 *     summary: Leventi tezgahtan SÖK (MOUNTED → READY; ölçülen kalan verildiyse fark önce kapanır) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Söküldü (warnings — açık koşumda eksik yuva) }
 *       409: { description: WARP_MOUNT_TRACKING_OFF · WARP_BEAM_STATE · WARP_DISMOUNT_OPEN_RUN }
 */
router.post("/:id/dismount", requireAnyPermission("warpbeam:write", ...MOBILE_DEVERE, ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    res.json(await dismountBeam(assertValidUuid(req.params.id, "id"), dismountSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/consume:
 *   post:
 *     tags: [WarpBeams]
 *     summary: Elle TÜKETİM (CONSUMED; READY ya da MOUNTED; kalanı aşamaz) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yazıldı }
 *       409: { description: WARP_MOUNT_TRACKING_OFF · WARP_BEAM_STATE · WARP_BEAM_REMAINING_EXCEEDED }
 */
router.post("/:id/consume", requireAnyPermission("warpbeam:write", ...MOBILE_DEVERE, ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    res.json(await consumeBeam(assertValidUuid(req.params.id, "id"), consumeSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/adjust:
 *   post:
 *     tags: [WarpBeams]
 *     summary: Kalan DÜZELTME (ADJUST_IN / ADJUST_OUT; sebep kataloğu WARP_BEAM_ADJUST zorunlu) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Yazıldı }
 *       400: { description: REASON_CODE_REQUIRED · REASON_CODE_INVALID }
 *       409: { description: WARP_MOUNT_TRACKING_OFF · WARP_BEAM_STATE · WARP_BEAM_REMAINING_EXCEEDED }
 */
router.post("/:id/adjust", requireAnyPermission("warpbeam:write", ...MOBILE_DEVERE), async (req, res, next) => {
  try {
    res.json(await adjustBeam(assertValidUuid(req.params.id, "id"), adjustSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/exhaust:
 *   post:
 *     tags: [WarpBeams]
 *     summary: Levent BİTTİ (→ EXHAUSTED, terminal; artık beyan · tartı · 0; fark önce kapanır) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bitti (warnings — açık koşum · tartıdan metre türetilemedi) }
 *       409: { description: WARP_MOUNT_TRACKING_OFF · WARP_BEAM_STATE · WARP_DISMOUNT_OPEN_RUN }
 */
router.post("/:id/exhaust", requireAnyPermission("warpbeam:write", ...MOBILE_DEVERE, ...MOBILE_DOKUMA), async (req, res, next) => {
  try {
    res.json(await exhaustBeam(assertValidUuid(req.params.id, "id"), exhaustSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/scrap-preview:
 *   get:
 *     tags: [WarpBeams]
 *     summary: HURDA önizleme — kalan m, tezgah/yuva, makinedeki açık koşum sayısı — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Önizleme }
 */
router.get("/:id/scrap-preview", requireAnyPermission("warpbeam:cancel", ...MOBILE_DEVERE_IPTAL), async (req, res, next) => {
  try {
    res.json(await scrapPreview(assertValidUuid(req.params.id, "id")));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/scrap:
 *   post:
 *     tags: [WarpBeams]
 *     summary: HURDA (→ SCRAPPED, terminal; lengthM = kalan; sebep WARP_BEAM_SCRAP zorunlu) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hurdaya ayrıldı }
 *       400: { description: REASON_CODE_REQUIRED · REASON_CODE_INVALID }
 *       409: { description: WARP_MOUNT_TRACKING_OFF · WARP_BEAM_STATE · WARP_DISMOUNT_OPEN_RUN }
 */
router.post("/:id/scrap", requireAnyPermission("warpbeam:cancel", ...MOBILE_DEVERE_IPTAL), async (req, res, next) => {
  try {
    res.json(await scrapBeam(assertValidUuid(req.params.id, "id"), scrapSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/events/{eventId}/cancel:
 *   post:
 *     tags: [WarpBeams]
 *     summary: DURUM olayını geri al — LIFO (yalnız en yeni aktif MOUNTED/DISMOUNTED/EXHAUSTED/SCRAPPED); tipli *_CANCEL — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri alındı (yuvaya dönüşte yuva boş olmalı) }
 *       400: { description: WARP_BEAM_CANCEL_KIND (WOUND/SHIP_OUT/RETURNED_IN kendi ucundan) }
 *       409: { description: WARP_BEAM_CANCEL_NOT_LAST · WARP_SLOT_BUSY · WARP_DISMOUNT_OPEN_RUN }
 */
router.post("/:id/events/:eventId/cancel", requireAnyPermission("warpbeam:cancel", ...MOBILE_DEVERE_IPTAL), async (req, res, next) => {
  try {
    res.json(await cancelStatusEvent(assertValidUuid(req.params.id, "id"), assertValidUuid(req.params.eventId, "eventId"), cancelSchema.parse(req.body ?? {}).reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/consumed/{eventId}/cancel:
 *   post:
 *     tags: [WarpBeams]
 *     summary: TÜKETİMİ geri al (CONSUMED_CANCEL; LIFO'ya girmez) — Faz 3
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: WARP_BEAM_ALREADY_CANCELLED · WARP_BEAM_STATE }
 */
router.post("/:id/consumed/:eventId/cancel", requireAnyPermission("warpbeam:cancel", ...MOBILE_DEVERE_IPTAL), async (req, res, next) => {
  try {
    res.json(await cancelConsumed(assertValidUuid(req.params.id, "id"), assertValidUuid(req.params.eventId, "eventId"), cancelSchema.parse(req.body ?? {}).reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
