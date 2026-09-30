// Fabrika saat dilimi — dönem defteri (`factory_timezone_periods`): açılış yükleyicisi, önizleme, TEK yazma yolu
// ve iptal. Kullanıcı kararı 2026-09-30: geçmiş kayıtlar etkilenmez — değişiklik yeni dilimin bir sonraki gün
// başından geçerli bir DÖNEM ekler; iptal SİLME değil aynı anda önceki dilimle ters kayıttır.
// Tasarım: docs/design/FABRIKA-SAAT-DILIMI.md.
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  DEFAULT_FACTORY_TIMEZONE,
  factoryTimezoneAt,
  factoryTimezoneChangeStart,
  factoryTimezoneWarning,
  getFactoryTimezone,
  getFactoryTimezonePeriods,
  isValidFactoryTimezone,
} from "../constants/time";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "./system-setting.service";
import { factoryTimezonePeriodStampTx } from "./helpers/ledger-stamp.helper";
import {
  type FactoryTimezonePending,
  applyFactoryTimezoneRows,
  pendingFactoryTimezone,
} from "./helpers/factory-timezone-state.helper";

export type Db = Pick<typeof prisma, "factoryTimezonePeriod" | "systemSetting">;

/** Advisory kilit uzayı (envanter: helpers/period-guard.helper.ts) — dönem defterine yazan her tx'in İLK ifadesi. */
export const FACTORY_TIMEZONE_LOCK_NS: number = 8037;

const PERIOD_SELECT = { id: true, timeZone: true, validFrom: true, createdAt: true, reversesPeriodId: true } as const;
const PERIOD_ORDER: Prisma.FactoryTimezonePeriodOrderByWithRelationInput[] = [
  { validFrom: "asc" }, { createdAt: "asc" }, { id: "asc" },
];

/** Defteri ve eski tek değerli ayarı okuyup süreç değerine uygular (tx içinde de aynı okuma). */
export async function loadAndApply(db: Db, now: Date = new Date()): Promise<ReturnType<typeof applyFactoryTimezoneRows> & { legacyRaw: unknown }> {
  const rows = await db.factoryTimezonePeriod.findMany({ select: PERIOD_SELECT, orderBy: PERIOD_ORDER });
  const legacy = await db.systemSetting.findUnique({ where: { key: SETTING_KEYS.COMPANY_TIMEZONE }, select: { value: true } });
  return { ...applyFactoryTimezoneRows(rows, { present: legacy !== null, value: legacy?.value }, now), legacyRaw: legacy?.value };
}

/**
 * Dönemleri okuyup süreç içi değere yazar. Geçersiz kayıt sunucuyu DURDURMAZ: o dönem varsayılanla yorumlanır ve
 * sağlık ucu + panel `FACTORY_TIMEZONE_INVALID_STORED` uyarısını gösterir (kullanıcı kararı I9 §5.2).
 */
export async function loadFactoryTimezoneAtBoot(): Promise<{ timeZone: string; storedInvalid: boolean }> {
  const { storedInvalid } = await loadAndApply(prisma);
  return { timeZone: getFactoryTimezone(), storedInvalid };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

function logLoaded(log: { info: (m: string) => void; warn: (m: string) => void }, r: { timeZone: string; storedInvalid: boolean }): void {
  if (r.storedInvalid) log.warn(factoryTimezoneWarning()?.message ?? `saat dilimi kaydı geçersiz — ${r.timeZone}`);
  else log.info(`fabrika saat dilimi: ${r.timeZone} (${getFactoryTimezonePeriods().length} dönem)`);
}

/**
 * `listen`den ÖNCE beklenir. DB'ye `waitMs` içinde ulaşılamazsa dinleyici bugünkü gibi açılır
 * (DB kapalıyken hiçbir yazma zaten olmaz) ve yükleme arka planda sürer.
 */
export async function bootFactoryTimezone(
  log: { info: (m: string) => void; warn: (m: string, e?: unknown) => void },
  waitMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      logLoaded(log, await loadFactoryTimezoneAtBoot());
      return;
    } catch {
      if (Date.now() >= deadline) break;
      await sleep(1000);
    }
  }
  log.warn(`saat dilimi dönemleri okunamadı — ${getFactoryTimezone()} ile açılıyor, arka planda yeniden denenecek`);
  void (async () => {
    for (;;) {
      await sleep(5000);
      try {
        logLoaded(log, await loadFactoryTimezoneAtBoot());
        return;
      } catch {
        /* DB hâlâ yok — tekrar dene */
      }
    }
  })();
}

export interface FactoryTimezonePendingDto {
  id: string;
  timeZone: string;
  validFrom: string;
  previousTimeZone: string;
}

