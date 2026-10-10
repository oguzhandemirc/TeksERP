// =============================================================================
// TeksERP — VARDİYA TANIMI (ShiftDefinition) yazma yüzeyi · dokuma modülü
// =============================================================================
// Vardiya tanımı bir YAPILANDIRMA ana verisidir ("A vardiyası 08:00'de başlar, 8 saat");
// takvimi (`ShiftInstance`) tek yazar `jobs/shift-calendar.job` doğurur. Bu servis tanımı
// yazar ve ardından job'u YALNIZ o tanım için tetikler — ikinci bir takvim yazarı yoktur.
//   • `code` rapor anahtarıdır: doğuşta verilir, ASLA düzenlenmez.
//   • Arşiv = `isActive` durum geçişi (atomik claim); silme yok. Takvimdeki geçmiş/başlamış
//     pencereler ve mühürlü karneler değişmez — etki yalnız ileri (plan helper'ı).
//   • Önizleme job'un kendi planından doğar: kaydedince hangi pencere doğar/değişir/iptal olur.
// Audit best-effort, tx dışında (`SHIFT_DEFINITION`).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { ApiResponse } from "../types/api.types";
import { loadShiftCalendarInputs, runShiftCalendarOnce, type ShiftCalendarOutcome } from "../jobs/shift-calendar.job";
import { planShiftCalendar, type PlanDefinition } from "./helpers/shift-calendar-plan.helper";
import { factoryDateTimeTr, factoryYmd } from "../constants/time";
import { uyari } from "../lib/logger";

const TABLE = "SHIFT_DEFINITION";

export const SHIFT_DEFINITION_SELECT = {
  id: true, code: true, name: true, startMinute: true, durationMinutes: true, plannedBreakMinutes: true,
  activeWeekdays: true, sortOrder: true, isActive: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ShiftDefinitionSelect;
export type ShiftDefinitionDto = Prisma.ShiftDefinitionGetPayload<{ select: typeof SHIFT_DEFINITION_SELECT }>;

/** Yazılabilir alanlar — `code` yalnız doğuşta; `isActive` yalnız arşiv/geri al uçlarından. */
export interface ShiftDefinitionFields {
  name: string;
  startMinute: number;
  durationMinutes: number;
  plannedBreakMinutes: number;
  activeWeekdays: number[];
  sortOrder: number;
}
export type ShiftDefinitionCreateInput = ShiftDefinitionFields & { code: string };

export interface ShiftDefinitionWriteResult {
  definition: ShiftDefinitionDto;
  /** Tetiklenen takvim koşumunun özeti; `null` = koşum düştü, 6 saatlik zamanlayıcı tamamlar. */
  calendar: ShiftCalendarOutcome | null;
}

/** Yedi günün hepsi = kısıt yok = BOŞ dizi (şema sözleşmesi); sıralı ve tekil. SAF. */
export function normalizeWeekdays(days: number[]): number[] {
  const u = [...new Set(days)].sort((a, b) => a - b);
  return u.length === 7 ? [] : u;
}

/** Şema CHECK'inin (`shift_definitions_window_sane`) Türkçe ön kapısı. SAF. */
export function assertShiftWindow(f: Pick<ShiftDefinitionFields, "startMinute" | "durationMinutes" | "plannedBreakMinutes" | "activeWeekdays">): void {
  if (!Number.isInteger(f.startMinute) || f.startMinute < 0 || f.startMinute > 1439) throw AppError.badRequest("Başlangıç saati 00:00 ile 23:59 arasında olmalı.");
  if (!Number.isInteger(f.durationMinutes) || f.durationMinutes < 1 || f.durationMinutes > 1440) throw AppError.badRequest("Vardiya süresi 1 dakika ile 24 saat arasında olmalı.");
  if (!Number.isInteger(f.plannedBreakMinutes) || f.plannedBreakMinutes < 0 || f.plannedBreakMinutes >= f.durationMinutes) {
    throw AppError.badRequest("Planlı mola süresi 0 ya da vardiya süresinden kısa olmalı.");
  }
  if (f.activeWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw AppError.badRequest("Haftanın günü 0 (Pazar) ile 6 (Cumartesi) arasında olmalı.");
}

const hhmm = (m: number): string => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type OverlapDef = Pick<ShiftDefinitionDto, "id" | "code" | "startMinute" | "durationMinutes" | "activeWeekdays">;

/**
 * Haftalık dakika ekseninde çakışan aktif tanımlar — ENGEL DEĞİL uyarı (ek mesai vardiyası
 * meşru olarak çakışır), ama tezgah anlık vardiyayı TEK pencereden okur. SAF.
 */
export function shiftOverlapWarnings(target: OverlapDef, others: OverlapDef[]): string[] {
  const WEEK = 7 * 1440;
  const spans = (d: OverlapDef): Array<[number, number]> => {
    const days = d.activeWeekdays.length ? d.activeWeekdays : [0, 1, 2, 3, 4, 5, 6];
    return days.flatMap((wd) => {
      const s = wd * 1440 + d.startMinute;
      const e = s + d.durationMinutes;
      return e <= WEEK ? [[s, e] as [number, number]] : [[s, WEEK], [0, e - WEEK]] as Array<[number, number]>;
    });
  };
  const mine = spans(target);
  return others
    .filter((o) => o.id !== target.id && spans(o).some(([a, b]) => mine.some(([c, d]) => a < d && c < b)))
    .map((o) => `"${target.code}" vardiyası "${o.code}" (${hhmm(o.startMinute)}–${hhmm(o.startMinute + o.durationMinutes)}) ile çakışıyor — tezgahın anlık vardiyası tek pencereden okunur.`);
}

async function assertNameFree(name: string, exceptId: string | null): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string; code: string; isActive: boolean }>>`
    SELECT id, code, "isActive" FROM shift_definitions WHERE "nameFold" = public.tr_fold(${name})`;
  const hit = rows.find((r) => r.id !== exceptId);
  if (!hit) return;
  throw AppError.conflict(
    hit.isActive
      ? `"${name}" adlı bir vardiya zaten var (${hit.code}).`
      : `"${name}" adlı vardiya ARŞİVDE (${hit.code}) — yeni tanım açmak yerine onu geri alın.`,
    { code: "SHIFT_NAME_TAKEN", existingId: hit.id, existingActive: hit.isActive },
  );
}

