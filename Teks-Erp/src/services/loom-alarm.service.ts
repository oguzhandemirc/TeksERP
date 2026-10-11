// =============================================================================
// TeksERP — TEZGAH ALARMI (LoomAlarm + LoomAlarmEvent) · MOTOR
// =============================================================================
// Alarm DURUM satırıdır ("şu an ne"), geçmişi `LoomAlarmEvent` DEFTERİNDEDİR. Bütün yazma
// yolları bu serviste yaşar (motor + kişi eylemleri) — ikinci yazar doğmaz; kişi eylemlerinin
// yazmayan parçaları (replay politikası, tanı okuması) `helpers/loom-alarm-actor.helper`da.
//   • DOĞUŞ   — açık duruşun ilk kademesi (K1, hedef aşıldı) vadesini geçince; plan DONAR. Vadesi eşit
//               kademeler birlikte çalar (pay 0 → K1 ve K2), daha önce geçmiş alttaki atlanır.
//   • KADEME  — K2 (üst kademe) vadesi geçince; susturmak K2'yi durdurmaz, üstlenmek
//               `tezgah.alarm.escalateWhenAcked` kapalıysa durdurur (varsayılan AÇIK).
//   • YENİDEN PLAN — duruşun sebebi değişince yalnız ÇALMAMIŞ kademenin vadesi.
//   • KAPANIŞ — duruş kapanınca RESOLVED (süreler DONAR); geri alınınca / plan dışına
//               sınıflanınca CANCELLED. Vardiyanın bitmesi/iptali canlı alarmı kapatmaz.
//   • ALICI   — kademe çaldığı an kime bildirildiği çözülür ve RAISED'a DONAR (`helpers/loom-alarm-recipient.helper`,
//               RAISED satırı + donmuş alıcı `writeRaisedEventTx`);
//               sorumlu tanımı yoksa kip BY_PERMISSION (izni olan herkes, bugünkü davranış).
// Vade hesabı TEK kaynaktan: `helpers/loom-floor.helper` (Tezgah Salonu ile aynı fonksiyonlar).
// Tekillik sedle: alarm `stopEventId` unique, kademe partial unique — iki eşzamanlı tur tek
// satır bırakır (ON CONFLICT DO NOTHING); advisory kilit YOK (MachineRun emsali).
// Motorun yazdıkları sistem işidir (öznesi kullanıcı değil); kişi eylemleri audit'e yazar.
// =============================================================================
import { LoomAlarmEventKind, LoomAlarmKind, LoomAlarmState, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { LOOM_MACHINE_WHERE } from "../constants/loom-shift";
import { readDbNow } from "./helpers/machine-run-open.helper";
import { loomAlarmEventStampTx } from "./helpers/ledger-stamp.helper";
import { alarmClockStart, alarmScheduleOf, dueAlarmTiers, stopClockOf, stopTargetMinutes, type AlarmTier, type ShiftWindow, type StopClock } from "./helpers/loom-floor.helper";
import { clockShiftsFrom, loadClockShiftWindows } from "./helpers/loom-alarm-shift.helper";
import { loadRecipientConfig, resolveAlarmRecipients, type RecipientConfig, type ResolvedRecipients } from "./helpers/loom-alarm-recipient.helper";
import { readTezgahAlarmEscalateWhenAcked, readTezgahAlarmUnclassifiedTargetMinutes, readTezgahEscalationGraceMinutes, resolveTezgahAlarmEnabled } from "./system-setting.service";
import { hata } from "../lib/logger";
import { AuditService } from "./audit.service";
import { ALARM_SNOOZE_MINUTES, actionReplay, actorName, actorResult, closedConflict, freshAlarmTx, hm, type ActorCall, type AlarmSnoozeMinutes, type LoomAlarmActionResult } from "./helpers/loom-alarm-actor.helper";
import { AppError } from "../utils/app-error";
import { p2002Mentions } from "../utils/p2002";
import type { ApiResponse } from "../types/api.types";

type Tx = Prisma.TransactionClient;
const MIN_MS = 60_000;

/** Canlı (kapanmamış) alarm durumları — tek tanım. */
export const ACTIVE_ALARM_STATES: LoomAlarmState[] = [LoomAlarmState.OPEN, LoomAlarmState.ACKED];

export const ALARM_CANCEL_STOP_REVOKED = "STOP_REVOKED";
export const ALARM_CANCEL_NON_SCHEDULED = "NON_SCHEDULED";

const STOP_SELECT = {
  id: true, machineId: true, startedAt: true, endedAt: true, durationSec: true, revokedAt: true,
  reasonCode: true, lossClass: true, targetMinutes: true, escalationGraceMinutes: true,
  shiftInstance: { select: { isCancelled: true } }, machine: { select: { stationId: true } },
} satisfies Prisma.MachineStopEventSelect;
type StopRow = Prisma.MachineStopEventGetPayload<{ select: typeof STOP_SELECT }>;

const ALARM_SELECT = {
  id: true, state: true, tier: true, targetMinutes: true, graceMinutes: true, planReasonCode: true,
  k1DueAt: true, k2DueAt: true,
} satisfies Prisma.LoomAlarmSelect;
type AlarmRow = Prisma.LoomAlarmGetPayload<{ select: typeof ALARM_SELECT }>;

export interface LoomAlarmTickSummary { scanned: number; raised: number; skipped: number; replanned: number; resolved: number; cancelled: number; failed: number }
export type LoomAlarmTickOutcome = "disabled" | LoomAlarmTickSummary;

/** Turun ayarları — tur başında BİR KEZ okunur (tur içi tutarlılık). */
interface TickCtx {
  now: Date;
  grace: number;
  unclassified: number | null;
  escalateWhenAcked: boolean;
  /** Açık duruşların saat başlangıcı için canlı vardiya pencereleri (tur başında bir kez). */
  shifts: ShiftWindow[];
  /** Alıcı yapılandırması — turda İLK kademe çalarken bir kez okunur (alarmsız turda hiç okunmaz). */
  recipients: RecipientConfig | null;
  sum: LoomAlarmTickSummary;
}

export interface LoomAlarmRunOptions {
  /** Test enjeksiyonu: sabit saat; üretimde DB saati. */
  now?: Date;
  /** Test enjeksiyonu: yalnız bu makineler. */
  onlyMachineIds?: string[];
  /**
   * Test enjeksiyonu: bayrak kapısının sonucu; üretimde DB'den. Bekçi global bayrağı KAPALI tutar ki aynı
   * DB'deki sunucu zamanlayıcıları gerçek saatle fikstüre dokunamasın (`test_loom_alarm` §7).
   */
  enabled?: boolean;
}

/** Defter satırı — damga alarm başına kesin artan (DB saati); kademe satırında çakışma sessizce düşer. */
async function writeEventTx(tx: Tx, alarmId: string, data: Omit<Prisma.LoomAlarmEventCreateManyInput, "alarmId" | "createdAt">): Promise<number> {
  const createdAt = await loomAlarmEventStampTx(tx, alarmId);
  const r = await tx.loomAlarmEvent.createMany({ data: [{ ...data, alarmId, createdAt }], skipDuplicates: true });
  return r.count;
}

/** RAISED + donmuş alıcı (kip satıra, liste `LoomAlarmRecipient`e); eşzamanlı turun kaybedeni (sed) alıcı yazmaz. */
async function writeRaisedEventTx(tx: Tx, alarmId: string, tier: number, r: ResolvedRecipients): Promise<number> {
  const id = randomUUID();
  const createdAt = await loomAlarmEventStampTx(tx, alarmId);
  const n = (await tx.loomAlarmEvent.createMany({ data: [{ id, alarmId, createdAt, kind: LoomAlarmEventKind.RAISED, tier, recipientMode: r.mode }], skipDuplicates: true })).count;
  if (n === 1 && r.recipients.length > 0) await tx.loomAlarmRecipient.createMany({ data: r.recipients.map((x) => ({ eventId: id, userId: x.userId, source: x.source })) });
  return n;
}

/** Kademe satırları. RAISED'da alıcı hol × kademe için çözülür ve satıra DONAR; TIER_SKIPPED alıcı almaz. */
async function writeTierEventsTx(tx: Tx, target: { alarmId: string; stationId: string }, due: { raise: AlarmTier[]; skip: AlarmTier[] }, ctx: TickCtx): Promise<void> {
  for (const t of due.skip) ctx.sum.skipped += await writeEventTx(tx, target.alarmId, { kind: LoomAlarmEventKind.TIER_SKIPPED, tier: t });
  for (const t of due.raise) {
    ctx.recipients ??= await loadRecipientConfig(tx, ctx.now);
    ctx.sum.raised += await writeRaisedEventTx(tx, target.alarmId, t, resolveAlarmRecipients(ctx.recipients, target.stationId, t));
  }
}

/** Turda çalan en yüksek kademe (`raise` artan sıralı). */
const topTier = (raise: AlarmTier[]): AlarmTier => raise[raise.length - 1]!;

function clockOf(stop: StopRow, targetMinutes: number | null, graceMinutes: number, ctx: TickCtx): StopClock {
  return stopClockOf(stop, alarmClockStart(stop, ctx.shifts, ctx.now), targetMinutes, graceMinutes);
}

/**
 * Açık duruş, alarmı yok: K1 vadesi geçtiyse alarm DOĞAR (plan donar), vadesi geçen en yüksek kademe çalar.
 * Doğuş yalnız `alarmClockStart().eligible` iken (vardiya dışında açılıp vardiyaya taşan duruş da dahil).
 */
async function birthTx(tx: Tx, stop: StopRow, ctx: TickCtx): Promise<void> {
  if (!alarmClockStart(stop, ctx.shifts, ctx.now).eligible) return;
  const targetMinutes = stopTargetMinutes(stop, ctx.unclassified);
  const graceMinutes = stop.escalationGraceMinutes ?? ctx.grace;
  const schedule = alarmScheduleOf(clockOf(stop, targetMinutes, graceMinutes, ctx));
  if (schedule === null) return;
  const due = dueAlarmTiers(schedule, 0, ctx.now);
  if (due.raise.length === 0) return;
  const id = randomUUID();
  const born = await tx.loomAlarm.createMany({
    data: [{
      id, kind: LoomAlarmKind.STOP_OVERDUE, stopEventId: stop.id, machineId: stop.machineId, state: LoomAlarmState.OPEN,
      tier: topTier(due.raise), targetMinutes, graceMinutes, planReasonCode: stop.reasonCode, k1DueAt: schedule.k1DueAt, k2DueAt: schedule.k2DueAt,
    }],
    skipDuplicates: true,
  });
  if (born.count === 0) return; // eşzamanlı tur doğurdu — sed
  await writeTierEventsTx(tx, { alarmId: id, stationId: stop.machine.stationId }, due, ctx);
}

/** Canlı alarm: sebep değiştiyse çalmamış kademeyi yeniden planla; vadesi geçen kademeyi çaldır. */
async function advanceTx(tx: Tx, stop: StopRow, alarm: AlarmRow, ctx: TickCtx): Promise<void> {
  let k2DueAt = alarm.k2DueAt;
  if (stop.reasonCode !== alarm.planReasonCode) {
    const targetMinutes = stopTargetMinutes(stop, ctx.unclassified);
    if (alarm.tier < 2) k2DueAt = alarmScheduleOf(clockOf(stop, targetMinutes, alarm.graceMinutes, ctx))?.k2DueAt ?? null;
    const re = await tx.loomAlarm.updateMany({
      where: { id: alarm.id, planReasonCode: alarm.planReasonCode, state: { in: ACTIVE_ALARM_STATES } },
      data: { planReasonCode: stop.reasonCode, targetMinutes, k2DueAt },
    });
    if (re.count === 0) return; // eşzamanlı tur ya da kapanış — sonraki tur taze okur
    ctx.sum.replanned += 1;
  }
  const due = dueAlarmTiers({ k1DueAt: alarm.k1DueAt, k2DueAt }, alarm.tier, ctx.now);
  if (due.raise.length === 0) return;
  const raiseTo = topTier(due.raise);
  // Üstlenilmiş alarm K2'de bekler (ayar kapalıysa) — yüklem claim'in içinde: eşzamanlı üstlenme de görülür.
  const raisable = ctx.escalateWhenAcked ? ACTIVE_ALARM_STATES : [LoomAlarmState.OPEN];
  const claim = await tx.loomAlarm.updateMany({
    where: { id: alarm.id, tier: { lt: raiseTo }, state: { in: raisable } },
    data: { tier: raiseTo },
  });
  if (claim.count === 0) return;
  await writeTierEventsTx(tx, { alarmId: alarm.id, stationId: stop.machine.stationId }, due, ctx);
}

/** Duruş kapandı / geri alındı / plan dışına sınıflandı → alarm terminal; kapanış süreleri DONAR. */
async function closeTx(tx: Tx, stop: StopRow, alarm: AlarmRow, ctx: TickCtx): Promise<void> {
  const cancelCode = stop.revokedAt ? ALARM_CANCEL_STOP_REVOKED : stop.lossClass === "NON_SCHEDULED" ? ALARM_CANCEL_NON_SCHEDULED : null;
  if (cancelCode === null && stop.endedAt === null) return;
  const where = { id: alarm.id, state: { in: ACTIVE_ALARM_STATES } };
  if (cancelCode !== null) {
    const c = await tx.loomAlarm.updateMany({ where, data: { state: LoomAlarmState.CANCELLED, closedAt: ctx.now, cancelReason: cancelCode } });
    if (c.count === 0) return;
    await writeEventTx(tx, alarm.id, { kind: LoomAlarmEventKind.CANCELLED, code: cancelCode });
    ctx.sum.cancelled += 1;
    return;
  }
  const endedAt = stop.endedAt!;
  const totalSec = stop.durationSec ?? Math.max(0, Math.round((endedAt.getTime() - stop.startedAt.getTime()) / 1000));
  const overdueSec = Math.max(0, Math.round((endedAt.getTime() - alarm.k1DueAt.getTime()) / 1000));
  const r = await tx.loomAlarm.updateMany({ where, data: { state: LoomAlarmState.RESOLVED, closedAt: endedAt, totalSec, overdueSec } });
  if (r.count === 0) return;
  await writeEventTx(tx, alarm.id, { kind: LoomAlarmEventKind.RESOLVED });
  ctx.sum.resolved += 1;
}

/**
 * Motorun bir turu. Bayrak (`tezgahEnabled ∧ tezgah.alarmEnabled`) kapalıyken "disabled" — HİÇ satır yazılmaz.
 * Her duruş kendi tx'inde (biri düşerse ötekiler işlenir).
 */
export async function runLoomAlarmOnce(opts: LoomAlarmRunOptions = {}): Promise<LoomAlarmTickOutcome> {
  if (!(opts.enabled ?? (await resolveTezgahAlarmEnabled()))) return "disabled";
  const ctx: TickCtx = {
    now: opts.now ?? (await readDbNow()),
    grace: await readTezgahEscalationGraceMinutes(),
    unclassified: await readTezgahAlarmUnclassifiedTargetMinutes(),
    escalateWhenAcked: await readTezgahAlarmEscalateWhenAcked(),
    shifts: [], recipients: null,
    sum: { scanned: 0, raised: 0, skipped: 0, replanned: 0, resolved: 0, cancelled: 0, failed: 0 },
  };
  const sum = ctx.sum;
  const machineFilter = opts.onlyMachineIds ? { machineId: { in: opts.onlyMachineIds } } : {};

  // ① Kapanacak canlı alarmlar — duruşu artık açık/canlı değil.
  const closing = await prisma.loomAlarm.findMany({
    where: {
      ...machineFilter, state: { in: ACTIVE_ALARM_STATES },
      stopEvent: { OR: [{ endedAt: { not: null } }, { revokedAt: { not: null } }, { lossClass: "NON_SCHEDULED" }] },
    },
    select: { ...ALARM_SELECT, stopEvent: { select: STOP_SELECT } },
  });
  // ② Açık duruşlar (tezgah kümesi) + alarmları.
  const open = await prisma.machineStopEvent.findMany({
    where: { ...machineFilter, endedAt: null, revokedAt: null, machine: LOOM_MACHINE_WHERE },
    select: { ...STOP_SELECT, alarm: { select: ALARM_SELECT } },
    orderBy: { startedAt: "asc" },
  });
  ctx.shifts = await loadClockShiftWindows(prisma, clockShiftsFrom(open), ctx.now);

  for (const a of closing) {
    sum.scanned += 1;
    await guarded(sum, a.stopEvent.id, (tx) => closeTx(tx, a.stopEvent, a, ctx));
  }
  for (const s of open) {
    sum.scanned += 1;
    if (s.alarm && !ACTIVE_ALARM_STATES.includes(s.alarm.state)) continue;
    await guarded(sum, s.id, (tx) => (s.alarm ? advanceTx(tx, s, s.alarm, ctx) : birthTx(tx, s, ctx)));
  }
  return sum;
}

async function guarded(sum: LoomAlarmTickSummary, stopId: string, fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(fn);
  } catch (err) {
    sum.failed += 1;
    hata("loom-alarm", `alarm işlenemedi (duruş ${stopId}):`, err);
  }
}