export const pendingDto = (p: FactoryTimezonePending | null): FactoryTimezonePendingDto | null =>
  p ? { id: p.id, timeZone: p.timeZone, validFrom: p.validFrom.toISOString(), previousTimeZone: p.previousTimeZone } : null;

export function invalidTz(): never {
  throw AppError.badRequest("Geçerli bir IANA saat dilimi seçin (ör. Europe/Istanbul)", { code: "FACTORY_TIMEZONE_INVALID" });
}

async function reloadAfterCommit(): Promise<void> {
  try {
    await loadAndApply(prisma);
  } finally {
    invalidateFeatureFlagsCache();
  }
}

/**
 * TEK yazma yolu: yeni dilimi bir sonraki gün başından geçerli bir DÖNEM olarak ekler. `expectedCurrent`
 * önizlemede görülen dilimdir. Eşzamanlı iki değişiklik 8037 kilidiyle sıraya girer (tx'in İLK ifadesi); kilitten
 * sonra defter taze okunur: arada dilim değiştiyse 409 `FACTORY_TIMEZONE_CHANGED`, bekleyen başka değişiklik varsa
 * 409 `FACTORY_TIMEZONE_PENDING`. Aynı değişiklik zaten bekliyorsa yeniden deneme sonucu döner (idempotent).
 */
export async function setFactoryTimezone(
  input: { timeZone: string; expectedCurrent: string; reason?: string },
  userId: string | undefined,
): Promise<{ timeZone: string; changed: boolean; effectiveFrom: string | null; pending: FactoryTimezonePendingDto | null }> {
  if (!userId) throw AppError.unauthorized();
  if (!isValidFactoryTimezone(input.timeZone)) invalidTz();
  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FACTORY_TIMEZONE_LOCK_NS}::int, 0)`;
    const now = new Date();
    const { periodInvalid, legacyInvalid, legacyRaw } = await loadAndApply(tx, now);
    const current = factoryTimezoneAt(now);
    const pending = pendingFactoryTimezone(now);
    if (pending) {
      if (pending.timeZone === input.timeZone) return { created: null, legacyFixed: false, current, pending };
      throw AppError.conflict(
        `Bekleyen bir saat dilimi değişikliği var (${pending.timeZone}). Önce onu iptal edin.`,
        { code: "FACTORY_TIMEZONE_PENDING", pending: pendingDto(pending) },
      );
    }
    if (current !== input.expectedCurrent) {
      throw AppError.conflict(
        `Saat dilimi bu arada değişti (şu an: ${current}). Önizlemeyi yenileyip tekrar deneyin.`,
        { code: "FACTORY_TIMEZONE_CHANGED", current },
      );
    }
    // Eski tek değerli ayar geçersizse zaten varsayılanla yorumlanıyor: varsayılanı yazmak hiçbir anın dilimini
    // değiştirmez, yalnız uyarıyı kapatır (claim ham değer üzerinden — arada değiştiyse dokunulmaz).
    let legacyFixed = false;
    if (legacyInvalid) {
      const r = await tx.systemSetting.updateMany({
        where: { key: SETTING_KEYS.COMPANY_TIMEZONE, value: { equals: (legacyRaw ?? null) as Prisma.InputJsonValue } },
        data: { value: DEFAULT_FACTORY_TIMEZONE, updatedById: userId },
      });
      legacyFixed = r.count === 1;
    }
    if (input.timeZone === current && !periodInvalid) return { created: null, legacyFixed, current, pending: null };
    const validFrom = factoryTimezoneChangeStart(input.timeZone, now);
    const created = await tx.factoryTimezonePeriod.create({
      data: {
        timeZone: input.timeZone, validFrom, reason: input.reason ?? null,
        createdById: userId, createdAt: await factoryTimezonePeriodStampTx(tx),
      },
      select: { id: true, validFrom: true },
    });
    return { created, legacyFixed, current, pending: null };
  });
  if (out.legacyFixed) {
    await AuditService.log({
      userId, action: "UPDATE", tableName: "SYSTEM_SETTING", recordId: SETTING_KEYS.COMPANY_TIMEZONE,
      oldData: { value: "geçersiz kayıt" }, newData: { value: DEFAULT_FACTORY_TIMEZONE },
    });
  }
  if (!out.created) {
    if (out.legacyFixed) await reloadAfterCommit();
    return {
      timeZone: input.timeZone, changed: out.legacyFixed, effectiveFrom: out.pending?.validFrom.toISOString() ?? null,
      pending: pendingDto(out.pending),
    };
  }
  await reloadAfterCommit();
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "FACTORY_TIMEZONE_PERIOD",
    recordId: out.created.id,
    oldData: { timeZone: out.current },
    newData: { timeZone: input.timeZone, validFrom: out.created.validFrom.toISOString(), reason: input.reason ?? null },
  });
  return {
    timeZone: input.timeZone, changed: true, effectiveFrom: out.created.validFrom.toISOString(),
    pending: pendingDto(pendingFactoryTimezone()),
  };
}

/**
 * Bekleyen değişikliği iptal eder — SİLMEZ: aynı `validFrom`da önceki dilimle ters kayıt yazar (`reversesPeriodId`;
 * aynı anda en son satır kazanır). Yürürlüğe girmiş dönem iptal edilemez (geçmiş değişmez) → 409.
 */
export async function cancelFactoryTimezoneChange(
  input: { periodId: string; reason?: string },
  userId: string | undefined,
): Promise<{ cancelledId: string; timeZone: string; validFrom: string }> {
  if (!userId) throw AppError.unauthorized();
  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FACTORY_TIMEZONE_LOCK_NS}::int, 0)`;
    const now = new Date();
    await loadAndApply(tx, now);
    const pending = pendingFactoryTimezone(now);
    if (!pending || pending.id !== input.periodId) {
      throw AppError.conflict(
        "Bu değişiklik artık beklemiyor (iptal edilmiş ya da yürürlüğe girmiş). Ekranı yenileyin.",
        { code: "FACTORY_TIMEZONE_NOT_PENDING", pending: pendingDto(pending) },
      );
    }
    const row = await tx.factoryTimezonePeriod.create({
      data: {
        timeZone: pending.previousTimeZone, validFrom: pending.validFrom, reason: input.reason ?? "İptal",
        reversesPeriodId: pending.id, createdById: userId, createdAt: await factoryTimezonePeriodStampTx(tx),
      },
      select: { id: true },
    });
    return { row, pending };
  });
  await reloadAfterCommit();
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "FACTORY_TIMEZONE_PERIOD",
    recordId: out.row.id,
    oldData: { timeZone: out.pending.timeZone, periodId: out.pending.id },
    newData: { timeZone: out.pending.previousTimeZone, validFrom: out.pending.validFrom.toISOString(), reversesPeriodId: out.pending.id },
  });
  return { cancelledId: out.pending.id, timeZone: out.pending.previousTimeZone, validFrom: out.pending.validFrom.toISOString() };
}

