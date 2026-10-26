// =============================================================================
// TeksERP — MAKİNE KARTI WATCHDOG'u (makine kaynaklı duruş D4)
// =============================================================================
// Üç iş, üçü de atomik claim'le idempotent (yeniden başlatma çift uyarı/çift kapanış üretmez):
//   ① SESSİZLİK — onaylı, tezgaha bağlı kart `tezgah.collectorSilenceMinutes` boyunca imzalı istek
//      göndermediyse `silentSince` yazılır (değer: son görülme). Sessizlik DURUŞ AÇMAZ: tezgahın
//      durduğunu değil kartın sustuğunu söyler; duruşu insan bildirir (ikincil yol).
//   ② GEÇİCİ KAPANIŞ — kart duruşu (`collectorId` dolu) `tezgah.maxOpenStopHours` aşınca tek boğazdan
//      (`closeStopCore`, endSource WATCHDOG) `startedAt + eşik` ile kapanır; insan duruşuna dokunulmaz.
//   ③ GECİKEN KAPANIŞ — mühür yüzünden kuyruğa düşen gerçek bitiş, mühür açılınca uygulanır.
// Canlılık yazımı (`touchCollectorLiveness`) kart ucunun modül kapılarından SONRA koşar.
// =============================================================================
import { MachineStopEndSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { closeStopCore } from "./machine-stop.service";
import { LATE_STOP_END_WHERE } from "./helpers/machine-stop-watchdog.helper";
import {
  readDokumaEnabled, readTezgahCollectorSilenceMinutes, readTezgahEnabled, readTezgahMaxOpenStopHours,
} from "./system-setting.service";
import { hata } from "../lib/logger";

const TABLE = "MACHINE_COLLECTOR";
/** `lastSeenAt` yazım kısıtı — her istekte UPDATE ölü tuple fırtınasıdır; eşikler dakikalık. */
export const COLLECTOR_SEEN_THROTTLE_MS = 30_000;
/** Tur başına en çok bu kadar duruş kapatılır/düzeltilir; kalan sonraki tura. */
const BATCH = 200;

export interface WatchdogSummary { silenced: number; provisional: number; corrected: number; sealed: number; failed: number }
export type WatchdogOutcome = "disabled" | WatchdogSummary;

/** Kartın geçerli imzalı isteği: sessizse sessizliği bitirir (audit), değilse `lastSeenAt`i kısıtlı tazeler. */
export async function touchCollectorLiveness(collectorId: string, now = new Date()): Promise<void> {
  const woke = await prisma.machineCollector.findFirst({ where: { id: collectorId, silentSince: { not: null } }, select: { silentSince: true } });
  if (woke) {
    const r = await prisma.machineCollector.updateMany({ where: { id: collectorId, silentSince: { not: null } }, data: { silentSince: null, lastSeenAt: now } });
    if (r.count === 1) {
      await AuditService.log({
        userId: undefined, action: "UPDATE", tableName: TABLE, recordId: collectorId,
        changes: [{ field: "silentSince", old: woke.silentSince, new: null }],
      }).catch(() => undefined);
    }
    return;
  }
  await prisma.machineCollector.updateMany({
    where: { id: collectorId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - COLLECTOR_SEEN_THROTTLE_MS) } }] },
    data: { lastSeenAt: now },
  });
}

/** ① Tek ifade: claim yüklemi `silentSince IS NULL` — ikinci tur ve yeniden başlatma aynı kartı yeniden işaretlemez. */
async function markSilentCollectors(now: Date, silenceMin: number, only?: string[]): Promise<number> {
  const cutoff = new Date(now.getTime() - silenceMin * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string; silentSince: Date }>>`
    UPDATE machine_collectors c
       SET "silentSince" = COALESCE(c."lastSeenAt", c."secretIssuedAt", c."createdAt"), "updatedAt" = ${now}::timestamptz
     WHERE c."silentSince" IS NULL AND c.status = 'APPROVED' AND c."isActive" AND c."revokedAt" IS NULL
       AND COALESCE(c."lastSeenAt", c."secretIssuedAt", c."createdAt") < ${cutoff}::timestamptz
       AND EXISTS (SELECT 1 FROM machine_collector_machines l WHERE l."collectorId" = c.id)
       AND (${only ?? null}::uuid[] IS NULL OR c.id = ANY(${only ?? null}::uuid[]))
     RETURNING c.id, c."silentSince"`;
  for (const r of rows) {
    await AuditService.log({
      userId: undefined, action: "UPDATE", tableName: TABLE, recordId: r.id,
      changes: [{ field: "silentSince", old: null, new: r.silentSince }],
    }).catch(() => undefined);
  }
  return rows.length;
}

