// =============================================================================
// TeksERP — TEZGAH ALARMI uçları (`/api/loom-alarms`, dokuma alarm Faz A1b)
// =============================================================================
// ⚠️ DÖRT KAPI SIRAYLA: `verifyToken` → `requireTezgahEnabled` → alarm bayrağı
// (`resolveTezgahAlarmEnabled`; kapalı → 403 `LOOM_ALARM_DISABLED`) → izin. Bayrak kapalı = bugünkü
// davranış: uçlar da kapalıdır. Görmek `loom:alarm-view`, eylem `loom:alarm-ack`; başkasının
// üstlenmesini bırakmak ayrıca `loom:alarm-escalation` (üst kademe yetkilisi).
// Panel/tablet yüzeyi ayrı dilimdir (A2/A3); izinler SCREENLESS gerekçeli.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireTezgahEnabled } from "../middlewares/module.middleware";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { resolveTezgahAlarmEnabled } from "../services/system-setting.service";
import {
  ALARM_SNOOZE_MINUTES,
  ackLoomAlarm,
  noteLoomAlarm,
  releaseLoomAlarm,
  retractLoomAlarmNote,
  snoozeLoomAlarm,
  unsnoozeLoomAlarm,
} from "../services/loom-alarm.service";
import { LOOM_ALARM_SCOPES, getLoomAlarmDetail, listLoomAlarms } from "../services/loom-alarm-read.service";
import { AppError } from "../utils/app-error";
import { settingRowPath } from "../constants/panel-ayar-yolu";

/** Alarm bayrağı kapısı — tezgah modülü (lisans tavanı dahil) ∧ `tezgah.alarmEnabled`. */
export async function requireLoomAlarmEnabled(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!(await resolveTezgahAlarmEnabled())) {
      throw AppError.forbidden(`Tezgah alarmı bu kurulumda kapalı. ${settingRowPath("tezgahAlarmEnabled")} ayarından açılabilir.`, { code: "LOOM_ALARM_DISABLED" });
    }
    next();
  } catch (e) {
    next(e);
  }
}

const router = Router();
router.use(verifyToken, requireTezgahEnabled, requireLoomAlarmEnabled);

const VIEW = requirePermission("loom:alarm-view");
const ACT = requirePermission("loom:alarm-ack");

const userIdOf = (req: Request): string => {
  const id = req.user?.userId;
  if (!id) throw AppError.unauthorized("Oturum bulunamadı");
  return id;
};

const idList = z.union([z.string(), z.array(z.string())]).optional();
const listSchema = z
  .object({
    scope: z.enum(LOOM_ALARM_SCOPES).default("active"),
    machineId: idList,
    stationId: idList,
    reasonCode: idList,
    tier: z.enum(["1", "2"]).transform((v) => Number(v) as 1 | 2).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Geçersiz başlangıç tarihi").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Geçersiz bitiş tarihi").optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

/**
 * @openapi
 * /api/loom-alarms:
 *   get:
 *     tags: [LoomAlarms]
 *     summary: Tezgah alarmları — aktif / geçmiş liste (cursor) + aynı süzgeçten özet şeridi
 *     description: >
 *       `scope` active (varsayılan) · history · all; tanınmayan kapsam 400. Süzgeç: machineId · stationId (hol) ·
 *       reasonCode (CSV ya da tekrar) · tier · from/to (oluşma günü, fabrika saati). Özet şeridi cursor hariç aynı where'den.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "items · nextCursor · summary (total · open · acked · resolved · cancelled · escalated)" }
 *       400: { description: Geçersiz kapsam / süzgeç / imleç }
 *       403: { description: MODULE_DISABLED (tezgah) · LOOM_ALARM_DISABLED · loom:alarm-view yok }
 */
router.get("/", VIEW, async (req, res, next) => {
  try {
    res.json({ success: true, data: await listLoomAlarms(listSchema.parse(req.query)) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/loom-alarms/{id}:
 *   get:
 *     tags: [LoomAlarms]
 *     summary: Alarm sayfası — başlık, zaman çizgisi (defterden), bağlam, benzer duruşlar, son duruşlar
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "alarm · nextDueAt · timeline · context · similar · recentStops" }
 *       404: { description: LOOM_ALARM_NOT_FOUND }
 */
router.get("/:id", VIEW, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getLoomAlarmDetail(assertValidUuid(req.params.id, "id")) });
  } catch (e) {
    next(e);
  }
});

const tokenOnly = z.object({ clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish() }).strict();

/**
 * @openapi
 * /api/loom-alarms/{id}/ack:
 *   post:
 *     tags: [LoomAlarms]
 *     summary: Alarmı ÜSTLEN (tek kişi; atomik claim) — `clientToken` idempotent
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Üstlenildi (ya da aynı token'ın yeniden gönderimi) }
 *       409: { description: "LOOM_ALARM_ALREADY_ACKED (kim, saat) · LOOM_ALARM_CLOSED · CLIENT_TOKEN_COLLISION · CLIENT_TOKEN_REVOKED" }
 */
router.post("/:id/ack", ACT, async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = tokenOnly.parse(req.body ?? {});
    res.json(await ackLoomAlarm(id, userIdOf(req), b.clientToken));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/loom-alarms/{id}/release:
 *   post:
 *     tags: [LoomAlarms]
 *     summary: Üstlenmeyi BIRAK (karşı olay) — başkasınınkini yalnız loom:alarm-escalation
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bırakıldı }
 *       403: { description: LOOM_ALARM_ACKED_BY_OTHER }
 *       409: { description: LOOM_ALARM_NOT_ACKED · LOOM_ALARM_CLOSED · LOOM_ALARM_STALE }
 */
router.post("/:id/release", ACT, async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = tokenOnly.parse(req.body ?? {});
    const canReleaseOthers = matchesPermission(req.user?.permissions ?? [], "loom:alarm-escalation");
    res.json(await releaseLoomAlarm(id, userIdOf(req), { clientToken: b.clientToken, canReleaseOthers }));
  } catch (e) {
    next(e);
  }
});

