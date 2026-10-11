// =============================================================================
// TeksERP — TEZGAH ALARMI · KİŞİ EYLEMLERİNİN YAZMAYAN PARÇALARI
// =============================================================================
// Replay politikası (`actionReplay`: kimlik alarm · tür · kişi · ayrıntı; 4. durum = ileri eylem
// sonradan geri alındı), sonuç biçimi ve count-0 tanısı için taze okuma. Defter satırını ve audit'i
// yalnız `loom-alarm.service` yazar; burada yazma yok.
// =============================================================================
import { LoomAlarmEventKind, LoomAlarmState, type Prisma } from "@prisma/client";
import { tokenReplay } from "./token-replay.helper";
import { AppError } from "../../utils/app-error";
import { factoryDateTimeTr } from "../../constants/time";
import type { ApiResponse } from "../../types/api.types";

type Tx = Prisma.TransactionClient;
const MIN_MS = 60_000;

/** Susturma seçenekleri (dk) — kapalı küme. */
export const ALARM_SNOOZE_MINUTES = [15, 30, 60] as const;
export type AlarmSnoozeMinutes = (typeof ALARM_SNOOZE_MINUTES)[number];

export interface LoomAlarmActionResult {
  alarmId: string;
  eventId: string;
  kind: LoomAlarmEventKind;
  state: LoomAlarmState;
  ackedById: string | null;
  ackedAt: Date | null;
  snoozedUntil: Date | null;
}

const ACTOR_PRIOR_SELECT = {
  id: true, alarmId: true, kind: true, userId: true, snoozedUntil: true, note: true, retractsEventId: true, createdAt: true,
  retractedBy: { select: { id: true } },
  alarm: { select: { state: true, ackedById: true, ackedAt: true, snoozedUntil: true, snoozedById: true } },
} satisfies Prisma.LoomAlarmEventSelect;
type ActorPrior = Prisma.LoomAlarmEventGetPayload<{ select: typeof ACTOR_PRIOR_SELECT }>;

const sameInstant = (a: Date | null, b: Date | null): boolean => a !== null && b !== null && a.getTime() === b.getTime();
export const hm = (at: Date): string => factoryDateTimeTr(at).slice(-5);

/** Kişi olayının "gövde ayrıntısı" — replay kimliğinin kinde özgü ayağı (susturma dk · not metni · geri çekilen not). */
function actorDetail(p: { kind: LoomAlarmEventKind; snoozedUntil: Date | null; createdAt: Date; note: string | null; retractsEventId: string | null }): string | null {
  if (p.kind === LoomAlarmEventKind.SNOOZE) return p.snoozedUntil ? String(Math.round((p.snoozedUntil.getTime() - p.createdAt.getTime()) / MIN_MS)) : null;
  if (p.kind === LoomAlarmEventKind.NOTE) return p.note;
  if (p.kind === LoomAlarmEventKind.NOTE_RETRACT) return p.retractsEventId;
  return null;
}

/** 4. durum: ileri eylem sonradan geri alındıysa replay başarı DÖNMEZ. */
function assertActorReplayAlive(p: ActorPrior): void {
  if (p.kind === LoomAlarmEventKind.ACK && !sameInstant(p.alarm.ackedAt, p.createdAt)) {
    throw AppError.conflict("Bu üstlenme sonradan bırakıldı — alarmı yeniden üstlenmek için ekranı yenileyin.", { code: "CLIENT_TOKEN_REVOKED", alarmId: p.alarmId });
  }
  if (p.kind === LoomAlarmEventKind.SNOOZE && !(p.alarm.snoozedById === p.userId && sameInstant(p.alarm.snoozedUntil, p.snoozedUntil))) {
    throw AppError.conflict("Bu susturma sonradan kaldırıldı ya da değişti — ekranı yenileyin.", { code: "CLIENT_TOKEN_REVOKED", alarmId: p.alarmId });
  }
  if (p.kind === LoomAlarmEventKind.NOTE && p.retractedBy !== null) {
    throw AppError.conflict("Bu not sonradan geri çekildi — ekranı yenileyin.", { code: "CLIENT_TOKEN_REVOKED", alarmId: p.alarmId });
  }
}

export function actorResult(eventId: string, kind: LoomAlarmEventKind, alarmId: string, a: { state: LoomAlarmState; ackedById: string | null; ackedAt: Date | null; snoozedUntil: Date | null }): LoomAlarmActionResult {
  return { alarmId, eventId, kind, state: a.state, ackedById: a.ackedById, ackedAt: a.ackedAt, snoozedUntil: a.snoozedUntil };
}

export interface ActorCall {
  alarmId: string;
  kind: LoomAlarmEventKind;
  userId: string;
  detail: string | null;
}

/** Kişi eylemlerinin TEK replay politikası (kimlik: alarm · tür · kişi · ayrıntı). */
export const actionReplay = (c: ActorCall) =>
  tokenReplay<ActorPrior, ApiResponse<LoomAlarmActionResult>>({
    find: (db, clientToken) => db.loomAlarmEvent.findUnique({ where: { clientToken }, select: ACTOR_PRIOR_SELECT }),
    alive: assertActorReplayAlive,
    identity: (p) => [
      { ad: "alarmId", mevcut: p.alarmId, gelen: c.alarmId },
      { ad: "kind", mevcut: p.kind, gelen: c.kind },
      { ad: "userId", mevcut: p.userId, gelen: c.userId },
      { ad: "detay", mevcut: actorDetail(p), gelen: c.detail },
    ],
    collision: "Bu form daha önce başka bir alarm eylemi olarak kaydedilmiş — ekranı yenileyip yeniden deneyin.",
    respond: (p) => ({ success: true, data: actorResult(p.id, p.kind, p.alarmId, p.alarm), message: "Eylem zaten kayıtlı (yeniden gönderim)" }),
  });

const ACTOR_ALARM_SELECT = { id: true, state: true, ackedById: true, ackedAt: true, snoozedUntil: true, snoozedById: true, ackedBy: { select: { fullName: true, username: true } } } satisfies Prisma.LoomAlarmSelect;
type ActorAlarm = Prisma.LoomAlarmGetPayload<{ select: typeof ACTOR_ALARM_SELECT }>;

export async function freshAlarmTx(tx: Tx, alarmId: string): Promise<ActorAlarm> {
  const a = await tx.loomAlarm.findUnique({ where: { id: alarmId }, select: ACTOR_ALARM_SELECT });
  if (!a) throw AppError.notFound("Alarm bulunamadı", { code: "LOOM_ALARM_NOT_FOUND" });
  return a;
}

export function closedConflict(a: ActorAlarm): AppError {
  const ne = a.state === LoomAlarmState.RESOLVED ? "çözüldü (duruş kapandı)" : "iptal edildi";
  return AppError.conflict(`Alarm ${ne} — bu işlem yalnız canlı alarma yapılır.`, { code: "LOOM_ALARM_CLOSED", state: a.state });
}

export const actorName = (u: { fullName: string; username: string } | null): string => u?.fullName.trim() || u?.username || "Bir kullanıcı";
