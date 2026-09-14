// =============================================================================
// Vardiya takvimi materyalizasyonu — `ShiftDefinition` × fabrika günü → `ShiftInstance`
// =============================================================================
// node-cron allowed-packages dışında olduğu için setInterval ile gidiyoruz
// (archive-scheduler kalıbı). Tek Express process varsayımı.
//
// Davranış:
//   - `dokuma.enabled` KAPALIYKEN tam no-op ("disabled") — referans fabrikada
//     `shift_instances` satırı DOĞMAZ (sıfır fark). Bayrak her koşumda taze okunur.
//   - Bugünden DAYS_AHEAD gün ileriye, her aktif tanım için pencere yazar.
//   - İDEMPOTENT: `@@unique([shiftDefinitionId, factoryDayKey])` — ikinci koşum
//     satır doğurmaz, advisory kilit YOK (yarışın kaybedeni P2002 → "unchanged").
//   - Tanım değişince (saat/süre) MÜHÜRSÜZ pencere YENİDEN YAZILIR (satır silinmez,
//     iptal bayrağına dokunulmaz); karnesi mühürlü pencere DEĞİŞMEZ — mühür kontrolü
//     ile güncelleme AYNI `updateMany` yükleminde (claim), count 0 → "sealedSkipped".
//   - Pasife alınan tanımın gelecek pencereleri SİLİNMEZ; yalnız yenisi doğmaz.
// =============================================================================

import prisma from "../lib/prisma";
import { readDokumaEnabled } from "../services/system-setting.service";
import {
  factoryDayKeyUtcMidnight,
  factoryDayStart,
  factoryMinuteOfDay,
  factoryWeekday,
} from "../constants/time";
import { reportJobFailure } from "./job-failure";
import { bilgi } from "../lib/logger";

/** Kaç gün ileri materyalize edilir (bugün dahil). */
export const SHIFT_CALENDAR_DAYS_AHEAD = 30;
const SETTING_KEY = "dokuma.shiftCalendarLastRunAt";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 saat
const STARTUP_DELAY_MS = 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export interface ShiftCalendarSummary {
  created: number;
  rewritten: number;
  sealedSkipped: number;
  unchanged: number;
}
export type ShiftCalendarOutcome = "disabled" | ShiftCalendarSummary;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export interface ShiftCalendarRunOptions {
  /** Test enjeksiyonu: "bugün" bu andan türer; üretimde `new Date()`. */
  now?: Date;
  /** Test enjeksiyonu: yalnız bu tanımlar (bekçi kendi fikstürüne daraltır); üretimde HEPSİ. */
  onlyDefinitionIds?: string[];
}

/** Tek koşum — zamanlayıcı ve bekçi aynı fonksiyonu çağırır. */
export async function runShiftCalendarOnce(opts: ShiftCalendarRunOptions = {}): Promise<ShiftCalendarOutcome> {
  if (!(await readDokumaEnabled())) return "disabled";

  const now = opts.now ?? new Date();
  const sum: ShiftCalendarSummary = { created: 0, rewritten: 0, sealedSkipped: 0, unchanged: 0 };
  const defs = await prisma.shiftDefinition.findMany({
    where: { isActive: true, ...(opts.onlyDefinitionIds ? { id: { in: opts.onlyDefinitionIds } } : {}) },
    select: { id: true, startMinute: true, durationMinutes: true, activeWeekdays: true },
  });
  if (defs.length === 0) return sum;

  const todayStart = factoryDayStart(now);
  for (let i = 0; i < SHIFT_CALENDAR_DAYS_AHEAD; i++) {
    // Öğlen çıpası: DST gününde ±1 sa kayma takvim gününü değiştirmesin.
    const anchor = new Date(todayStart.getTime() + i * 86_400_000 + 12 * 3600_000);
    const weekday = factoryWeekday(anchor);
    const factoryDayKey = factoryDayKeyUtcMidnight(anchor);
    for (const def of defs) {
      if (def.activeWeekdays.length > 0 && !def.activeWeekdays.includes(weekday)) continue;
      const startsAt = factoryMinuteOfDay(anchor, def.startMinute);
      const endsAt = factoryMinuteOfDay(anchor, def.startMinute + def.durationMinutes);
      await upsertWindow(sum, { shiftDefinitionId: def.id, factoryDayKey, startsAt, endsAt });
    }
  }

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: now.toISOString(), description: "Vardiya takvimi job'unun son koşumu" },
    update: { value: now.toISOString() },
  });
  return sum;
}

async function upsertWindow(
  sum: ShiftCalendarSummary,
  w: { shiftDefinitionId: string; factoryDayKey: Date; startsAt: Date; endsAt: Date },
): Promise<void> {
  const existing = await prisma.shiftInstance.findUnique({
    where: { shiftDefinitionId_factoryDayKey: { shiftDefinitionId: w.shiftDefinitionId, factoryDayKey: w.factoryDayKey } },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (!existing) {
    try {
      await prisma.shiftInstance.create({ data: w });
      sum.created += 1;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      sum.unchanged += 1; // yarışın kaybedeni — satır zaten doğdu
    }
    return;
  }
  if (existing.startsAt.getTime() === w.startsAt.getTime() && existing.endsAt.getTime() === w.endsAt.getTime()) {
    sum.unchanged += 1;
    return;
  }
  // Mühür kontrolü ve yeniden yazım TEK yüklemde: mühürlü karnesi olan pencere DEĞİŞMEZ.
  const r = await prisma.shiftInstance.updateMany({
    where: { id: existing.id, machineStats: { none: { sealState: "SEALED" } } },
    data: { startsAt: w.startsAt, endsAt: w.endsAt },
  });
  if (r.count === 0) sum.sealedSkipped += 1;
  else sum.rewritten += 1;
}

export function startShiftCalendarScheduler(): void {
  if (timer) return;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runShiftCalendarOnce()
      .then((r) => {
        if (r !== "disabled" && (r.created > 0 || r.rewritten > 0 || r.sealedSkipped > 0)) {
          bilgi("shift-calendar", `vardiya takvimi: ${r.created} yeni, ${r.rewritten} yeniden yazıldı, ${r.sealedSkipped} mühürlü atlandı`);
        }
      })
      .catch((err) => reportJobFailure("shift-calendar", err))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("shift-calendar", `scheduler aktif — dokuma.enabled açıkken ${SHIFT_CALENDAR_DAYS_AHEAD} gün ileri vardiya penceresi yazılacak`);
}