const snoozeSchema = z
  .object({
    minutes: z.number().int().refine((m) => (ALARM_SNOOZE_MINUTES as readonly number[]).includes(m), `Susturma süresi ${ALARM_SNOOZE_MINUTES.join(" / ")} dakikadan biri olmalı`),
    note: z.string().trim().max(500).nullish(),
    clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish(),
  })
  .strict();

/**
 * @openapi
 * /api/loom-alarms/{id}/snooze:
 *   post:
 *     tags: [LoomAlarms]
 *     summary: Alarmı SUSTUR (15/30/60 dk) — yalnız tekrar-çalmayı keser, üst kademeyi durdurmaz
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Susturuldu }
 *       400: { description: Geçersiz süre }
 *       409: { description: LOOM_ALARM_CLOSED }
 */
router.post("/:id/snooze", ACT, async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = snoozeSchema.parse(req.body ?? {});
    res.json(await snoozeLoomAlarm(id, userIdOf(req), { minutes: b.minutes as 15 | 30 | 60, note: b.note, clientToken: b.clientToken }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/loom-alarms/{id}/unsnooze:
 *   post:
 *     tags: [LoomAlarms]
 *     summary: Susturmayı KALDIR (karşı olay)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kaldırıldı }
 *       409: { description: LOOM_ALARM_NOT_SNOOZED · LOOM_ALARM_CLOSED }
 */
router.post("/:id/unsnooze", ACT, async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = tokenOnly.parse(req.body ?? {});
    res.json(await unsnoozeLoomAlarm(id, userIdOf(req), b.clientToken));
  } catch (e) {
    next(e);
  }
});

const noteSchema = z
  .object({
    note: z.string().trim().min(1, "Not boş olamaz").max(500),
    clientToken: z.string().uuid("Geçersiz istemci anahtarı").nullish(),
  })
  .strict();

/**
 * @openapi
 * /api/loom-alarms/{id}/notes:
 *   post:
 *     tags: [LoomAlarms]
 *     summary: Alarma NOT ekle (silinmez, değişmez; geri çekme ayrı satır)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Not eklendi }
 *       404: { description: LOOM_ALARM_NOT_FOUND }
 */
router.post("/:id/notes", ACT, async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const b = noteSchema.parse(req.body ?? {});
    res.json(await noteLoomAlarm(id, userIdOf(req), { note: b.note, clientToken: b.clientToken }));
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/loom-alarms/{id}/notes/{eventId}/retract:
 *   post:
 *     tags: [LoomAlarms]
 *     summary: Notu GERİ ÇEK (yalnız not sahibi, not başına bir kez)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Geri çekildi }
 *       400: { description: LOOM_ALARM_NOTE_INVALID }
 *       403: { description: LOOM_ALARM_NOTE_NOT_OWNER }
 *       409: { description: LOOM_ALARM_NOTE_ALREADY_RETRACTED }
 */
router.post("/:id/notes/:eventId/retract", ACT, async (req, res, next) => {
  try {
    const id = assertValidUuid(req.params.id, "id");
    const eventId = assertValidUuid(req.params.eventId, "eventId");
    const b = tokenOnly.parse(req.body ?? {});
    res.json(await retractLoomAlarmNote(id, userIdOf(req), { eventId, clientToken: b.clientToken }));
  } catch (e) {
    next(e);
  }
});

export default router;
