// =============================================================================
// TeksERP — TEZGAH ALARMI (LoomAlarm + LoomAlarmEvent) · MOTOR
// =============================================================================
// Alarm DURUM satırıdır ("şu an ne"), geçmişi `LoomAlarmEvent` DEFTERİNDEDİR. Bütün yazma
// yolları bu serviste yaşar (motor + kişi eylemleri) — ikinci yazar doğmaz.
//   • DOĞUŞ   — açık duruşun ilk kademesi (K1, hedef aşıldı) vadesini geçince; plan DONAR.
//   • KADEME  — K2 (üst kademe) vadesi geçince; susturmak K2'yi durdurmaz, üstlenmek
//               `tezgah.alarm.escalateWhenAcked` kapalıysa durdurur (varsayılan AÇIK).
//   • YENİDEN PLAN — duruşun sebebi değişince yalnız ÇALMAMIŞ kademenin vadesi.
//   • KAPANIŞ — duruş kapanınca RESOLVED (süreler DONAR); geri alınınca / plan dışına
//               sınıflanınca CANCELLED.
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
import {
  alarmScheduleOf,
  alarmShiftEligible,
  dueAlarmTiers,
  stopTargetMinutes,
  type AlarmTier,
  type StopClock,
} from "./helpers/loom-floor.helper";
import {
  readTezgahAlarmEscalateWhenAcked,
  readTezgahAlarmUnclassifiedTargetMinutes,
  readTezgahEscalationGraceMinutes,
  resolveTezgahAlarmEnabled,
} from "./system-setting.service";
import { hata } from "../lib/logger";

type Tx = Prisma.TransactionClient;

/** Canlı (kapanmamış) alarm durumları — tek tanım. */
export const ACTIVE_ALARM_STATES: LoomAlarmState[] = [LoomAlarmState.OPEN, LoomAlarmState.ACKED];

export const ALARM_CANCEL_STOP_REVOKED = "STOP_REVOKED";
export const ALARM_CANCEL_NON_SCHEDULED = "NON_SCHEDULED";

const STOP_SELECT = {
  id: true, machineId: true, startedAt: true, endedAt: true, durationSec: true, revokedAt: true,
  reasonCode: true, lossClass: true, targetMinutes: true, escalationGraceMinutes: true,
  shiftInstance: { select: { isCancelled: true } },
} satisfies Prisma.MachineStopEventSelect;
type StopRow = Prisma.MachineStopEventGetPayload<{ select: typeof STOP_SELECT }>;

const ALARM_SELECT = {
  id: true, state: true, tier: true, targetMinutes: true, graceMinutes: true, planReasonCode: true,
  k1DueAt: true, k2DueAt: true,
} satisfies Prisma.LoomAlarmSelect;
type AlarmRow = Prisma.LoomAlarmGetPayload<{ select: typeof ALARM_SELECT }>;

export interface LoomAlarmTickSummary {
  scanned: number;
  raised: number;
  skipped: number;
  replanned: number;
  resolved: number;
  cancelled: number;
  failed: number;
}
export type LoomAlarmTickOutcome = "disabled" | LoomAlarmTickSummary;

/** Turun ayarları — tur başında BİR KEZ okunur (tur içi tutarlılık). */
interface TickCtx {
  now: Date;
  grace: number;
  unclassified: number | null;
  escalateWhenAcked: boolean;
  sum: LoomAlarmTickSummary;
}

export interface LoomAlarmRunOptions {
  /** Test enjeksiyonu: sabit saat; üretimde DB saati. */
  now?: Date;
  /** Test enjeksiyonu: yalnız bu makineler. */
  onlyMachineIds?: string[];
}

/** Defter satırı — damga alarm başına kesin artan (DB saati); kademe satırında çakışma sessizce düşer. */
async function writeEventTx(tx: Tx, alarmId: string, data: Omit<Prisma.LoomAlarmEventCreateManyInput, "alarmId" | "createdAt">): Promise<number> {
  const createdAt = await loomAlarmEventStampTx(tx, alarmId);
  const r = await tx.loomAlarmEvent.createMany({ data: [{ ...data, alarmId, createdAt }], skipDuplicates: true });
  return r.count;
}