async function triggerCalendar(id: string): Promise<ShiftCalendarOutcome | null> {
  try {
    return await runShiftCalendarOnce({ onlyDefinitionIds: [id] });
  } catch (err) {
    uyari("shift-definition", `takvim tetiklemesi düştü (zamanlayıcı tamamlar): ${String(err)}`);
    return null;
  }
}

async function overlapWarnings(def: ShiftDefinitionDto): Promise<string[]> {
  if (!def.isActive) return [];
  const others = await prisma.shiftDefinition.findMany({
    where: { isActive: true, id: { not: def.id } },
    select: { id: true, code: true, startMinute: true, durationMinutes: true, activeWeekdays: true },
  });
  return shiftOverlapWarnings(def, others);
}

async function respond(def: ShiftDefinitionDto, message: string): Promise<ApiResponse<ShiftDefinitionWriteResult>> {
  const calendar = await triggerCalendar(def.id);
  const warnings = await overlapWarnings(def);
  if (calendar === null) warnings.push("Vardiya takvimi şimdi güncellenemedi; zamanlayıcı en geç 6 saat içinde tamamlar.");
  return { success: true, data: { definition: def, calendar }, message, ...(warnings.length ? { warnings } : {}) };
}

export async function listShiftDefinitions(opts: { includeInactive: boolean }): Promise<ApiResponse<ShiftDefinitionDto[]>> {
  const data = await prisma.shiftDefinition.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    select: SHIFT_DEFINITION_SELECT,
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { code: "asc" }],
  });
  return { success: true, data };
}

export async function createShiftDefinition(input: ShiftDefinitionCreateInput, userId?: string): Promise<ApiResponse<ShiftDefinitionWriteResult>> {
  const data = { ...input, activeWeekdays: normalizeWeekdays(input.activeWeekdays) };
  assertShiftWindow(data);
  if (await prisma.shiftDefinition.findUnique({ where: { code: data.code }, select: { id: true } })) {
    throw AppError.conflict(`"${data.code}" kodlu bir vardiya zaten var — kod raporların anahtarıdır, tekrar kullanılamaz.`, { code: "SHIFT_CODE_TAKEN" });
  }
  await assertNameFree(data.name, null);
  const created = await prisma.shiftDefinition.create({
    data: { ...data, createdById: userId ?? null, updatedById: userId ?? null },
    select: SHIFT_DEFINITION_SELECT,
  });
  await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: created.id, newData: created });
  return respond(created, "Vardiya tanımı oluşturuldu.");
}

async function diagnoseNotActive(id: string): Promise<never> {
  const row = await prisma.shiftDefinition.findUnique({ where: { id }, select: { isActive: true } });
  if (!row) throw AppError.notFound("Vardiya tanımı bulunamadı.");
  throw AppError.conflict("Arşivdeki vardiya tanımı düzenlenemez — önce geri alın.", { code: "SHIFT_DEFINITION_ARCHIVED" });
}

export async function updateShiftDefinition(id: string, patch: Partial<ShiftDefinitionFields>, userId?: string): Promise<ApiResponse<ShiftDefinitionWriteResult>> {
  const before = await prisma.shiftDefinition.findUnique({ where: { id }, select: SHIFT_DEFINITION_SELECT });
  if (!before) throw AppError.notFound("Vardiya tanımı bulunamadı.");
  const next = {
    ...patch,
    ...(patch.activeWeekdays ? { activeWeekdays: normalizeWeekdays(patch.activeWeekdays) } : {}),
  };
  assertShiftWindow({ ...before, ...next });
  if (next.name !== undefined) await assertNameFree(next.name, id);
  const r = await prisma.shiftDefinition.updateMany({ where: { id, isActive: true }, data: { ...next, updatedById: userId ?? null } });
  if (r.count === 0) await diagnoseNotActive(id);
  const after = await prisma.shiftDefinition.findUniqueOrThrow({ where: { id }, select: SHIFT_DEFINITION_SELECT });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: before, newData: after });
  return respond(after, "Vardiya tanımı güncellendi.");
}

