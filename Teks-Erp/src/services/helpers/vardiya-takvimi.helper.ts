// =============================================================================
// VARDİYA TAKVİMİ — bir anın hangi vardiyaya ve hangi fabrika gününe düştüğü (SQL)
// =============================================================================
// Raporlarda "genel vardiya" boyutunun TEK kaynağı (plan §3.1; kural `raporlar.md`). Kişi
// ataması gerekmez: `ShiftDefinition` pencereleri (başlangıç dakikası · süre · haftagünleri)
// fabrika YEREL saatine eşlenir. Dokuma bayrağından BAĞIMSIZ; dokuma açıkken takvim işinin
// ürettiği `ShiftInstance` pencereleriyle boğaz-ikizdir (bekçi `test_vardiya_takvimi`).
// Gece yarısını aşan vardiya BAŞLADIĞI (önceki) fabrika gününe yazılır — `factoryDayKey` emsali.
// Bilinen sınır: tanım değişirse geçmiş BUGÜNKÜ tanımla yorumlanır (`SHIFT_CALENDAR_LIMIT_NOTE`).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryLocalTimestampSql } from "../../constants/time";

const DAY_MINUTES = 1440;

export interface ShiftRule {
  code: string;
  name: string;
  startMinute: number;
  durationMinutes: number;
  /** 0=Pazar..6=Cumartesi; BOŞ = her gün (`ShiftDefinition.activeWeekdays` sözleşmesi). */
  activeWeekdays: readonly number[];
}

export const SHIFT_CALENDAR_LIMIT_NOTE =
  "Vardiya kırılımı bugünkü vardiya tanımlarıyla yapılır; vardiya saatleri geçmişte değiştiyse eski günler de yeni saatlere göre bölünür.";

/** Etkin vardiya tanımları, sıra düzeninde (çakışan pencerede ilk tanım kazanır). */
export async function loadShiftRules(): Promise<ShiftRule[]> {
  const rows = await prisma.shiftDefinition.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { code: true, name: true, startMinute: true, durationMinutes: true, activeWeekdays: true },
  });
  return rows;
}

function weekdayCond(dowSql: Prisma.Sql, weekdays: readonly number[]): Prisma.Sql {
  if (weekdays.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`${dowSql} IN (${Prisma.join(weekdays.map((d) => Prisma.sql`${d}::int`))})`;
}

interface ShiftBranch { cond: Prisma.Sql; sameDay: boolean; rule: ShiftRule }

function branches(columnExpr: string, rules: readonly ShiftRule[]): ShiftBranch[] {
  const local = factoryLocalTimestampSql(columnExpr);
  const minute = Prisma.sql`(EXTRACT(HOUR FROM ${local})::int * 60 + EXTRACT(MINUTE FROM ${local})::int)`;
  const dow = Prisma.sql`EXTRACT(DOW FROM ${local})::int`;
  const prevDow = Prisma.sql`((EXTRACT(DOW FROM ${local})::int + 6) % 7)`;
  const out: ShiftBranch[] = [];
  for (const r of rules) {
    const end = r.startMinute + Math.min(r.durationMinutes, DAY_MINUTES);
    out.push({
      cond: Prisma.sql`(${minute} >= ${r.startMinute}::int AND ${minute} < ${Math.min(end, DAY_MINUTES)}::int AND ${weekdayCond(dow, r.activeWeekdays)})`,
      sameDay: true,
      rule: r,
    });
    // Gece yarısını aşan kuyruk: ertesi günün başındaki dakikalar ÖNCEKİ günün vardiyasıdır.
    if (end > DAY_MINUTES) {
      out.push({
        cond: Prisma.sql`(${minute} < ${end - DAY_MINUTES}::int AND ${weekdayCond(prevDow, r.activeWeekdays)})`,
        sameDay: false,
        rule: r,
      });
    }
  }
  return out;
}

/** Anın vardiya KODU (`ShiftDefinition.code`); hiçbir pencereye düşmüyorsa NULL. */
export function shiftOfSql(columnExpr: string, rules: readonly ShiftRule[]): Prisma.Sql {
  const bs = branches(columnExpr, rules);
  if (bs.length === 0) return Prisma.sql`NULL::text`;
  return Prisma.sql`(CASE ${Prisma.join(bs.map((b) => Prisma.sql`WHEN ${b.cond} THEN ${b.rule.code}::text`), " ")} ELSE NULL END)`;
}

/** Anın ait olduğu vardiyanın FABRİKA GÜNÜ (`date`); gece kuyruğu önceki güne yazılır. */
export function shiftDaySql(columnExpr: string, rules: readonly ShiftRule[]): Prisma.Sql {
  const bs = branches(columnExpr, rules);
  if (bs.length === 0) return Prisma.sql`NULL::date`;
  const day = Prisma.sql`(${factoryLocalTimestampSql(columnExpr)})::date`;
  return Prisma.sql`(CASE ${Prisma.join(
    bs.map((b) => (b.sameDay ? Prisma.sql`WHEN ${b.cond} THEN ${day}` : Prisma.sql`WHEN ${b.cond} THEN (${day} - 1)`)),
    " ",
  )} ELSE NULL END)`;
}