async function writeTierEventsTx(tx: Tx, alarmId: string, due: { raise: AlarmTier; skip: AlarmTier[] }, sum: LoomAlarmTickSummary): Promise<void> {
  for (const t of due.skip) sum.skipped += await writeEventTx(tx, alarmId, { kind: LoomAlarmEventKind.TIER_SKIPPED, tier: t });
  sum.raised += await writeEventTx(tx, alarmId, { kind: LoomAlarmEventKind.RAISED, tier: due.raise });
}

function clockOf(stop: StopRow, targetMinutes: number | null, graceMinutes: number): StopClock {
  return { startedAt: stop.startedAt, targetMinutes, graceMinutes, lossClass: stop.lossClass };
}

/** Açık duruş, alarmı yok: K1 vadesi geçtiyse alarm DOĞAR (plan donar), vadesi geçen en yüksek kademe çalar. */
async function birthTx(tx: Tx, stop: StopRow, ctx: TickCtx): Promise<void> {
  if (!alarmShiftEligible(stop.shiftInstance)) return;
  const targetMinutes = stopTargetMinutes(stop, ctx.unclassified);
  const graceMinutes = stop.escalationGraceMinutes ?? ctx.grace;
  const schedule = alarmScheduleOf(clockOf(stop, targetMinutes, graceMinutes));
  if (schedule === null) return;
  const due = dueAlarmTiers(schedule, 0, ctx.now);
  if (due.raise === null) return;
  const id = randomUUID();
  const born = await tx.loomAlarm.createMany({
    data: [{
      id, kind: LoomAlarmKind.STOP_OVERDUE, stopEventId: stop.id, machineId: stop.machineId, state: LoomAlarmState.OPEN,
      tier: due.raise, targetMinutes, graceMinutes, planReasonCode: stop.reasonCode, k1DueAt: schedule.k1DueAt, k2DueAt: schedule.k2DueAt,
    }],
    skipDuplicates: true,
  });
  if (born.count === 0) return; // eşzamanlı tur doğurdu — sed
  await writeTierEventsTx(tx, id, { raise: due.raise, skip: due.skip }, ctx.sum);
}

/** Canlı alarm: sebep değiştiyse çalmamış kademeyi yeniden planla; vadesi geçen kademeyi çaldır. */
async function advanceTx(tx: Tx, stop: StopRow, alarm: AlarmRow, ctx: TickCtx): Promise<void> {
  let k2DueAt = alarm.k2DueAt;
  if (stop.reasonCode !== alarm.planReasonCode) {
    const targetMinutes = stopTargetMinutes(stop, ctx.unclassified);
    if (alarm.tier < 2) k2DueAt = alarmScheduleOf(clockOf(stop, targetMinutes, alarm.graceMinutes))?.k2DueAt ?? null;
    const re = await tx.loomAlarm.updateMany({
      where: { id: alarm.id, planReasonCode: alarm.planReasonCode, state: { in: ACTIVE_ALARM_STATES } },
      data: { planReasonCode: stop.reasonCode, targetMinutes, k2DueAt },
    });
    if (re.count === 0) return; // eşzamanlı tur ya da kapanış — sonraki tur taze okur
    ctx.sum.replanned += 1;
  }
  const due = dueAlarmTiers({ k1DueAt: alarm.k1DueAt, k2DueAt }, alarm.tier, ctx.now);
  if (due.raise === null) return;
  // Üstlenilmiş alarm K2'de bekler (ayar kapalıysa) — yüklem claim'in içinde: eşzamanlı üstlenme de görülür.
  const raisable = ctx.escalateWhenAcked ? ACTIVE_ALARM_STATES : [LoomAlarmState.OPEN];
  const claim = await tx.loomAlarm.updateMany({
    where: { id: alarm.id, tier: { lt: due.raise }, state: { in: raisable } },
    data: { tier: due.raise },
  });
  if (claim.count === 0) return;
  await writeTierEventsTx(tx, alarm.id, { raise: due.raise, skip: due.skip }, ctx.sum);
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
  if (!(await resolveTezgahAlarmEnabled())) return "disabled";
  const ctx: TickCtx = {
    now: opts.now ?? (await readDbNow()),
    grace: await readTezgahEscalationGraceMinutes(),
    unclassified: await readTezgahAlarmUnclassifiedTargetMinutes(),
    escalateWhenAcked: await readTezgahAlarmEscalateWhenAcked(),
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