// =============================================================================
// KİŞİ EYLEMLERİ (A1b) — üstlen · bırak · sustur · susturmayı kaldır · not · notu geri çek
// =============================================================================
// Her eylem: `clientToken` → `actionReplay` boğazı (R kipi) → tx içinde atomik claim (ya da varlık
// okuması) → defter satırı `writeActorEventTx` → tx DIŞINDA audit. Claim düşerse tanı tx içinde taze
// okumayla: kim, ne zaman üstlendi; alarm kapandı mı.

export { ALARM_SNOOZE_MINUTES, type AlarmSnoozeMinutes, type LoomAlarmActionResult };

/** Kişi olayının tek yazarı — `create` (skipDuplicates YOK: token çakışması P2002 olarak boğaza döner). */
async function writeActorEventTx(tx: Tx, alarmId: string, at: Date, data: Omit<Prisma.LoomAlarmEventUncheckedCreateInput, "alarmId" | "createdAt">): Promise<string> {
  const ev = await tx.loomAlarmEvent.create({ data: { ...data, alarmId, createdAt: at }, select: { id: true } });
  return ev.id;
}

async function logActor(c: ActorCall, eventId: string, extra: Record<string, unknown> = {}): Promise<void> {
  await AuditService.log({ userId: c.userId, action: "CREATE", tableName: "LOOM_ALARM_EVENT", recordId: eventId, newData: { alarmId: c.alarmId, kind: c.kind, ...extra } });
}

