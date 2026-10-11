// =============================================================================
// TeksERP — TEZGAH ALARMI SORUMLULARI uçları (`/api/loom-alarm-duty`, dokuma alarm A4)
// =============================================================================
// ⚠️ DÖRT KAPI SIRAYLA: `verifyToken` → `requireTezgahEnabled` → alarm bayrağı (`requireLoomAlarmEnabled`)
// → `loom:spec-manage` (tasarım §A.9: kademe/kural ayarı mevcut tezgah ayar yetkisiyle; yeni izin kodu yok).
// Gövdeler `.strict()` ALLOWLIST: `createdById`/`revokedAt`/`revokedById` gövdeden yazılamaz.
// =============================================================================
import { Router, type Request } from "express";
import { z } from "zod";
import { LoomAlarmRuleRecipientKind } from "@prisma/client";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireTezgahEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { requireLoomAlarmEnabled } from "./loom-alarm.routes";
import {
  createHallShiftDutyOverride,
  createHallShiftResponsible,
  createLoomAlarmTierRule,
  getLoomAlarmDutyOverview,
  listDutyCandidates,
  listDutyShiftInstances,
  revokeHallShiftDutyOverride,
  revokeHallShiftResponsible,
  revokeLoomAlarmTierRule,
} from "../services/loom-alarm-duty.service";
import { AppError } from "../utils/app-error";

const router = Router();
router.use(verifyToken, requireTezgahEnabled, requireLoomAlarmEnabled, requirePermission("loom:spec-manage"));

const userIdOf = (req: Request): string => {
  const id = req.user?.userId;
  if (!id) throw AppError.unauthorized("Oturum bulunamadı");
  return id;
};

const uuid = (label: string) => z.string().uuid(`Geçersiz ${label}`);
const tier = z.union([z.literal(1), z.literal(2)], { message: "Kademe 1 ya da 2 olmalı" });
const clientToken = z.string().uuid("Geçersiz istemci anahtarı");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı");

export const responsibleSchema = z.object({ stationId: uuid("hol"), shiftDefinitionId: uuid("vardiya"), tier, userId: uuid("kişi"), clientToken }).strict();
export const overrideSchema = z
  .object({ shiftInstanceId: uuid("vardiya penceresi"), stationId: uuid("hol"), tier, userId: uuid("kişi"), note: z.string().max(300, "Not en fazla 300 karakter").nullish(), clientToken })
  .strict();
export const ruleSchema = z
  .object({
    tier,
    kind: z.nativeEnum(LoomAlarmRuleRecipientKind, { message: "Alıcı türü HALL_SHIFT · USER · PERMISSION olmalı" }),
    userId: uuid("kişi").nullish(),
    permissionCode: z.string().max(64).nullish(),
    clientToken,
  })
  .strict();
const emptyBody = z.object({}).strict();
const shiftQuery = z.object({ from: day.optional(), to: day.optional() }).strict();

/**
 * @openapi
 * /api/loom-alarm-duty:
 *   get:
 *     tags: [LoomAlarmDuty]
 *     summary: Alarm sorumluları — hol × vardiya sorumluları, nöbet değişiklikleri (son 7 gün + ileri), kademe kuralları, uyarılar
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "responsibles · overrides · rules · warnings (alarmı göremeyen atanmış kişiler)" }
 *       403: { description: MODULE_DISABLED (tezgah) · LOOM_ALARM_DISABLED · loom:spec-manage yok }
 */
