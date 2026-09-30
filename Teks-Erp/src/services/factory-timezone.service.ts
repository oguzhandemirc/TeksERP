// Fabrika saat dilimi — okuma (açılış yükleyicisi), önizleme ve TEK yazma yolu.
// Dilim bir KURULUM DEĞERİDİR: gün anahtarlarını kaydırdığı için ham ayar ucundan yazılmaz,
// değişiklik önizlenir ve atomik claim + audit ile yazılır. Tasarım: docs/design/FABRIKA-SAAT-DILIMI.md.
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  DEFAULT_FACTORY_TIMEZONE,
  applyFactoryTimezone,
  factoryTimezoneWarning,
  getFactoryTimezone,
  isValidFactoryTimezone,
  noteStoredFactoryTimezone,
} from "../constants/time";
import { SETTING_KEYS, invalidateFeatureFlagsCache, readFactoryTimezoneSetting } from "./system-setting.service";

const KEY = SETTING_KEYS.COMPANY_TIMEZONE;
const PREVIEW_DAYS = 30;

/** Bir anın verilen dilimdeki UTC ofseti (dakika). */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

function zoneDay(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/**
 * Kayıtlı dilimi okuyup süreç içi değere yazar. Geçersiz kayıt sunucuyu DURDURMAZ: varsayılan dilimle
 * açılır ve sağlık ucu + panel `FACTORY_TIMEZONE_INVALID_STORED` uyarısını gösterir (kullanıcı kararı §5.2).
 */
export async function loadFactoryTimezoneAtBoot(): Promise<{ timeZone: string; storedInvalid: boolean }> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  const stored = row ? row.value : DEFAULT_FACTORY_TIMEZONE;
  if (!isValidFactoryTimezone(stored)) {
    applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
    noteStoredFactoryTimezone(false, stored);
    return { timeZone: DEFAULT_FACTORY_TIMEZONE, storedInvalid: true };
  }
  applyFactoryTimezone(stored);
  noteStoredFactoryTimezone(true);
  return { timeZone: stored, storedInvalid: false };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

function logLoaded(log: { info: (m: string) => void; warn: (m: string) => void }, r: { timeZone: string; storedInvalid: boolean }): void {
  if (r.storedInvalid) log.warn(factoryTimezoneWarning()?.message ?? `company.timezone geçersiz — ${r.timeZone}`);
  else log.info(`fabrika saat dilimi: ${r.timeZone}`);
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
  log.warn(`ayar okunamadı — ${getFactoryTimezone()} ile açılıyor, arka planda yeniden denenecek`);
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

export interface FactoryTimezonePreview {
  current: string;
  proposed: string;
  changed: boolean;
  /** Kayıtlı değer geçersiz (sunucu `current` ile koşuyor) — aynı dilimi kaydetmek de onu düzeltir. */
  storedInvalid: boolean;
  currentOffset: string;
  proposedOffset: string;
  todayCurrent: string;
  todayProposed: string;
  recentRollsShifted: number;
  recentShipmentsShifted: number;
  windowDays: number;
  warnings: string[];
}

async function countShifted(from: string, to: string, now: Date): Promise<{ rolls: number; shipments: number }> {
  const since = new Date(now.getTime() - PREVIEW_DAYS * 86_400_000);
  // Saat dilimleri bind parametresi — bu sorgu ifade istatistiği aramaz.
  const rows = await prisma.$queryRaw<Array<{ rolls: bigint; shipments: bigint }>>`
    SELECT
      (SELECT count(*) FROM rolls
        WHERE "createdAt" >= ${since}
          AND ("createdAt" AT TIME ZONE ${from})::date <> ("createdAt" AT TIME ZONE ${to})::date)::bigint AS rolls,
      (SELECT count(*) FROM shipments
        WHERE "dispatchedAt" >= ${since}
          AND ("dispatchedAt" AT TIME ZONE ${from})::date <> ("dispatchedAt" AT TIME ZONE ${to})::date)::bigint AS shipments`;
  return { rolls: Number(rows[0]?.rolls ?? 0), shipments: Number(rows[0]?.shipments ?? 0) };
}

export async function previewFactoryTimezone(proposed: string, now: Date = new Date()): Promise<FactoryTimezonePreview> {
  if (!isValidFactoryTimezone(proposed)) {
    throw AppError.badRequest("Geçerli bir IANA saat dilimi seçin (ör. Europe/Istanbul)", { code: "FACTORY_TIMEZONE_INVALID" });
  }
  const stored = await readFactoryTimezoneSetting();
  const storedInvalid = stored === null;
  const current = stored ?? getFactoryTimezone();
  const shifts = current !== proposed;
  // Geçersiz kayıt yürürlükteki dilimle de düzeltilebilsin: aynı dilimi kaydetmek bir değişikliktir.
  const changed = shifts || storedInvalid;
  const curOff = zoneOffsetMinutes(current, now);
  const newOff = zoneOffsetMinutes(proposed, now);
  const { rolls, shipments } = shifts ? await countShifted(current, proposed, now) : { rolls: 0, shipments: 0 };
  const warnings: string[] = [];
  if (storedInvalid) warnings.push(`Kayıtlı değer geçersiz; kaydetmek onu ${proposed} ile değiştirir.`);
  if (shifts) {
    warnings.push(
      `Gün sınırı ${fmtOffset(curOff)} yerine ${fmtOffset(newOff)} ile çizilecek: geçmiş günlerin rapor toplamları yeni dilimle yeniden hesaplanır.`,
      `Son ${PREVIEW_DAYS} günde ${rolls} top girişi ve ${shipments} sevkiyat başka bir güne düşecek.`,
      "Basılmış belgeler ve verilmiş numaralar DEĞİŞMEZ; yeni numaraların tarih segmenti yeni dilimin gününden üretilir.",
      "Panel, tablet, belge ve patron bulutu saatleri yeni dilimle gösterilir.",
      "Sunucu yöneticisi denetim raporu gün istatistiğini yeni dilim için yeniden kurmalı (DEPLOY-RUNBOOK §12); yapılmazsa rapor doğru ama yavaş olur.",
    );
  }
  return {
    current, proposed, changed, storedInvalid,
    currentOffset: fmtOffset(curOff), proposedOffset: fmtOffset(newOff),
    todayCurrent: zoneDay(current, now), todayProposed: zoneDay(proposed, now),
    recentRollsShifted: rolls, recentShipmentsShifted: shipments, windowDays: PREVIEW_DAYS, warnings,
  };
}

/**
 * TEK yazma yolu. `expectedCurrent` önizlemede görülen dilimdir: arada başka biri değiştirdiyse 409
 * (atomik claim — `updateMany WHERE value = beklenen`; satır yoksa varsayılandan `create`, yarışı P2002 → 409).
 */
export async function setFactoryTimezone(
  input: { timeZone: string; expectedCurrent: string },
  userId: string | undefined,
): Promise<{ timeZone: string; changed: boolean }> {
  if (!userId) throw AppError.unauthorized();
  if (!isValidFactoryTimezone(input.timeZone)) {
    throw AppError.badRequest("Geçerli bir IANA saat dilimi seçin (ör. Europe/Istanbul)", { code: "FACTORY_TIMEZONE_INVALID" });
  }
  if (input.timeZone === input.expectedCurrent) {
    const current = await readFactoryTimezoneSetting();
    if (current === input.timeZone) return { timeZone: current, changed: false };
  }
  let claimed = await prisma.systemSetting.updateMany({
    where: { key: KEY, value: { equals: input.expectedCurrent } },
    data: { value: input.timeZone, updatedById: userId },
  });
  let oldValue: unknown = input.expectedCurrent;
  // Kayıtlı değer geçersizse panel yürürlükteki dilimi görmüştür: claim ham geçersiz değer üzerinden.
  if (claimed.count === 0 && input.expectedCurrent === getFactoryTimezone()) {
    const row = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
    if (row && row.value !== null && !isValidFactoryTimezone(row.value)) {
      claimed = await prisma.systemSetting.updateMany({
        where: { key: KEY, value: { equals: row.value as Prisma.InputJsonValue } },
        data: { value: input.timeZone, updatedById: userId },
      });
      oldValue = row.value;
    }
  }
  let created = false;
  if (claimed.count === 0 && input.expectedCurrent === DEFAULT_FACTORY_TIMEZONE) {
    try {
      await prisma.systemSetting.create({
        data: { key: KEY, value: input.timeZone, description: "Fabrika saat dilimi (IANA)", updatedById: userId },
      });
      created = true;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }
  if (claimed.count === 0 && !created) {
    const fresh = await readFactoryTimezoneSetting();
    throw AppError.conflict(
      `Saat dilimi bu arada değişti (şu an: ${fresh ?? "geçersiz kayıt"}). Önizlemeyi yenileyip tekrar deneyin.`,
      { code: "FACTORY_TIMEZONE_CHANGED", current: fresh },
    );
  }
  applyFactoryTimezone(input.timeZone);
  noteStoredFactoryTimezone(true);
  invalidateFeatureFlagsCache();
  await AuditService.log({
    userId,
    action: created ? "CREATE" : "UPDATE",
    tableName: "SYSTEM_SETTING",
    recordId: KEY,
    oldData: { value: oldValue },
    newData: { value: input.timeZone },
  });
  return { timeZone: input.timeZone, changed: true };
}
