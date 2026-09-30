// Fabrika saat dilimi değişikliğinin ÖNİZLEMESİ — hiçbir şey yazmaz: yürürlük anı (yeni dilimde ertesi gece yarısı)
// iki dilimde, geçişin dokunduğu günlerin süresi ve "geçmiş kayıtlar değişmez" uyarısı. Tasarım:
// docs/design/FABRIKA-SAAT-DILIMI.md.
import prisma from "../lib/prisma";
import {
  factoryDateTimeTr,
  factoryDayEndOfKey,
  factoryDayStartOfKey,
  factoryTimezoneAt,
  factoryTimezoneChangeStart,
  factoryYmd,
  getFactoryBaseTimezone,
  getFactoryTimezonePeriods,
  isValidFactoryTimezone,
  withFactoryTimezonePeriods,
} from "../constants/time";
import { pendingFactoryTimezone } from "./helpers/factory-timezone-state.helper";
import { type FactoryTimezonePendingDto, invalidTz, loadAndApply, pendingDto } from "./factory-timezone.service";

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

function zoneWall(timeZone: string, at: Date): string {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
  const [y, m, d] = zoneDay(timeZone, at).split("-");
  return `${d}.${m}.${y} ${f.format(at)}`;
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export interface FactoryTimezonePreview {
  current: string;
  proposed: string;
  /** Yazılırsa bir dönem eklenir mi (aynı dilim + geçerli kayıt → hayır). */
  changed: boolean;
  /** Yürürlükteki/bekleyen dönemin kaydı geçersiz — aynı dilimi seçip kaydetmek de onu düzeltir. */
  storedInvalid: boolean;
  /** Yürürlüğe girmemiş değişiklik; varken yenisi yazılamaz (önce iptal). */
  pending: FactoryTimezonePendingDto | null;
  currentOffset: string;
  proposedOffset: string;
  todayCurrent: string;
  /** Yürürlük anı (ISO) ve o anın iki dilimdeki duvar saati; değişiklik yoksa null. */
  effectiveFrom: string | null;
  effectiveFromCurrentLocal: string | null;
  effectiveFromProposedLocal: string | null;
  /** Geçişin dokunduğu fabrika günleri ve süreleri (saat) — gün bölünmez, uzar ya da kısalır. */
  transitionDays: Array<{ day: string; hours: number }>;
  warnings: string[];
}

const fmtDay = (key: string): string => key.split("-").reverse().join(".");

export async function previewFactoryTimezone(proposed: string, now: Date = new Date()): Promise<FactoryTimezonePreview> {
  if (!isValidFactoryTimezone(proposed)) invalidTz();
  const { storedInvalid } = await loadAndApply(prisma, now);
  const current = factoryTimezoneAt(now);
  const pending = pendingFactoryTimezone(now);
  const changed = !pending && (proposed !== current || storedInvalid);
  const warnings: string[] = [];
  let effective: Date | null = null;
  let transitionDays: Array<{ day: string; hours: number }> = [];
  if (pending) {
    warnings.push(`Bekleyen bir değişiklik var (${pending.timeZone}, ${factoryDateTimeTr(pending.validFrom)}): yenisi için önce onu iptal edin.`);
  } else if (changed) {
    const e = factoryTimezoneChangeStart(proposed, now);
    effective = e;
    transitionDays = withFactoryTimezonePeriods(
      [...getFactoryTimezonePeriods(), { validFrom: e, timeZone: proposed }], getFactoryBaseTimezone(),
      () => [...new Set([factoryYmd(new Date(e.getTime() - 1)), factoryYmd(e)])].map((day) => ({
        day, hours: Math.round((factoryDayEndOfKey(day).getTime() + 1 - factoryDayStartOfKey(day).getTime()) / 36e5 * 100) / 100,
      })),
    );
    if (storedInvalid) warnings.push(`Kayıtlı saat dilimi geçersiz; kaydetmek ${proposed} dönemini ekleyerek onu düzeltir.`);
    warnings.push(
      "Geçmiş kayıtlar DEĞİŞMEZ: bugüne kadarki kayıtların saati ve günü kaydedildikleri andaki dilimle kalır; basılmış belgeler, verilmiş numaralar ve geçmiş rapor günleri aynen kalır.",
      `Değişiklik ${zoneWall(proposed, e)} (${proposed}) = ${zoneWall(current, e)} (${current}) itibarıyla geçerli olur; o andan sonraki kayıtlar ${proposed} saatiyle kaydedilir ve gösterilir.`,
      ...transitionDays.filter((d) => d.hours !== 24).map((d) => `${fmtDay(d.day)} günü ${d.hours} saat sürer (geçiş günü; gün bölünmez).`),
      "Değişiklik yürürlüğe girene kadar iptal edilebilir.",
      "Sunucu yöneticisi denetim raporu gün istatistiğini yeniden kurmalı (DEPLOY-RUNBOOK §12); yapılmazsa rapor doğru ama yavaş olur.",
    );
  }
  return {
    current, proposed, changed, storedInvalid, pending: pendingDto(pending),
    currentOffset: fmtOffset(zoneOffsetMinutes(current, now)), proposedOffset: fmtOffset(zoneOffsetMinutes(proposed, now)),
    todayCurrent: zoneDay(current, now),
    effectiveFrom: effective ? effective.toISOString() : null,
    effectiveFromCurrentLocal: effective ? zoneWall(current, effective) : null,
    effectiveFromProposedLocal: effective ? zoneWall(proposed, effective) : null,
    transitionDays, warnings,
  };
}
