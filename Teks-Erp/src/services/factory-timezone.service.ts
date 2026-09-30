// Fabrika saat dilimi — okuma (açılış yükleyicisi), önizleme ve TEK yazma yolu.
// Dilim bir KURULUM DEĞERİDİR: gün anahtarlarını kaydırdığı için ham ayar ucundan yazılmaz,
// değişiklik önizlenir ve atomik claim + audit ile yazılır. Tasarım: docs/design/FABRIKA-SAAT-DILIMI.md.
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  DEFAULT_FACTORY_TIMEZONE,
  applyFactoryTimezone,
  getFactoryTimezone,
  isValidFactoryTimezone,
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

/** Kayıtlı değer geçersiz — DB hatasından ayrı sınıf: bu durumda sunucu AÇILMAZ. */
export class InvalidFactoryTimezoneError extends Error {}

/** Kayıtlı dilimi okuyup süreç içi değere yazar. Geçersiz kayıt → `InvalidFactoryTimezoneError`. */
export async function loadFactoryTimezoneAtBoot(): Promise<string> {
  const stored = await readFactoryTimezoneSetting();
  if (stored === null) {
    throw new InvalidFactoryTimezoneError(
      "company.timezone geçerli bir IANA saat dilimi değil — sunucu açılmadı. " +
        "Değeri geçerli bir adla (ör. Europe/Istanbul) düzeltip yeniden başlatın.",
    );
  }
  applyFactoryTimezone(stored);
  return stored;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

/**
 * `listen`den ÖNCE beklenir. Geçersiz kayıt → FIRLATIR (fail-closed). DB'ye `waitMs` içinde ulaşılamazsa
 * dinleyici bugünkü gibi açılır (DB kapalıyken hiçbir yazma zaten olmaz) ve yükleme arka planda sürer.
 */
export async function bootFactoryTimezone(
  log: { info: (m: string) => void; warn: (m: string, e?: unknown) => void },
  waitMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      log.info(`fabrika saat dilimi: ${await loadFactoryTimezoneAtBoot()}`);
      return;
    } catch (err) {
      if (err instanceof InvalidFactoryTimezoneError) throw err;
      if (Date.now() >= deadline) break;
      await sleep(1000);
    }
  }
  log.warn(`ayar okunamadı — ${getFactoryTimezone()} ile açılıyor, arka planda yeniden denenecek`);
  void (async () => {
    for (;;) {
      await sleep(5000);
      try {
        log.info(`fabrika saat dilimi yüklendi: ${await loadFactoryTimezoneAtBoot()}`);
        return;
      } catch (err) {
        if (err instanceof InvalidFactoryTimezoneError) {
          log.warn(err.message);
          return;
        }
      }
    }
  })();
}

export interface FactoryTimezonePreview {
  current: string;
  proposed: string;
  changed: boolean;
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
  const current = (await readFactoryTimezoneSetting()) ?? getFactoryTimezone();
  const changed = current !== proposed;
  const curOff = zoneOffsetMinutes(current, now);
  const newOff = zoneOffsetMinutes(proposed, now);
  const { rolls, shipments } = changed ? await countShifted(current, proposed, now) : { rolls: 0, shipments: 0 };
  const warnings: string[] = [];
  if (changed) {
    warnings.push(
      `Gün sınırı ${fmtOffset(curOff)} yerine ${fmtOffset(newOff)} ile çizilecek: geçmiş günlerin rapor toplamları yeni dilimle yeniden hesaplanır.`,
      `Son ${PREVIEW_DAYS} günde ${rolls} top girişi ve ${shipments} sevkiyat başka bir güne düşecek.`,
      "Basılmış belgeler ve verilmiş numaralar DEĞİŞMEZ; yeni numaraların tarih segmenti yeni dilimin gününden üretilir.",
      "Panel, tablet, belge ve patron bulutu saatleri yeni dilimle gösterilir.",
    );
  }
  return {
    current, proposed, changed,
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
    const current = (await readFactoryTimezoneSetting()) ?? getFactoryTimezone();
    if (current === input.timeZone) return { timeZone: current, changed: false };
  }
  const claimed = await prisma.systemSetting.updateMany({
    where: { key: KEY, value: { equals: input.expectedCurrent } },
    data: { value: input.timeZone, updatedById: userId },
  });
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
  invalidateFeatureFlagsCache();
  await AuditService.log({
    userId,
    action: created ? "CREATE" : "UPDATE",
    tableName: "SYSTEM_SETTING",
    recordId: KEY,
    oldData: { value: input.expectedCurrent },
    newData: { value: input.timeZone },
  });
  return { timeZone: input.timeZone, changed: true };
}
