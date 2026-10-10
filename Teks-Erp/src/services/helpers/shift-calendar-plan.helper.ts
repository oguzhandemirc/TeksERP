// =============================================================================
// Vardiya takvimi PLANI — tanımlar × fabrika günleri → pencere eylemleri (SAF)
// =============================================================================
// Takvimi yazan job ile tanım ekranının önizlemesi AYNI planı okur: önizleme "kaydedersen
// ne olur" sorusunu job'un kendi diff'iyle cevaplar, ikinci bir kopya yazılmaz.
// Değişmez: yalnız HENÜZ BAŞLAMAMIŞ ve karnesi mühürsüz pencere değişir; başlamış/geçmiş
// pencere ve mühürlü karne tanım değişikliğinden etkilenmez (geçmiş yeniden yazılmaz).
// =============================================================================
import {
  factoryDayKeyUtcMidnight,
  factoryDayStart,
  factoryMinuteOfDay,
  factoryWeekday,
} from "../../constants/time";

/** Kaç gün ileri materyalize edilir (bugün dahil). */
export const SHIFT_CALENDAR_DAYS_AHEAD = 30;

/**
 * Takvimin KENDİ iptal sebebi — tanım arşivlenince ya da haftagünü düşünce gelecek pencere
 * bununla iptal edilir; kural geri gelirse yalnız BU sebeple iptal edilmiş pencere dirilir.
 * Başka sebepli iptal (tatil, elle) insan kararıdır ve takvim ona dokunmaz.
 */
export const SHIFT_CALENDAR_CANCEL_REASON = "Vardiya tanımı bu günü artık kapsamıyor (takvim)";

export interface PlanDefinition {
  id: string;
  startMinute: number;
  durationMinutes: number;
  activeWeekdays: number[];
  isActive: boolean;
}

export interface PlanWindow {
  id: string;
  shiftDefinitionId: string;
  factoryDayKey: Date;
  startsAt: Date;
  endsAt: Date;
  isCancelled: boolean;
  cancelReason: string | null;
  /** Karnesi mühürlü mü (en az bir `MachineShiftStat.sealState = SEALED`). */
  sealed: boolean;
}

export interface WindowTimes { startsAt: Date; endsAt: Date }

export type PlanAction =
  | { kind: "create"; shiftDefinitionId: string; factoryDayKey: Date; startsAt: Date; endsAt: Date }
  | { kind: "rewrite"; window: PlanWindow; to: WindowTimes; revive: boolean }
  | { kind: "retire"; window: PlanWindow }
  | { kind: "sealedSkipped"; window: PlanWindow }
  | { kind: "startedSkipped"; window: PlanWindow };

export interface ShiftCalendarPlan {
  actions: PlanAction[];
  unchanged: number;
  /** Planın baktığı ilk fabrika günü (UTC gece yarısı anahtarı) — mevcut pencere sorgusunun alt sınırı. */
  fromDayKey: Date;
}

const DAY_MS = 86_400_000;

/** Ufuktaki fabrika günleri — öğlen çıpası: DST gününde ±1 sa kayma takvim gününü değiştirmesin. */
export function shiftCalendarDays(now: Date): Array<{ anchor: Date; weekday: number; factoryDayKey: Date }> {
  const todayStart = factoryDayStart(now);
  return Array.from({ length: SHIFT_CALENDAR_DAYS_AHEAD }, (_, i) => {
    const anchor = new Date(todayStart.getTime() + i * DAY_MS + 12 * 3600_000);
    return { anchor, weekday: factoryWeekday(anchor), factoryDayKey: factoryDayKeyUtcMidnight(anchor) };
  });
}

/** Tanımın o günü kapsayıp kapsamadığı — boş dizi HER GÜN demektir. */
export function definitionCoversWeekday(def: Pick<PlanDefinition, "activeWeekdays">, weekday: number): boolean {
  return def.activeWeekdays.length === 0 || def.activeWeekdays.includes(weekday);
}

const key = (defId: string, dayKey: Date): string => `${defId}|${dayKey.getTime()}`;

/**
 * SAF plan. `existing` = kapsamdaki tanımların `fromDayKey` ve sonrasındaki pencereleri.
 * Kural: başlamamış (startsAt > now) ∧ mühürsüz pencere yeni kurala çekilir; kural o günü
 * artık kapsamıyorsa takvim sebebiyle iptal edilir; yeni pencere yalnız gelecekte doğar.
 */
export function planShiftCalendar(defs: PlanDefinition[], existing: PlanWindow[], now: Date): ShiftCalendarPlan {
  const days = shiftCalendarDays(now);
  const byKey = new Map(existing.map((w) => [key(w.shiftDefinitionId, w.factoryDayKey), w]));
  const expected = new Set<string>();
  const actions: PlanAction[] = [];
  let unchanged = 0;
  const nowMs = now.getTime();

  for (const day of days) {
    for (const def of defs) {
      if (!def.isActive || !definitionCoversWeekday(def, day.weekday)) continue;
      const k = key(def.id, day.factoryDayKey);
      expected.add(k);
      const to = {
        startsAt: factoryMinuteOfDay(day.anchor, def.startMinute),
        endsAt: factoryMinuteOfDay(day.anchor, def.startMinute + def.durationMinutes),
      };
      const w = byKey.get(k);
      if (!w) {
        if (to.startsAt.getTime() > nowMs) actions.push({ kind: "create", shiftDefinitionId: def.id, factoryDayKey: day.factoryDayKey, ...to });
        else unchanged += 1; // başlamış pencere SONRADAN doğmaz — geçmişe takvim yazılmaz
        continue;
      }
      const revive = w.isCancelled && w.cancelReason === SHIFT_CALENDAR_CANCEL_REASON;
      const sameTimes = w.startsAt.getTime() === to.startsAt.getTime() && w.endsAt.getTime() === to.endsAt.getTime();
      if (sameTimes && !revive) { unchanged += 1; continue; }
      if (w.startsAt.getTime() <= nowMs) { actions.push({ kind: "startedSkipped", window: w }); continue; }
      if (w.sealed) { actions.push({ kind: "sealedSkipped", window: w }); continue; }
      actions.push({ kind: "rewrite", window: w, to, revive });
    }
  }

  for (const w of existing) {
    if (expected.has(key(w.shiftDefinitionId, w.factoryDayKey))) continue;
    if (w.isCancelled || w.startsAt.getTime() <= nowMs) continue;
    if (w.factoryDayKey.getTime() > days[days.length - 1]!.factoryDayKey.getTime()) continue; // ufuk dışı
    if (w.sealed) { actions.push({ kind: "sealedSkipped", window: w }); continue; }
    actions.push({ kind: "retire", window: w });
  }

  return { actions, unchanged, fromDayKey: days[0]!.factoryDayKey };
}