async function runActor(
  c: ActorCall,
  clientToken: string | null | undefined,
  body: (tx: Tx, at: Date) => Promise<{ eventId: string; audit?: Record<string, unknown> }>,
  message: string,
): Promise<ApiResponse<LoomAlarmActionResult>> {
  return actionReplay(c).run(clientToken, async () => {
    const out = await prisma.$transaction(async (tx) => {
      const at = await loomAlarmEventStampTx(tx, c.alarmId);
      const r = await body(tx, at);
      const a = await freshAlarmTx(tx, c.alarmId);
      return { ...r, a };
    });
    await logActor(c, out.eventId, out.audit);
    return { success: true, data: actorResult(out.eventId, c.kind, c.alarmId, out.a), message };
  });
}

/** Üstlen — tek kişi: claim `{OPEN, üstlenen yok}`; ikinci kişiye 409 "X HH:mm'de üstlendi". */
export async function ackLoomAlarm(alarmId: string, userId: string, clientToken?: string | null): Promise<ApiResponse<LoomAlarmActionResult>> {
  const c: ActorCall = { alarmId, kind: LoomAlarmEventKind.ACK, userId, detail: null };
  return runActor(c, clientToken, async (tx, at) => {
    const claim = await tx.loomAlarm.updateMany({
      where: { id: alarmId, state: LoomAlarmState.OPEN, ackedById: null },
      data: { state: LoomAlarmState.ACKED, ackedById: userId, ackedAt: at },
    });
    if (claim.count === 0) {
      const a = await freshAlarmTx(tx, alarmId);
      if (a.state === LoomAlarmState.ACKED && a.ackedAt) {
        const kim = a.ackedById === userId ? "Bu alarmı zaten siz" : actorName(a.ackedBy);
        throw AppError.conflict(`${kim} ${hm(a.ackedAt)}'de üstlendi.`, { code: "LOOM_ALARM_ALREADY_ACKED", ackedById: a.ackedById, ackedAt: a.ackedAt });
      }
      throw closedConflict(a);
    }
    return { eventId: await writeActorEventTx(tx, alarmId, at, { kind: LoomAlarmEventKind.ACK, userId, clientToken: clientToken ?? null }) };
  }, "Alarm üstlenildi");
}

