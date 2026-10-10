// =============================================================================
// TeksERP — VARDİYA TANIMI (ShiftDefinition) uçları · dokuma modülü
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` → izin. Yazma `loom:spec-manage`
// (tasarım §6.4: "vardiya kataloğu"); liste rapor süzgeci için `report:production` ile de okunur.
// Gövde `.strict()` ALLOWLIST: `code` yalnız doğuşta, `isActive` yalnız arşiv/geri al uçlarından,
// `nameFold` DB'nin — BaseController yolu bilerek kullanılmaz (yeni skaler = yazılabilir alan tuzağı).
// =============================================================================
import { Router } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import {
  createShiftDefinition,
  listShiftDefinitions,
  previewShiftDefinition,
  setShiftDefinitionActive,
  updateShiftDefinition,
} from "../services/shift-definition.service";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);
const manage = requirePermission("loom:spec-manage");

const minute = (label: string, max: number) => z.coerce.number({ message: `${label} sayı olmalı` }).int(`${label} tam sayı olmalı`).min(0).max(max);
const fields = {
  name: z.string().trim().min(1, "Vardiya adı zorunlu").max(100, "Vardiya adı en fazla 100 karakter"),
  startMinute: minute("Başlangıç", 1439),
  durationMinutes: minute("Süre", 1440),
  plannedBreakMinutes: minute("Mola", 1439),
  activeWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
  sortOrder: z.coerce.number().int().min(-9999).max(9999),
};
export const shiftDefinitionCreateSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, "Kod 1–8 karakter, yalnız harf (A–Z) ve rakam"),
    ...fields,
    plannedBreakMinutes: fields.plannedBreakMinutes.default(0),
    activeWeekdays: fields.activeWeekdays.default([]),
    sortOrder: fields.sortOrder.default(0),
  })
  .strict();
export const shiftDefinitionUpdateSchema = z.object(fields).partial().strict(); // `code` · `isActive` burada YOK → 400
const previewSchema = z
  .object({
    id: z.string().uuid().nullable().optional(),
    startMinute: fields.startMinute.optional(),
    durationMinutes: fields.durationMinutes.optional(),
    activeWeekdays: fields.activeWeekdays.optional(),
    active: z.boolean().optional(),
  })
  .strict();

/**
 * @openapi
 * /api/shift-definitions:
 *   get:
 *     tags: [ShiftDefinitions]
 *     summary: Vardiya tanımları (dokuma); `?includeInactive=1` arşivdekileri de getirir
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *   post:
 *     tags: [ShiftDefinitions]
 *     summary: Vardiya tanımı oluştur; takvim (30 gün ileri) aynı istekte tetiklenir
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu (data.calendar = takvim özeti) }
 *       400: { description: Geçersiz pencere / tanınmayan alan }
 *       409: { description: SHIFT_CODE_TAKEN · SHIFT_NAME_TAKEN }
 */
router.get("/", requireAnyPermission("loom:spec-manage", "report:production"), async (req, res, next) => {
  try {
    const inc = String(req.query.includeInactive ?? "");
    res.json(await listShiftDefinitions({ includeInactive: inc === "1" || inc === "true" }));
  } catch (e) { next(e); }
});
router.post("/", manage, async (req, res, next) => {
  try { res.status(201).json(await createShiftDefinition(shiftDefinitionCreateSchema.parse(req.body), req.user?.userId)); } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/shift-definitions/preview:
 *   post:
 *     tags: [ShiftDefinitions]
 *     summary: Önizleme — önerilen tanım/arşiv/geri al takvimde hangi pencereyi doğurur, değiştirir, iptal eder (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "create · rewrite · retire · kept listeleri" }
 */
// ⚠️ `/:id`den ÖNCE: sonra gelirse Express "preview"i id sanar.
router.post("/preview", manage, async (req, res, next) => {
  try {
    const { id, ...proposed } = previewSchema.parse(req.body ?? {});
    res.json(await previewShiftDefinition(id ?? null, proposed));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/shift-definitions/{id}:
 *   patch:
 *     tags: [ShiftDefinitions]
 *     summary: Vardiya tanımını güncelle — kod değişmez; yalnız başlamamış ve mühürsüz pencereler yeni kurala çekilir
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 *       409: { description: SHIFT_DEFINITION_ARCHIVED · SHIFT_NAME_TAKEN }
 */
router.patch("/:id", manage, async (req, res, next) => {
  try {
    res.json(await updateShiftDefinition(assertValidUuid(req.params.id, "id"), shiftDefinitionUpdateSchema.parse(req.body), req.user?.userId));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/shift-definitions/{id}/archive:
 *   post:
 *     tags: [ShiftDefinitions]
 *     summary: Arşivle (isActive false) — başlamamış pencereleri takvim sebebiyle iptal edilir; geçmiş/başlamış/mühürlü değişmez
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Arşivlendi }
 *       409: { description: SHIFT_DEFINITION_ARCHIVED }
 */
router.post("/:id/archive", manage, async (req, res, next) => {
  try { res.json(await setShiftDefinitionActive(assertValidUuid(req.params.id, "id"), false, req.user?.userId)); } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/shift-definitions/{id}/restore:
 *   post:
 *     tags: [ShiftDefinitions]
 *     summary: Arşivden geri al — takvim iptali dirilir, eksik gelecek pencereler doğar
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Geri alındı }
 *       409: { description: SHIFT_DEFINITION_ACTIVE }
 */
router.post("/:id/restore", manage, async (req, res, next) => {
  try { res.json(await setShiftDefinitionActive(assertValidUuid(req.params.id, "id"), true, req.user?.userId)); } catch (e) { next(e); }
});

export default router;
