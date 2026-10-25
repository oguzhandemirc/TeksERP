// =============================================================================
// Muayene okuma yüzeyi — liste + cursor + özet şeridi TEK where'den (filtre-liste.md)
// =============================================================================
import { Prisma, type InspectionPhase } from "@prisma/client";
import prisma from "../lib/prisma";
import { resolveRangeEnd, resolveRangeStart } from "../constants/time";
import { AppError } from "../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import { readFilterList, readIdCondition } from "../utils/query-parser";
import { ACTIVE_INSPECTION_WHERE } from "./helpers/inspection-active.helper";

export interface InspectionListQuery {
  from?: string;
  to?: string;
  itemId?: string | string[];
  rollId?: string | string[];
  gradeId?: string | string[];
  phase?: string | string[];
  stationId?: string | string[];
  inspectedById?: string | string[];
  minScore?: string;
  maxScore?: string;
  widthUnknown?: string;
  mismatch?: string;
  /** "1" = revize/iptal edilmiş tarihçe dahil; varsayılan yalnız aktif. */
  includeHistory?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

const PHASES: readonly InspectionPhase[] = ["RAW", "FINAL"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message: string): AppError {
  return AppError.badRequest(message, { code: "INSPECTION_FILTER_INVALID" });
}
/** Kimlik süzgeci fail-closed: biçimsiz kimlik 500 değil 400. */
function idCondition(raw: string | string[] | undefined): ReturnType<typeof readIdCondition> {
  if (readFilterList(raw).some((v) => !UUID.test(v))) throw invalid("Geçersiz kimlik süzgeci.");
  return readIdCondition(raw);
}
function decimalOf(raw: string | undefined, label: string): Prisma.Decimal | null {
  if (raw == null || raw === "") return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw invalid(`${label} geçersiz.`);
  return new Prisma.Decimal(raw);
}
const flag = (v: string | undefined) => v === "1" || v === "true";

export function buildInspectionWhere(q: InspectionListQuery): Prisma.RollInspectionWhereInput {
  const and: Prisma.RollInspectionWhereInput[] = [];
  if (!flag(q.includeHistory)) and.push(ACTIVE_INSPECTION_WHERE);
  // Tarih fabrika günüdür: gün-yalnız değer fabrika diliminde günün başına/sonuna çözülür.
  for (const [raw, label] of [[q.from, "Başlangıç"], [q.to, "Bitiş"]] as const) {
    if (raw && !DAY.test(raw)) throw invalid(`${label} tarihi geçersiz (YYYY-AA-GG).`);
  }
  if (q.from || q.to) and.push({ inspectedAt: { ...(q.from ? { gte: resolveRangeStart(q.from) } : {}), ...(q.to ? { lte: resolveRangeEnd(q.to) } : {}) } });
  const itemId = idCondition(q.itemId);
  if (itemId) and.push({ roll: { itemId } });
  const rollId = idCondition(q.rollId);
  if (rollId) and.push({ rollId });
  const gradeId = idCondition(q.gradeId);
  if (gradeId) and.push({ suggestedQualityGradeId: gradeId });
  const stationId = idCondition(q.stationId);
  if (stationId) and.push({ stationId });
  const inspectedById = idCondition(q.inspectedById);
  if (inspectedById) and.push({ inspectedById });
  const phases = readFilterList(q.phase);
  if (phases.some((p) => !PHASES.includes(p as InspectionPhase))) throw invalid("Tanınmayan aşama süzgeci.");
  if (phases.length > 0) and.push({ phase: { in: phases as InspectionPhase[] } });
  const min = decimalOf(q.minScore, "En düşük puan");
  const max = decimalOf(q.maxScore, "En yüksek puan");
  if (min || max) and.push({ pointsPer100M2: { ...(min ? { gte: min } : {}), ...(max ? { lte: max } : {}) } });
  if (flag(q.widthUnknown)) and.push({ widthSource: "UNKNOWN" });
  if (flag(q.mismatch)) and.push({ gradeMismatch: true });
  const term = q.q?.trim();
  if (term) and.push({ roll: { barcode: { contains: term, mode: "insensitive" } } });
  return and.length > 0 ? { AND: and } : {};
}

const USER = { select: { id: true, fullName: true } } as const;
const LIST_SELECT = {
  id: true, phase: true, revision: true, totalPoints: true, defectCount: true, unplacedDefectCount: true, pointsPer100M2: true,
  gradeScore: true, suggestedGradeCode: true, gradeMismatch: true, widthCm: true, widthSource: true, inspectedLengthM: true,
  inspectedAt: true, supersededAt: true, voidedAt: true, createdAt: true,
  roll: { select: { id: true, barcode: true, qualityGrade: true, item: { select: { id: true, code: true, name: true } } } },
  station: { select: { id: true, name: true } },
  inspectedBy: USER,
} satisfies Prisma.RollInspectionSelect;

export async function listInspections(q: InspectionListQuery) {
  const where = buildInspectionWhere(q);
  const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
  const cursor = decodeCursor(q.cursor);
  if (q.cursor && !cursor) throw invalid("Geçersiz sayfa imleci.");
  const rows = await prisma.rollInspection.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: LIST_SELECT,
  });
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? buildNextCursor(items[items.length - 1]) : null;
  // Özet şeridi listenin AYNI where'inden (cursor'suz) — şerit ile liste ayrışmaz.
  const agg = await prisma.rollInspection.aggregate({ where, _count: { _all: true }, _avg: { pointsPer100M2: true } });
  const mismatch = await prisma.rollInspection.count({ where: { AND: [where, { gradeMismatch: true }] } });
  const grades = await prisma.rollInspection.groupBy({ by: ["suggestedGradeCode"], where, _count: { _all: true }, orderBy: { suggestedGradeCode: "asc" } });
  return {
    items,
    nextCursor,
    summary: {
      total: agg._count._all,
      avgPointsPer100M2: agg._avg.pointsPer100M2 ? agg._avg.pointsPer100M2.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null,
      mismatch,
      grades: grades.map((g) => ({ code: g.suggestedGradeCode, count: g._count._all })),
    },
  };
}

export async function getInspection(id: string) {
  const row = await prisma.rollInspection.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT, rollId: true, stationId: true, deviceId: true, ruleSetId: true, ruleSnapshot: true, note: true, reviseReason: true,
      supersedesId: true, voidReason: true, suggestedQualityGradeId: true, supersededBy: { select: { id: true } },
      supersededByUser: USER, voidedBy: USER,
      ruleSet: { select: { id: true, name: true, unit: true } },
      rollErrors: {
        orderBy: [{ startMeter: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        select: { id: true, startMeter: true, sizeClass: true, points: true, errorType: true, defectTypeId: true, detectedAt: true, detectedBy: USER },
      },
    },
  });
  if (!row) throw AppError.notFound("Muayene bulunamadı.", { code: "INSPECTION_NOT_FOUND" });
  const history = await prisma.rollInspection.findMany({
    where: { rollId: row.rollId, phase: row.phase },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, revision: true, supersedesId: true, supersededAt: true, voidedAt: true, reviseReason: true, voidReason: true, totalPoints: true, pointsPer100M2: true, createdAt: true },
  });
  const rawPoints = row.rollErrors.reduce((s, e) => s + (e.points ?? 0), 0);
  const areaM2 = row.widthCm ? row.widthCm.div(100).mul(row.inspectedLengthM).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
  return {
    ...row,
    breakdown: { rawPoints, cappedPoints: row.totalPoints, areaM2, formula: "puan × 10 000 / (en_cm × boy_m)" },
    history,
  };
}
