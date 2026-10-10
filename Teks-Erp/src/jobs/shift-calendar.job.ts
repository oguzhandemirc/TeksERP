// =============================================================================
// Vardiya takvimi materyalizasyonu — `ShiftDefinition` × fabrika günü → `ShiftInstance`
// =============================================================================
// node-cron allowed-packages dışında olduğu için setInterval ile gidiyoruz
// (archive-scheduler kalıbı). Tek Express process varsayımı.
//
// Davranış:
//   - `dokuma.enabled` KAPALIYKEN tam no-op ("disabled") — referans fabrikada
//     `shift_instances` satırı DOĞMAZ (sıfır fark). Bayrak her koşumda taze okunur.
//   - Bugünden SHIFT_CALENDAR_DAYS_AHEAD gün ileriye plan (`shift-calendar-plan.helper`);
//     tanım ekranının önizlemesi AYNI planı okur.
//   - İDEMPOTENT: `@@unique([shiftDefinitionId, factoryDayKey])` — ikinci koşum
//     satır doğurmaz, advisory kilit YOK (yarışın kaybedeni P2002 → "unchanged").
//   - YALNIZ İLERİ: başlamamış ∧ mühürsüz pencere yeni kurala çekilir (satır silinmez);
//     başlamış/geçmiş pencere ve mühürlü karne DEĞİŞMEZ; yeni pencere yalnız gelecekte doğar.
//     Koşullar yazımın KENDİ `updateMany` yükleminde (claim), count 0 → "sealedSkipped".
//   - Kural artık kapsamayan gelecek pencere (tanım arşivlendi, haftagünü düştü) silinmez,
//     takvim sebebiyle İPTAL edilir; kural geri gelince yalnız o sebeple iptal edilen dirilir.
//     Başka sebepli iptal (tatil/elle) korunur.
// =============================================================================

import prisma from "../lib/prisma";
import { readDokumaEnabled } from "../services/system-setting.service";
import {
  planShiftCalendar,
  SHIFT_CALENDAR_CANCEL_REASON,
  SHIFT_CALENDAR_DAYS_AHEAD,
  type PlanAction,
  type PlanDefinition,
  type PlanWindow,
} from "../services/helpers/shift-calendar-plan.helper";
import { reportJobFailure } from "./job-failure";
import { bilgi } from "../lib/logger";

export { SHIFT_CALENDAR_DAYS_AHEAD };
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
  /** Başlamış pencere — tanım değişse de yeniden yazılmadı. */
  startedSkipped: number;
  /** Kural artık kapsamadığı için takvim sebebiyle iptal edilen gelecek pencere. */
  retired: number;
}
export type ShiftCalendarOutcome = "disabled" | ShiftCalendarSummary;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export interface ShiftCalendarRunOptions {
  /** Test enjeksiyonu: "bugün" bu andan türer; üretimde `new Date()`. */
  now?: Date;
  /** Yalnız bu tanımlar (tanım yazımı kendi tanımını tetikler, bekçi fikstürüne daraltır); yoksa HEPSİ. */
  onlyDefinitionIds?: string[];
}

/** Planın girdileri — job ve tanım önizlemesi aynı okumayı yapar. */
export async function loadShiftCalendarInputs(
  defIds: string[] | undefined,
  fromDayKey: Date,
): Promise<{ defs: PlanDefinition[]; existing: PlanWindow[] }> {
  const defs = await prisma.shiftDefinition.findMany({
    where: defIds ? { id: { in: defIds } } : {},
    select: { id: true, startMinute: true, durationMinutes: true, activeWeekdays: true, isActive: true },
  });
  const rows = await prisma.shiftInstance.findMany({
    where: { shiftDefinitionId: { in: defs.map((d) => d.id) }, factoryDayKey: { gte: fromDayKey } },
    select: {
      id: true, shiftDefinitionId: true, factoryDayKey: true, startsAt: true, endsAt: true,
      isCancelled: true, cancelReason: true,
      _count: { select: { machineStats: { where: { sealState: "SEALED" } } } },
    },
  });
  const existing = rows.map(({ _count, ...w }) => ({ ...w, sealed: _count.machineStats > 0 }));
  return { defs, existing };
}

/** Tek koşum — zamanlayıcı, tanım yazımı ve bekçi aynı fonksiyonu çağırır. */
export async function runShiftCalendarOnce(opts: ShiftCalendarRunOptions = {}): Promise<ShiftCalendarOutcome> {
  if (!(await readDokumaEnabled())) return "disabled";

  const now = opts.now ?? new Date();
  const sum: ShiftCalendarSummary = { created: 0, rewritten: 0, sealedSkipped: 0, unchanged: 0, startedSkipped: 0, retired: 0 };
  const fromDayKey = planShiftCalendar([], [], now).fromDayKey;
  const { defs, existing } = await loadShiftCalendarInputs(opts.onlyDefinitionIds, fromDayKey);
  if (defs.length === 0) return sum;

  const plan = planShiftCalendar(defs, existing, now);
  sum.unchanged += plan.unchanged;
  for (const a of plan.actions) await applyAction(sum, a, now);

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: now.toISOString(), description: "Vardiya takvimi job'unun son koşumu" },
    update: { value: now.toISOString() },
  });
  return sum;
}

async function applyAction(sum: ShiftCalendarSummary, a: PlanAction, now: Date): Promise<void> {
  switch (a.kind) {
    case "create": {
      try {
        await prisma.shiftInstance.create({
          data: { shiftDefinitionId: a.shiftDefinitionId, factoryDayKey: a.factoryDayKey, startsAt: a.startsAt, endsAt: a.endsAt },
        });
        sum.created += 1;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        sum.unchanged += 1; // yarışın kaybedeni — satır zaten doğdu
      }
      return;
    }
    case "rewrite": {
      // Başlamamış + mühürsüz + (dirilişte) hâlâ takvim iptali — hepsi TEK yüklemde.
      const r = await prisma.shiftInstance.updateMany({
        where: {
          id: a.window.id,
          startsAt: { gt: now },
          machineStats: { none: { sealState: "SEALED" } },
          ...(a.revive ? { isCancelled: true, cancelReason: SHIFT_CALENDAR_CANCEL_REASON } : {}),
        },
        data: { ...a.to, ...(a.revive ? { isCancelled: false, cancelReason: null } : {}) },
      });
      if (r.count === 0) sum.sealedSkipped += 1;
      else sum.rewritten += 1;
      return;
    }
    case "retire": {
      const r = await prisma.shiftInstance.updateMany({
        where: { id: a.window.id, isCancelled: false, startsAt: { gt: now }, machineStats: { none: { sealState: "SEALED" } } },
        data: { isCancelled: true, cancelReason: SHIFT_CALENDAR_CANCEL_REASON },
      });
      if (r.count === 0) sum.sealedSkipped += 1;
      else sum.retired += 1;
      return;
    }
    case "sealedSkipped":
      sum.sealedSkipped += 1;
      return;
    case "startedSkipped":
      sum.startedSkipped += 1;
      return;
  }
}

export function startShiftCalendarScheduler(): void {
  if (timer) return;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runShiftCalendarOnce()
      .then((r) => {
        if (r !== "disabled" && (r.created > 0 || r.rewritten > 0 || r.retired > 0 || r.sealedSkipped > 0)) {
          bilgi("shift-calendar", `vardiya takvimi: ${r.created} yeni, ${r.rewritten} yeniden yazıldı, ${r.retired} iptal, ${r.sealedSkipped} mühürlü atlandı`);
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