router.get("/", async (_req, res, next) => {
  try {
    res.json({ success: true, data: await getLoomAlarmDutyOverview() });
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/candidates:
 *   get:
 *     tags: [LoomAlarmDuty]
 *     summary: Atanabilir kişiler (aktif) + alarm görme / üst kademe yetkisi
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ id, name, canViewAlarms, canEscalate }]" }
 */
router.get("/candidates", async (_req, res, next) => {
  try {
    res.json({ success: true, data: await listDutyCandidates() });
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/shift-instances:
 *   get:
 *     tags: [LoomAlarmDuty]
 *     summary: Nöbet değişikliği için vardiya pencereleri (from/to fabrika günü; varsayılan bugün + 7 gün, en çok 62 gün)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ id, shiftDefinition, factoryDayKey, startsAt, endsAt, isCancelled, ended }]" }
 *       400: { description: Geçersiz tarih / aralık }
 */
router.get("/shift-instances", async (req, res, next) => {
  try {
    res.json({ success: true, data: await listDutyShiftInstances(shiftQuery.parse(req.query)) });
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/responsibles:
 *   post:
 *     tags: [LoomAlarmDuty]
 *     summary: Hol × vardiya × kademe sorumlusu ata — `clientToken` idempotent; alarmı göremeyen kişi → 201 + warnings
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Atandı (ya da aynı token'ın yeniden gönderimi) }
 *       400: { description: "DUTY_HALL_INVALID · DUTY_SHIFT_INVALID · DUTY_USER_INVALID · tanınmayan alan" }
 *       409: { description: "DUTY_ALREADY_ASSIGNED · CLIENT_TOKEN_COLLISION · CLIENT_TOKEN_REVOKED" }
 */
router.post("/responsibles", async (req, res, next) => {
  try {
    res.status(201).json(await createHallShiftResponsible(responsibleSchema.parse(req.body ?? {}), userIdOf(req)));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/responsibles/{id}/revoke:
 *   post:
 *     tags: [LoomAlarmDuty]
 *     summary: Sorumlu atamasını kaldır (silinmez; geçmiş alarmın alıcısı değişmez)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       404: { description: DUTY_NOT_FOUND }
 *       409: { description: DUTY_ALREADY_REVOKED }
 */
router.post("/responsibles/:id/revoke", async (req, res, next) => {
  try {
    emptyBody.parse(req.body ?? {});
    res.json(await revokeHallShiftResponsible(assertValidUuid(req.params.id, "id"), userIdOf(req)));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/overrides:
 *   post:
 *     tags: [LoomAlarmDuty]
 *     summary: Nöbet değişikliği — tek vardiya penceresinde hol × kademe listesinin yerine geçer; bitmiş vardiyaya yazılmaz
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Kaydedildi (ya da aynı token'ın yeniden gönderimi) }
 *       400: { description: "SHIFT_INSTANCE_ENDED · SHIFT_INSTANCE_CANCELLED · SHIFT_INSTANCE_NOT_FOUND · DUTY_HALL_INVALID · DUTY_USER_INVALID" }
 *       409: { description: "DUTY_ALREADY_ASSIGNED · CLIENT_TOKEN_COLLISION · CLIENT_TOKEN_REVOKED" }
 */
router.post("/overrides", async (req, res, next) => {
  try {
    res.status(201).json(await createHallShiftDutyOverride(overrideSchema.parse(req.body ?? {}), userIdOf(req)));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/overrides/{id}/revoke:
 *   post:
 *     tags: [LoomAlarmDuty]
 *     summary: Nöbet değişikliğini kaldır — yalnız bitmemiş vardiyada
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       404: { description: DUTY_NOT_FOUND }
 *       409: { description: "DUTY_ALREADY_REVOKED · SHIFT_INSTANCE_ENDED" }
 */
router.post("/overrides/:id/revoke", async (req, res, next) => {
  try {
    emptyBody.parse(req.body ?? {});
    res.json(await revokeHallShiftDutyOverride(assertValidUuid(req.params.id, "id"), userIdOf(req)));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/rules:
 *   post:
 *     tags: [LoomAlarmDuty]
 *     summary: Kademe kuralı ekle — HALL_SHIFT (holün vardiya sorumlusu) · USER (kişi) · PERMISSION (yetki koduna sahip herkes)
 *     description: Kademede hiç kural yoksa örtük kural holün vardiya sorumlusudur; çözüm boşsa yetkisi olan herkese (bugünkü davranış).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Eklendi (ya da aynı token'ın yeniden gönderimi) }
 *       400: { description: "DUTY_RULE_INVALID · DUTY_USER_INVALID" }
 *       409: { description: "DUTY_ALREADY_ASSIGNED · CLIENT_TOKEN_COLLISION · CLIENT_TOKEN_REVOKED" }
 */
router.post("/rules", async (req, res, next) => {
  try {
    res.status(201).json(await createLoomAlarmTierRule(ruleSchema.parse(req.body ?? {}), userIdOf(req)));
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/loom-alarm-duty/rules/{id}/revoke:
 *   post:
 *     tags: [LoomAlarmDuty]
 *     summary: Kademe kuralını kaldır
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       404: { description: DUTY_NOT_FOUND }
 *       409: { description: DUTY_ALREADY_REVOKED }
 */
router.post("/rules/:id/revoke", async (req, res, next) => {
  try {
    emptyBody.parse(req.body ?? {});
    res.json(await revokeLoomAlarmTierRule(assertValidUuid(req.params.id, "id"), userIdOf(req)));
  } catch (e) { next(e); }
});

export default router;
