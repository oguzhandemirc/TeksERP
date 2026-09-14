// =============================================================================
// TeksERP — TEZGAH KÜNYESİ (MachineSpec) uçları · gölge mod durum makinesi (B3)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` → `loom:spec-manage`.
// Tasarım §2.3 `/api/tezgah/specs` + `requireTezgahEnabled` der; o kapı ekransız doğamaz
// (`test_screen_catalog §10b`) ⇒ router bugün dokuma kapısında (`/api/machine-specs`),
// Faz 2 ingest "Devreye Alma" ekranıyla `requireTezgahEnabled`e taşınır (tek satır).
// Künye gövdesi ALLOWLIST'tir: `monitoringState`/damgalar yalnız kendi uçlarıyla değişir.
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { demoteToShadow, getMachineSpec, goLive, startShadow, upsertMachineSpec } from "../services/machine-spec.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);
const guard = requirePermission("loom:spec-manage");

const upsertSchema = z
  .object({
    shedType: z.enum(["ARMUR", "JAKAR", "KAM"]).nullable().optional(),
    nominalUnitsPerMin: z.coerce.number().int().positive().max(10_000).nullable().optional(),
    baselineRunHours: z.coerce.number().min(0).max(9_999_999).nullable().optional(),
    baselineAt: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict(); // `monitoringState` · `acceptedAt` · `demotedAt` … burada YOK — gövdeden yazılamaz (400)

/**
 * @openapi
 * /api/machine-specs/{machineId}:
 *   get:
 *     tags: [MachineSpecs]
 *     summary: Tezgah künyesi (izleme hâli dahil)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Künye }
 *       404: { description: Künye yok }
 *   put:
 *     tags: [MachineSpecs]
 *     summary: Künye oluştur/güncelle — allowlist (shedType · nominalUnitsPerMin · baselineRunHours/At · notes); izleme hâli gövdeden YAZILAMAZ
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Künye }
 *       400: { description: Tanınmayan alan (monitoringState vb.) ya da pasif makine }
 */
router.get("/:machineId", guard, async (req, res, next) => {
  try { res.json(await getMachineSpec(assertValidUuid(req.params.machineId, "machineId"))); } catch (e) { next(e); }
});
router.put("/:machineId", guard, async (req, res, next) => {
  try {
    res.json(await upsertMachineSpec(assertValidUuid(req.params.machineId, "machineId"), upsertSchema.parse(req.body), req.user?.userId));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/machine-specs/{machineId}/shadow:
 *   post:
 *     tags: [MachineSpecs]
 *     summary: OFF → SHADOW (atomik claim) — gölge mod başlar
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Gölge mod }
 *       409: { description: SPEC_NOT_OFF }
 */
router.post("/:machineId/shadow", guard, async (req, res, next) => {
  try { res.json(await startShadow(assertValidUuid(req.params.machineId, "machineId"), req.user?.userId)); } catch (e) { next(e); }
});

const noteSchema = z.object({ note: z.string().trim().max(300).nullable().optional() }).strict();
/**
 * @openapi
 * /api/machine-specs/{machineId}/go-live:
 *   post:
 *     tags: [MachineSpecs]
 *     summary: SHADOW → LIVE — üç şart (SHADOW_TOO_SHORT · SIGNAL_NOT_ACCEPTED · anomali); sinyal kabulü Faz 2 ile açılır, bugün LIVE erişilemez (beyanlı kapı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: LIVE }
 *       409: { description: SPEC_NOT_SHADOW · SHADOW_TOO_SHORT · SIGNAL_NOT_ACCEPTED }
 */
router.post("/:machineId/go-live", guard, async (req, res, next) => {
  try {
    const b = noteSchema.parse(req.body ?? {});
    res.json(await goLive(assertValidUuid(req.params.machineId, "machineId"), req.user?.userId, b.note ?? null));
  } catch (e) { next(e); }
});

const demoteSchema = z.object({ reason: z.string().trim().min(3, "Gerekçe en az 3 karakter").max(300) }).strict();
/**
 * @openapi
 * /api/machine-specs/{machineId}/demote:
 *   post:
 *     tags: [MachineSpecs]
 *     summary: LIVE → SHADOW sebepli demote; acceptedAt kalır
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Gölge mod }
 *       409: { description: SPEC_NOT_LIVE }
 */
router.post("/:machineId/demote", guard, async (req, res, next) => {
  try {
    const b = demoteSchema.parse(req.body);
    res.json(await demoteToShadow(assertValidUuid(req.params.machineId, "machineId"), b.reason, req.user?.userId));
  } catch (e) { next(e); }
});

export default router;
