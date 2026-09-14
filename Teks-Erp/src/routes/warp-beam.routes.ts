// =============================================================================
// TeksERP — Levent (WarpBeam) Routes · devere Faz 1b
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDevereEnabled` → `requirePermission`.
// Jenerik `requireModule("…")` YASAK (bekçi middleware ADINI arar: `test_devere_regime_gate §6`).
// İzinler: `warpbeam:read` (liste/detay/önizleme) · `warpbeam:write` (plan · düzenle · sar · taslak sil)
// · `warpbeam:cancel` (sarım iptali — defterden NET iplik döner, ayrı yetenek).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { WarpBeamOrigin, WarpBeamStatus, WarpKgSource } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { readFilterList } from "../utils/query-parser";
import { createWarpBeam, deleteWarpBeamDraft, getWarpBeam, listDevereMachines, listWarpBeams, updateWarpBeam } from "../services/warp-beam.service";
import { cancelWound, cancelWoundPreview, windWarpBeam } from "../services/warp-beam-wind.service";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDevereEnabled);

const uuidOrNull = z.string().uuid().nullable().optional();
const qty = z.union([z.number(), z.string().min(1)]);

const createSchema = z
  .object({
    warpSpecId: z.string().uuid(),
    plannedLengthM: qty,
    originKind: z.nativeEnum(WarpBeamOrigin),
    subcontractorId: uuidOrNull,
    supplierId: uuidOrNull,
    physicalBeamNo: z.string().max(32).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    clientToken: z.string().uuid().nullable().optional(),
  })
  .strict();
const updateSchema = createSchema.omit({ clientToken: true }).partial().strict();

const yarnLine = z.object({ warehouseId: z.string().uuid(), qtyKg: qty }).strict();
const windSchema = z
  .object({
    lengthM: qty,
    kgSource: z.nativeEnum(WarpKgSource),
    machineId: uuidOrNull,
    yarnIssues: z.array(yarnLine).max(50).optional(),
    yarnReturns: z.array(yarnLine.extend({ reasonCode: z.string().trim().min(1).max(64) })).max(50).optional(),
    sectionCount: z.number().int().positive().nullable().optional(),
    endsPerSection: z.number().int().positive().nullable().optional(),
    breakCount: z.number().int().min(0).nullable().optional(),
    startedAt: z.coerce.date().nullable().optional(),
    clientToken: z.string().uuid().nullable().optional(),
  })
  .strict();
const cancelSchema = z.object({ reason: z.string().trim().min(3, "Gerekçe en az 3 karakter").max(300) }).strict();

const listSchema = z
  .object({
    status: z.string().optional(),
    warpSpecId: z.string().uuid().optional(),
    originKind: z.nativeEnum(WarpBeamOrigin).optional(),
    search: z.string().max(100).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    withTotal: z.literal("true").optional(),
  })
  .strict();

/**
 * @openapi
 * /api/warp-beams:
 *   get:
 *     tags: [WarpBeams]
 *     summary: Levent listesi (cursor; süzme sunucuda — durum CSV · çözgü kartı · köken · arama)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("warpbeam:read"), async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const status = readFilterList(q.status).filter((s): s is WarpBeamStatus => (Object.values(WarpBeamStatus) as string[]).includes(s));
    res.json(await listWarpBeams({ status, warpSpecId: q.warpSpecId, originKind: q.originKind, search: q.search, cursor: q.cursor, limit: q.limit, withTotal: q.withTotal === "true" }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/devere-machines:
 *   get:
 *     tags: [WarpBeams]
 *     summary: Devere makineleri — `Station.producesWarpBeam` istasyonlarının aktif makineleri (sarım formu adayları)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Makine listesi }
 */
router.get("/devere-machines", requirePermission("warpbeam:read"), async (_req, res, next) => {
  try {
    res.json(await listDevereMachines());
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}:
 *   get:
 *     tags: [WarpBeams]
 *     summary: Levent detayı — olay defteri + iplik satırları + kalan metre
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Detay }
 *       404: { description: Levent yok }
 */
router.get("/:id", requirePermission("warpbeam:read"), async (req, res, next) => {
  try {
    res.json(await getWarpBeam(assertValidUuid(req.params.id, "id")));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams:
 *   post:
 *     tags: [WarpBeams]
 *     summary: Levent PLANLA (PLANNED) — köken aksiyon anında seçilir; numara sunucuda (LV+GGAAYY+NNNN); clientToken replay
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Planlandı }
 *       400: { description: Köken/taraf XOR (WARP_BEAM_ORIGIN_PARTY) · çözgü kartı pasif }
 */
router.post("/", requirePermission("warpbeam:write"), async (req, res, next) => {
  try {
    res.status(201).json(await createWarpBeam(createSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}:
 *   patch:
 *     tags: [WarpBeams]
 *     summary: Plan düzenle — yalnız PLANNED (sarılmış levent salt-okunur)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: WARP_BEAM_NOT_PLANNED }
 */
router.patch("/:id", requirePermission("warpbeam:write"), async (req, res, next) => {
  try {
    res.json(await updateWarpBeam(assertValidUuid(req.params.id, "id"), updateSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}:
 *   delete:
 *     tags: [WarpBeams]
 *     summary: Taslağı SİL — ④ sınıfı (deftere hiç yazmamış PLANNED levent); sarılmış levent iptal edilir, silinmez
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Silindi }
 *       409: { description: WARP_BEAM_NOT_PLANNED }
 */
router.delete("/:id", requirePermission("warpbeam:write"), async (req, res, next) => {
  try {
    res.json(await deleteWarpBeamDraft(assertValidUuid(req.params.id, "id"), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/wind:
 *   post:
 *     tags: [WarpBeams]
 *     summary: SAR (PLANNED → READY, WOUND) — IN_HOUSE'da makine + brüt iplik çıkışı (WARP_ISSUE) + dip iadesi (WARP_RETURN, sebep zorunlu) AYNI tx'te
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sarıldı }
 *       400: { description: Makine devere değil · denye boş · iplik satırı eksik/fazla · REASON_CODE_INVALID }
 *       409: { description: WARP_BEAM_STATE (PLANNED değil) · iplik eksi bakiye }
 */
router.post("/:id/wind", requirePermission("warpbeam:write"), async (req, res, next) => {
  try {
    res.json(await windWarpBeam(assertValidUuid(req.params.id, "id"), windSchema.parse(req.body ?? {}), req.user?.userId));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/cancel-preview:
 *   get:
 *     tags: [WarpBeams]
 *     summary: Sarım iptali ÖNİZLEME — depoya dönecek iplik (kalem × depo, net) ve düşecek dip iadeleri (× sebep)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Önizleme }
 */
router.get("/:id/cancel-preview", requirePermission("warpbeam:cancel"), async (req, res, next) => {
  try {
    res.json(await cancelWoundPreview(assertValidUuid(req.params.id, "id")));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/warp-beams/{id}/cancel:
 *   post:
 *     tags: [WarpBeams]
 *     summary: Sarımı İPTAL ET (READY → CANCELLED, WOUND_CANCEL tek ters) — iplik NET geri (WARP_ISSUE_REVERSAL / WARP_RETURN_REVERSAL)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: WARP_BEAM_STATE · WARP_BEAM_NOT_WOUND · çift iptal (reversesEventId unique) }
 */
router.post("/:id/cancel", requirePermission("warpbeam:cancel"), async (req, res, next) => {
  try {
    res.json(await cancelWound(assertValidUuid(req.params.id, "id"), cancelSchema.parse(req.body ?? {}).reason, req.user?.userId));
  } catch (e) {
    next(e);
  }
});

export default router;