/**
 * Bırak — üstlenmenin karşı olayı. Kendi üstlenmesini herkes bırakır; başkasınınkini yalnız üst kademe
 * yetkilisi (`loom:alarm-escalation`). Claim üstleneni de yükler: arada el değiştirdiyse 409.
 */
export async function releaseLoomAlarm(alarmId: string, userId: string, opts: { clientToken?: string | null; canReleaseOthers: boolean }): Promise<ApiResponse<LoomAlarmActionResult>> {
  const c: ActorCall = { alarmId, kind: LoomAlarmEventKind.ACK_RELEASE, userId, detail: null };
  return runActor(c, opts.clientToken, async (tx, at) => {
    const now = await freshAlarmTx(tx, alarmId);
    if (now.state !== LoomAlarmState.ACKED) {
      if (now.state === LoomAlarmState.OPEN) throw AppError.conflict("Alarm üstlenilmemiş — bırakılacak üstlenme yok.", { code: "LOOM_ALARM_NOT_ACKED" });
      throw closedConflict(now);
    }
    if (now.ackedById !== userId && !opts.canReleaseOthers) {
      throw AppError.forbidden(`${actorName(now.ackedBy)} üstlendi — yalnız kendisi ya da üst kademe yetkilisi bırakabilir.`, { code: "LOOM_ALARM_ACKED_BY_OTHER", ackedById: now.ackedById });
    }
    const claim = await tx.loomAlarm.updateMany({
      where: { id: alarmId, state: LoomAlarmState.ACKED, ackedById: now.ackedById },
      data: { state: LoomAlarmState.OPEN, ackedById: null, ackedAt: null },
    });
    if (claim.count === 0) throw AppError.conflict("Alarm bu arada değişti — ekranı yenileyip yeniden deneyin.", { code: "LOOM_ALARM_STALE" });
    const eventId = await writeActorEventTx(tx, alarmId, at, { kind: LoomAlarmEventKind.ACK_RELEASE, userId, clientToken: opts.clientToken ?? null });
    return { eventId, audit: { releasedAckOf: now.ackedById } };
  }, "Üstlenme bırakıldı");
}