/** Arşiv ↔ geri al — `isActive` durum geçişi, atomik claim; count 0 → taze okumayla tanı. */
export async function setShiftDefinitionActive(id: string, active: boolean, userId?: string): Promise<ApiResponse<ShiftDefinitionWriteResult>> {
  const r = await prisma.shiftDefinition.updateMany({ where: { id, isActive: !active }, data: { isActive: active, updatedById: userId ?? null } });
  if (r.count === 0) {
    const row = await prisma.shiftDefinition.findUnique({ where: { id }, select: { isActive: true } });
    if (!row) throw AppError.notFound("Vardiya tanımı bulunamadı.");
    throw AppError.conflict(active ? "Vardiya tanımı zaten etkin." : "Vardiya tanımı zaten arşivde.", { code: active ? "SHIFT_DEFINITION_ACTIVE" : "SHIFT_DEFINITION_ARCHIVED" });
  }
  const after = await prisma.shiftDefinition.findUniqueOrThrow({ where: { id }, select: SHIFT_DEFINITION_SELECT });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { isActive: !active }, newData: { isActive: active } });
  return respond(after, active ? "Vardiya tanımı geri alındı; takvim yeniden kuruldu." : "Vardiya tanımı arşivlendi; gelecek pencereleri iptal edildi.");
}

// ── Önizleme ──────────────────────────────────────────────────────────────────

export interface ShiftPreviewWindow { id: string | null; factoryDay: string; startsAt: string; endsAt: string; to?: { startsAt: string; endsAt: string } }
export interface ShiftDefinitionPreview {
  create: ShiftPreviewWindow[];
  rewrite: ShiftPreviewWindow[];
  retire: ShiftPreviewWindow[];
  /** Başlamış ya da karnesi mühürlü — tanım değişse de DEĞİŞMEYECEK pencereler. */
  kept: ShiftPreviewWindow[];
}

const win = (id: string | null, dayKey: Date, s: Date, e: Date): ShiftPreviewWindow => ({
  id, factoryDay: factoryYmd(new Date(dayKey.getTime() + 12 * 3600_000)), startsAt: factoryDateTimeTr(s), endsAt: factoryDateTimeTr(e),
});

/**
 * "Kaydedersem takvimde ne olur" — job'un planı, önerilen tanımla. `id` yoksa yeni tanım;
 * `active:false` arşivin, `active:true` geri almanın etkisini gösterir. Yazmaz.
 */
export async function previewShiftDefinition(
  id: string | null,
  proposed: Partial<ShiftDefinitionFields> & { active?: boolean },
): Promise<ApiResponse<ShiftDefinitionPreview>> {
  const now = new Date();
  const fromDayKey = planShiftCalendar([], [], now).fromDayKey;
  const { defs, existing } = id ? await loadShiftCalendarInputs([id], fromDayKey) : { defs: [], existing: [] };
  if (id && defs.length === 0) throw AppError.notFound("Vardiya tanımı bulunamadı.");
  const base: PlanDefinition = defs[0] ?? { id: "__yeni__", startMinute: 0, durationMinutes: 0, activeWeekdays: [], isActive: true };
  const def: PlanDefinition = {
    ...base,
    ...(proposed.startMinute !== undefined ? { startMinute: proposed.startMinute } : {}),
    ...(proposed.durationMinutes !== undefined ? { durationMinutes: proposed.durationMinutes } : {}),
    ...(proposed.activeWeekdays ? { activeWeekdays: normalizeWeekdays(proposed.activeWeekdays) } : {}),
    ...(proposed.active !== undefined ? { isActive: proposed.active } : {}),
  };
  assertShiftWindow({ ...def, plannedBreakMinutes: 0 });
  const out: ShiftDefinitionPreview = { create: [], rewrite: [], retire: [], kept: [] };
  for (const a of planShiftCalendar([def], existing, now).actions) {
    if (a.kind === "create") out.create.push(win(null, a.factoryDayKey, a.startsAt, a.endsAt));
    else {
      const w = a.window;
      const item = win(w.id, w.factoryDayKey, w.startsAt, w.endsAt);
      if (a.kind === "rewrite") out[a.revive && sameTimes(w, a.to) ? "create" : "rewrite"].push({ ...item, to: { startsAt: factoryDateTimeTr(a.to.startsAt), endsAt: factoryDateTimeTr(a.to.endsAt) } });
      else if (a.kind === "retire") out.retire.push(item);
      else out.kept.push(item);
    }
  }
  return { success: true, data: out };
}

const sameTimes = (w: { startsAt: Date; endsAt: Date }, t: { startsAt: Date; endsAt: Date }): boolean =>
  w.startsAt.getTime() === t.startsAt.getTime() && w.endsAt.getTime() === t.endsAt.getTime();
