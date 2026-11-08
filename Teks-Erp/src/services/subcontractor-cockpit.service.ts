// =============================================================================
// FASON KOKPİTİ (F10) — firmalar arası açık sevk + termin gecikmesi + fasonda kalan (top/iplik/levent)
// =============================================================================
// "Açık" TEK KAYNAKTAN: top kalemi `OPEN_OUTSTANDING` · haşıl leventi `OPEN_BEAM_DISPATCH` · dokuma fason belgesi
// işi açık olduğu sürece (`WEAVING_ORDER_OPEN_STATUSES`). Liste, cursor ve özet şeridi AYNI where'den; gecikme
// fabrika günüyle (`fason-expected-return.helper`). Metrikler sevk kümesi için toplu sorgularla (N+1 yok); özet
// kümesi `COCKPIT_SUMMARY_CEILING` ile sınırlı, aşılırsa `warnings` (sessiz kırpma yok). Salt okuma.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { decodeOffsetCursor, encodeOffsetCursor } from "../utils/cursor";
import { readFilterList } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";
import { OPEN_BEAM_DISPATCH, OPEN_BEAM_ITEM, OPEN_OUTSTANDING, outstandingItemOfOpenDispatch } from "./helpers/fason-open-dispatch.helper";
import { expectedReturnStateOf, expectedReturnStateWhere, overdueDaysOf } from "./helpers/fason-expected-return.helper";
import { WEAVING_ORDER_OPEN_STATUSES } from "./weaving-order.service";
import { yarnOutstandingKgByDispatch } from "./subcontractor-yarn.service";
import type { SubcontractorCockpitFirmSummary, SubcontractorCockpitResult, SubcontractorCockpitRow } from "./subcontractor/types";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = ["ALL", "OVERDUE", "DUE_SOON", "NO_DUE_DATE"] as const;
type CockpitState = (typeof STATES)[number];
export const COCKPIT_DEFAULT_LIMIT = 50;
export const COCKPIT_MAX_LIMIT = 200;
/** Özet şeridinin bellek tavanı — sorgudan ÖNCE; aşılırsa özet ilk N sevkten hesaplanır ve uyarı döner. */
export const COCKPIT_SUMMARY_CEILING = 2000;
const MAX_OFFSET = 10_000;

/** Kokpitin "açık sevk" tanımı — liste/özet/bekçi aynı nesneden. */
export const COCKPIT_OPEN_WHERE: Prisma.SubcontractorDispatchWhereInput = {
  OR: [
    OPEN_OUTSTANDING,
    OPEN_BEAM_DISPATCH,
    { cancelledAt: null, weavingOrder: { status: { in: [...WEAVING_ORDER_OPEN_STATUSES] } } },
  ],
};

export interface CockpitQueryInput {
  subcontractorId?: string | string[];
  categoryId?: string | string[];
  state?: string | string[];
  cursor?: string | string[];
  limit?: string | string[];
}
interface ParsedQuery {
  where: Prisma.SubcontractorDispatchWhereInput;
  offset: number;
  limit: number;
}

function invalid(message: string): AppError {
  return AppError.badRequest(message, { code: "COCKPIT_FILTER_INVALID" });
}

function readIds(raw: string | string[] | undefined, label: string): string[] {
  const list = readFilterList(raw);
  if (list.some((v) => !UUID_RE.test(v))) throw invalid(`${label} süzgeci geçersiz`);
  return list;
}

function readScalar(raw: string | string[] | undefined, label: string): string | undefined {
  if (Array.isArray(raw)) throw invalid(`${label} tek değer olmalı`);
  return raw === undefined || raw === "" ? undefined : raw;
}

function readState(raw: string | string[] | undefined): CockpitState {
  const v = readScalar(raw, "Durum") ?? "ALL";
  if (!(STATES as readonly string[]).includes(v)) throw invalid("Durum süzgeci geçersiz (ALL · OVERDUE · DUE_SOON · NO_DUE_DATE)");
  return v as CockpitState;
}

function readLimit(raw: string | string[] | undefined): number {
  const v = readScalar(raw, "Limit");
  if (v === undefined) return COCKPIT_DEFAULT_LIMIT;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > COCKPIT_MAX_LIMIT) throw invalid(`Limit 1..${COCKPIT_MAX_LIMIT} arası tam sayı olmalı`);
  return n;
}

function readOffset(raw: string | string[] | undefined): number {
  const v = readScalar(raw, "Cursor");
  if (v === undefined) return 0;
  const off = decodeOffsetCursor(v); // biz 0 cursor'ı hiç basmayız → 0 = çözülemedi
  if (off <= 0 || off > MAX_OFFSET) throw invalid("Cursor geçersiz");
  return off;
}