/** Sustur — yalnız tekrar-çalmayı keser, üst kademeyi değil; yeni susturma eskisinin yerine geçer. */
export async function snoozeLoomAlarm(alarmId: string, userId: string, input: { minutes: AlarmSnoozeMinutes; note?: string | null; clientToken?: string | null }): Promise<ApiResponse<LoomAlarmActionResult>> {
  if (!ALARM_SNOOZE_MINUTES.includes(input.minutes)) {
    throw AppError.badRequest(`Susturma süresi ${ALARM_SNOOZE_MINUTES.join(" / ")} dakikadan biri olmalı.`, { code: "LOOM_ALARM_SNOOZE_MINUTES" });
  }
  const note = input.note?.trim() || null;
  const c: ActorCall = { alarmId, kind: LoomAlarmEventKind.SNOOZE, userId, detail: String(input.minutes) };
  return runActor(c, input.clientToken, async (tx, at) => {
    const until = new Date(at.getTime() + input.minutes * MIN_MS);
    const claim = await tx.loomAlarm.updateMany({
      where: { id: alarmId, state: { in: ACTIVE_ALARM_STATES } },
      data: { snoozedUntil: until, snoozedById: userId },
    });
    if (claim.count === 0) throw closedConflict(await freshAlarmTx(tx, alarmId));
    const eventId = await writeActorEventTx(tx, alarmId, at, { kind: LoomAlarmEventKind.SNOOZE, userId, snoozedUntil: until, note, clientToken: input.clientToken ?? null });
    return { eventId, audit: { minutes: input.minutes, snoozedUntil: until } };
  }, `Alarm ${input.minutes} dk susturuldu`);
}