export type FactoryTimezonePeriodStatus = "YURURLUKTE" | "BEKLIYOR" | "GECMIS" | "IPTAL_EDILDI" | "IPTAL_KAYDI" | "ETKISIZ";

/** Dönem defterinin tamamı (en yeni önce) — kim, ne zaman, hangi dilim, hangi durumda. */
export async function listFactoryTimezonePeriods(now: Date = new Date()): Promise<Array<{
  id: string; timeZone: string; validFrom: string; createdAt: string; reason: string | null;
  reversesPeriodId: string | null; valid: boolean; status: FactoryTimezonePeriodStatus;
  createdBy: { id: string; username: string; fullName: string; isSystemAccount: boolean } | null;
}>> {
  await loadAndApply(prisma, now);
  const rows = await prisma.factoryTimezonePeriod.findMany({
    select: { ...PERIOD_SELECT, reason: true, reversedBy: { select: { id: true } },
      createdBy: { select: { id: true, username: true, fullName: true, isSystemAccount: true } } },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const effective = getFactoryTimezonePeriods();
  const currentStart = effective.filter((p) => p.validFrom <= now).at(-1)?.validFrom.getTime();
  const winners = new Map<number, string>();
  for (const r of [...rows].reverse()) if (!r.reversesPeriodId && !r.reversedBy) winners.set(r.validFrom.getTime(), r.id);
  return rows.map((r) => {
    const t = r.validFrom.getTime();
    const isWinner = winners.get(t) === r.id && effective.some((p) => p.validFrom.getTime() === t);
    const status: FactoryTimezonePeriodStatus = r.reversesPeriodId ? "IPTAL_KAYDI"
      : r.reversedBy ? "IPTAL_EDILDI"
      : !isWinner ? "ETKISIZ"
      : t > now.getTime() ? "BEKLIYOR"
      : t === currentStart ? "YURURLUKTE" : "GECMIS";
    return {
      id: r.id, timeZone: r.timeZone, validFrom: r.validFrom.toISOString(), createdAt: r.createdAt.toISOString(),
      reason: r.reason, reversesPeriodId: r.reversesPeriodId, valid: isValidFactoryTimezone(r.timeZone), status,
      createdBy: r.createdBy,
    };
  });
}