/** Süreç türü: adımın `requiredCategory`'si, yoksa istasyonun varsayılanı (satırdaki `category` ile aynı öncelik). */
function categoryWhere(ids: string[]): Prisma.SubcontractorDispatchWhereInput {
  const inIds = { in: ids };
  return {
    OR: [
      { step: { requiredCategoryId: inIds } },
      { step: { requiredCategoryId: null, station: { defaultCategoryId: inIds } } },
    ],
  };
}

export function parseCockpitQuery(q: CockpitQueryInput, now: Date = new Date()): ParsedQuery {
  const subIds = readIds(q.subcontractorId, "Fason firma");
  const catIds = readIds(q.categoryId, "Süreç türü");
  const state = readState(q.state);
  const and: Prisma.SubcontractorDispatchWhereInput[] = [COCKPIT_OPEN_WHERE];
  if (subIds.length > 0) and.push({ subcontractorId: { in: subIds } });
  if (catIds.length > 0) and.push(categoryWhere(catIds));
  if (state !== "ALL") and.push(expectedReturnStateWhere(state, now));
  return { where: { AND: and }, offset: readOffset(q.cursor), limit: readLimit(q.limit) };
}

interface DispatchMetrics {
  outstandingQty: Prisma.Decimal;
  outstandingRollCount: number;
  yarnOutstandingKg: Prisma.Decimal;
  beamOutstandingCount: number;
}

/** Sevk kümesi için fasonda kalan — üç toplu sorgu; satır ve özet AYNI fonksiyondan. */
async function metricsOf(dispatchIds: string[]): Promise<Map<string, DispatchMetrics>> {
  const map = new Map<string, DispatchMetrics>();
  if (dispatchIds.length === 0) return map;
  const get = (id: string): DispatchMetrics => {
    const m = map.get(id) ?? { outstandingQty: D(0), outstandingRollCount: 0, yarnOutstandingKg: D(0), beamOutstandingCount: 0 };
    map.set(id, m);
    return m;
  };
  const rollItems = await prisma.subcontractorDispatchItem.findMany({
    where: outstandingItemOfOpenDispatch({ id: { in: dispatchIds } }),
    select: { dispatchId: true, roll: { select: { currentQty: true } } },
  });
  for (const it of rollItems) {
    const m = get(it.dispatchId);
    m.outstandingQty = m.outstandingQty.plus(it.roll?.currentQty ?? 0);
    m.outstandingRollCount += 1;
  }
  const beams = await prisma.subcontractorDispatchItem.groupBy({
    by: ["dispatchId"],
    where: { ...OPEN_BEAM_ITEM, dispatchId: { in: dispatchIds } },
    _count: { _all: true },
  });
  for (const b of beams) get(b.dispatchId).beamOutstandingCount = b._count._all;
  for (const [id, kg] of await yarnOutstandingKgByDispatch(dispatchIds)) get(id).yarnOutstandingKg = kg;
  return map;
}

const ROW_SELECT = {
  id: true, dispatchNo: true, dispatchedAt: true, expectedReturnAt: true, totalQty: true,
  subcontractor: { select: { id: true, name: true } },
  workOrder: { select: { id: true, workOrderNumber: true } },
  weavingOrder: { select: { id: true, weavingOrderNumber: true } },
  step: { select: { requiredCategory: { select: { id: true, name: true } }, station: { select: { defaultCategory: { select: { id: true, name: true } } } } } },
} satisfies Prisma.SubcontractorDispatchSelect;
type RowSource = Prisma.SubcontractorDispatchGetPayload<{ select: typeof ROW_SELECT }>;

const ORDER_BY: Prisma.SubcontractorDispatchOrderByWithRelationInput[] = [
  { expectedReturnAt: { sort: "asc", nulls: "last" } },
  { dispatchedAt: "asc" },
  { id: "asc" },
];

const EMPTY: DispatchMetrics = { outstandingQty: D(0), outstandingRollCount: 0, yarnOutstandingKg: D(0), beamOutstandingCount: 0 };