/** Susturmayı kaldır — susturmanın karşı olayı; yalnız süresi dolmamış susturmaya. */
export async function unsnoozeLoomAlarm(alarmId: string, userId: string, clientToken?: string | null): Promise<ApiResponse<LoomAlarmActionResult>> {
  const c: ActorCall = { alarmId, kind: LoomAlarmEventKind.UNSNOOZE, userId, detail: null };
  return runActor(c, clientToken, async (tx, at) => {
    const claim = await tx.loomAlarm.updateMany({
      where: { id: alarmId, state: { in: ACTIVE_ALARM_STATES }, snoozedUntil: { gt: at } },
      data: { snoozedUntil: null, snoozedById: null },
    });
    if (claim.count === 0) {
      const a = await freshAlarmTx(tx, alarmId);
      if (!ACTIVE_ALARM_STATES.includes(a.state)) throw closedConflict(a);
      throw AppError.conflict("Alarm susturulmuş değil (ya da susturma süresi doldu).", { code: "LOOM_ALARM_NOT_SNOOZED" });
    }
    return { eventId: await writeActorEventTx(tx, alarmId, at, { kind: LoomAlarmEventKind.UNSNOOZE, userId, clientToken: clientToken ?? null }) };
  }, "Susturma kaldırıldı");
}