function isSealed(e: unknown): boolean {
  return e instanceof AppError && (e.details as { code?: string } | undefined)?.code === "SHIFT_SEALED";
}

/** ② Kart duruşu eşiği aştı → geçici kapanış (tahmin `startedAt + eşik`, kolonda beyanlı). */
async function closeOverdueCardStops(now: Date, maxHours: number, sum: WatchdogSummary, only?: string[]): Promise<void> {
  const limitMs = maxHours * 3_600_000;
  const due = await prisma.machineStopEvent.findMany({
    where: {
      endedAt: null, revokedAt: null, collectorId: { not: null }, startedAt: { lte: new Date(now.getTime() - limitMs) },
      ...(only ? { machineId: { in: only } } : {}),
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }], take: BATCH, select: { id: true, startedAt: true },
  });
  for (const s of due) {
    try {
      await closeStopCore(s.id, { value: new Date(s.startedAt.getTime() + limitMs), warning: null }, { endSource: MachineStopEndSource.WATCHDOG, actorId: null });
      sum.provisional += 1;
    } catch (e) {
      if (isSealed(e)) sum.sealed += 1;
      else if (!(e instanceof AppError)) { sum.failed += 1; hata("machine-watchdog", `geçici kapanış yazılamadı (duruş ${s.id}):`, e); }
    }
  }
}

/** ③ Geciken kapanış kuyruğu — mühür açıldıysa düzeltme tek boğazdan uygulanır; hâlâ mühürlüyse beklemeye devam. */
async function applyLateEnds(sum: WatchdogSummary, only?: string[], afterLateQueueRead?: () => Promise<void>): Promise<void> {
  const late = await prisma.machineStopEvent.findMany({
    where: {
      ...LATE_STOP_END_WHERE,
      ...(only ? { machineId: { in: only } } : {}),
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }], take: BATCH, select: { id: true, lateEndedAt: true },
  });
  if (afterLateQueueRead) await afterLateQueueRead();
  for (const s of late) {
    try {
      await closeStopCore(s.id, { value: s.lateEndedAt!, warning: null }, { endSource: MachineStopEndSource.SIGNAL, actorId: null });
      sum.corrected += 1;
    } catch (e) {
      if (isSealed(e)) sum.sealed += 1;
      else if (!(e instanceof AppError)) { sum.failed += 1; hata("machine-watchdog", `geciken kapanış uygulanamadı (duruş ${s.id}):`, e); }
    }
  }
}

export interface WatchdogRunOptions {
  now?: Date;
  /** Test enjeksiyonu: yalnız bu kartlar / makineler; üretimde hepsi. */
  onlyCollectorIds?: string[];
  onlyMachineIds?: string[];
  /** Test enjeksiyonu: geciken kapanış kuyruğu okunduktan SONRA, uygulamadan ÖNCE (mühür açılışını turun içine sıralar). */
  afterLateQueueRead?: () => Promise<void>;
}

export async function runMachineWatchdogOnce(opts: WatchdogRunOptions = {}): Promise<WatchdogOutcome> {
  if (!(await readTezgahEnabled()) || !(await readDokumaEnabled())) return "disabled";
  const now = opts.now ?? new Date();
  const sum: WatchdogSummary = { silenced: 0, provisional: 0, corrected: 0, sealed: 0, failed: 0 };
  sum.silenced = await markSilentCollectors(now, await readTezgahCollectorSilenceMinutes(), opts.onlyCollectorIds);
  await closeOverdueCardStops(now, await readTezgahMaxOpenStopHours(), sum, opts.onlyMachineIds);
  await applyLateEnds(sum, opts.onlyMachineIds, opts.afterLateQueueRead);
  return sum;
}

/** Sağlık sayaçları — sessiz kart ve geciken kapanış kuyruğu (panel D5 bunları gösterir). */
export async function readMachineWatchdogCounters(): Promise<{ silentCollectors: number; lateStopEnds: number }> {
  const silentCollectors = await prisma.machineCollector.count({ where: { silentSince: { not: null }, revokedAt: null, isActive: true } });
  const lateStopEnds = await prisma.machineStopEvent.count({ where: LATE_STOP_END_WHERE });
  return { silentCollectors, lateStopEnds };
}