function toRow(r: RowSource, m: DispatchMetrics, now: Date): SubcontractorCockpitRow {
  return {
    dispatchId: r.id,
    dispatchNo: r.dispatchNo,
    subcontractor: r.subcontractor,
    category: r.step?.requiredCategory ?? r.step?.station.defaultCategory ?? null,
    workOrder: r.workOrder ? { id: r.workOrder.id, orderNo: r.workOrder.workOrderNumber } : null,
    weavingOrder: r.weavingOrder ? { id: r.weavingOrder.id, orderNo: r.weavingOrder.weavingOrderNumber } : null,
    dispatchedAt: r.dispatchedAt.toISOString(),
    expectedReturnAt: r.expectedReturnAt?.toISOString() ?? null,
    overdueDays: overdueDaysOf(r.expectedReturnAt, now),
    dispatchedQty: D(r.totalQty).toFixed(3),
    outstandingQty: m.outstandingQty.toFixed(3),
    outstandingRollCount: m.outstandingRollCount,
    yarnOutstandingKg: m.yarnOutstandingKg.toFixed(3),
    beamOutstandingCount: m.beamOutstandingCount,
  };
}

interface FirmAcc { firm: SubcontractorCockpitFirmSummary; qty: Prisma.Decimal; yarn: Prisma.Decimal }

function buildSummary(rows: Array<SubcontractorCockpitRow & { state: ReturnType<typeof expectedReturnStateOf> }>, openDispatchCount: number): SubcontractorCockpitResult["summary"] {
  const firms = new Map<string, FirmAcc>();
  let qty = D(0);
  let overdueCount = 0;
  let dueSoonCount = 0;
  for (const r of rows) {
    const overdue = r.state === "OVERDUE";
    if (overdue) overdueCount += 1;
    if (r.state === "DUE_SOON") dueSoonCount += 1;
    qty = qty.plus(r.outstandingQty);
    const acc = firms.get(r.subcontractor.id) ?? {
      firm: { subcontractor: r.subcontractor, openDispatchCount: 0, overdueCount: 0, outstandingQty: "0.000", yarnOutstandingKg: "0.000", beamOutstandingCount: 0 },
      qty: D(0), yarn: D(0),
    };
    acc.firm.openDispatchCount += 1;
    if (overdue) acc.firm.overdueCount += 1;
    acc.firm.beamOutstandingCount += r.beamOutstandingCount;
    acc.qty = acc.qty.plus(r.outstandingQty);
    acc.yarn = acc.yarn.plus(r.yarnOutstandingKg);
    firms.set(r.subcontractor.id, acc);
  }
  const firmList = [...firms.values()]
    .map((a) => ({ ...a.firm, outstandingQty: a.qty.toFixed(3), yarnOutstandingKg: a.yarn.toFixed(3) }))
    .sort((a, b) => b.overdueCount - a.overdueCount || b.openDispatchCount - a.openDispatchCount || a.subcontractor.name.localeCompare(b.subcontractor.name, "tr"));
  return { openDispatchCount, overdueCount, dueSoonCount, outstandingQty: qty.toFixed(3), firms: firmList };
}

/** `GET /api/subcontractor/cockpit` gövdesi. */
export async function getSubcontractorCockpit(q: CockpitQueryInput, now: Date = new Date()): Promise<ApiResponse<SubcontractorCockpitResult>> {
  const { where, offset, limit } = parseCockpitQuery(q, now);
  const openDispatchCount = await prisma.subcontractorDispatch.count({ where });
  const all = await prisma.subcontractorDispatch.findMany({ where, select: ROW_SELECT, orderBy: ORDER_BY, take: COCKPIT_SUMMARY_CEILING });
  const pageSrc = offset + limit < all.length || openDispatchCount <= COCKPIT_SUMMARY_CEILING
    ? all.slice(offset, offset + limit + 1)
    : await prisma.subcontractorDispatch.findMany({ where, select: ROW_SELECT, orderBy: ORDER_BY, skip: offset, take: limit + 1 });
  const hasMore = pageSrc.length > limit;
  const page = pageSrc.slice(0, limit);
  const metrics = await metricsOf([...new Set([...all, ...page].map((r) => r.id))]);
  const rowOf = (r: RowSource) => toRow(r, metrics.get(r.id) ?? EMPTY, now);
  const warnings = openDispatchCount > COCKPIT_SUMMARY_CEILING
    ? [`Açık sevk sayısı ${openDispatchCount}; özet şeridi ilk ${COCKPIT_SUMMARY_CEILING} sevkten hesaplandı — firma ya da süreç türü süzgeci kullanın.`]
    : undefined;
  return {
    success: true,
    data: {
      data: page.map(rowOf),
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
      summary: buildSummary(all.map((r) => ({ ...rowOf(r), state: expectedReturnStateOf(r.expectedReturnAt, now) })), openDispatchCount),
    },
    ...(warnings ? { warnings } : {}),
  };
}