/** Not — alarmın her hâlinde (kapanmış alarma da sonradan not düşülür); not silinmez, değişmez. */
export async function noteLoomAlarm(alarmId: string, userId: string, input: { note: string; clientToken?: string | null }): Promise<ApiResponse<LoomAlarmActionResult>> {
  const note = input.note.trim();
  if (note.length === 0) throw AppError.badRequest("Not boş olamaz.", { code: "LOOM_ALARM_NOTE_EMPTY" });
  const c: ActorCall = { alarmId, kind: LoomAlarmEventKind.NOTE, userId, detail: note };
  return runActor(c, input.clientToken, async (tx, at) => {
    await freshAlarmTx(tx, alarmId);
    return { eventId: await writeActorEventTx(tx, alarmId, at, { kind: LoomAlarmEventKind.NOTE, userId, note, clientToken: input.clientToken ?? null }) };
  }, "Not eklendi");
}

/** Notu geri çek — yalnız not sahibi, aynı alarmın NOTE satırına, not başına bir kez (tekliği DB tutar). */
export async function retractLoomAlarmNote(alarmId: string, userId: string, input: { eventId: string; clientToken?: string | null }): Promise<ApiResponse<LoomAlarmActionResult>> {
  const c: ActorCall = { alarmId, kind: LoomAlarmEventKind.NOTE_RETRACT, userId, detail: input.eventId };
  return runActor(c, input.clientToken, async (tx, at) => {
    await freshAlarmTx(tx, alarmId);
    const target = await tx.loomAlarmEvent.findUnique({ where: { id: input.eventId }, select: { alarmId: true, kind: true, userId: true, retractedBy: { select: { id: true } } } });
    if (!target || target.alarmId !== alarmId || target.kind !== LoomAlarmEventKind.NOTE) {
      throw AppError.badRequest("Geri çekilecek satır bu alarmın bir notu değil.", { code: "LOOM_ALARM_NOTE_INVALID" });
    }
    if (target.userId !== userId) throw AppError.forbidden("Notu yalnız yazan geri çekebilir.", { code: "LOOM_ALARM_NOTE_NOT_OWNER" });
    if (target.retractedBy !== null) throw AppError.conflict("Bu not zaten geri çekilmiş.", { code: "LOOM_ALARM_NOTE_ALREADY_RETRACTED" });
    try {
      const eventId = await writeActorEventTx(tx, alarmId, at, { kind: LoomAlarmEventKind.NOTE_RETRACT, userId, retractsEventId: input.eventId, clientToken: input.clientToken ?? null });
      return { eventId, audit: { retractsEventId: input.eventId } };
    } catch (e) {
      // Eşzamanlı ikinci geri çekme tekliği DB'de (retractsEventId unique) kaybeder.
      if (p2002Mentions(e, /retractsEventId/)) throw AppError.conflict("Bu not zaten geri çekilmiş.", { code: "LOOM_ALARM_NOTE_ALREADY_RETRACTED" });
      throw e;
    }
  }, "Not geri çekildi");
}
