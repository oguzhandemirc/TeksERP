// =============================================================================
// SEVKE HAZIR İŞLER — liste + birim topları (D4-J1; DALGA4 §11.5/§11.8, ister 2.4 / 2.10)
// =============================================================================
// Salt okuma. Hazırlık `ship-readiness.helper`dan (tek yüklem); burada yalnız BİRİM ÜYELİĞİ (hangi top
// hangi birimde) ve listeleme var. Ayrı dosya: `shipping.service` tavanın çok üstünde (roll-owner emsali).
//   Birimler: workOrder (batch.workOrderId) · deliveryNote (satır rollId'leri + WITH RECURSIVE aşağı soy) ·
//   customerBatch (ownerCustomerId, trim(customerBatchNo) — ERP Batch DEĞİL) · customer (Roll.ownerCustomerId).
// Liste + cursor + özet şeridi aynı süzülmüş diziden (tek where: `matchesFilter`).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { decodeDynamicCursor, encodeDynamicCursor } from "../utils/cursor";
import { readFilterList } from "../utils/query-parser";
import {
  SHIP_READY_STATES,
  classifyShipReadiness,
  effectiveShipReadyPolicy,
  readinessClassSql,
  type ReadinessClass,
  type ShipReadyPolicy,
  type ShipReadyState,
} from "./helpers/ship-readiness.helper";
import type { ShipReadyRule } from "./system-setting.service";

export type ReadyWorkUnit = "workOrder" | "deliveryNote" | "customerBatch" | "customer";
export const READY_WORK_UNITS: readonly ReadyWorkUnit[] = ["workOrder", "deliveryNote", "customerBatch", "customer"];
/** Gelen belge modülünün verisine dayanan birimler — modül kapalıyken 403 MODULE_DISABLED. */
export const INCOMING_DOC_UNITS: readonly ReadyWorkUnit[] = ["deliveryNote", "customerBatch"];

/** `roll-delivery-note-line.helper` yukarı çözücüsüyle aynı tavan (döngüsel veri sonsuz yürümesin). */
const MAX_DESCENT_DEPTH = 32;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ReadyWorkRow {
  unit: ReadyWorkUnit;
  id: string;
  label: string;
  /** Birincil müşteri (İE'de ilk sipariş müşterisi ya da top sahibi). */
  customerId: string | null;
  customerName: string | null;
  state: ShipReadyState;
  appliedRule: ShipReadyRule;
  readyCount: number;
  readyMeters: number;
  inProcessCount: number;
  inProcessMeters: number;
  shippedMeters: number;
  scrapMeters: number;
  targetMeters: number | null;
}

export interface ReadyWorkSummary {
  units: number;
  ready: number;
  partial: number;
  none: number;
  readyMeters: number;
  inProcessMeters: number;
  shippedMeters: number;
}

export interface ReadyWorkList {
  items: ReadyWorkRow[];
  nextCursor: string | null;
  summary: ReadyWorkSummary;
  policy: ShipReadyPolicy;
}

export interface ReadyWorkQuery {
  groupBy?: unknown;
  state?: unknown;
  customerId?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

/** Tanınmayan birim FAIL-CLOSED 400 (varsayılana sapma yok). */
export function parseReadyWorkUnit(raw: unknown): ReadyWorkUnit {
  if (typeof raw !== "string" || !READY_WORK_UNITS.includes(raw as ReadyWorkUnit)) {
    throw AppError.badRequest(`Gruplama yalnız ${READY_WORK_UNITS.join(", ")} olabilir`, { code: "READY_WORKS_BAD_GROUP" });
  }
  return raw as ReadyWorkUnit;
}

export function readQueryList(raw: unknown): string[] {
  if (typeof raw === "string" || Array.isArray(raw)) return readFilterList(raw as string | string[]);
  return [];
}

export function parseLimit(raw: unknown, def: number, max: number): number {
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw AppError.badRequest("limit pozitif tam sayı olmalı");
  return Math.min(n, max);
}

// ---------------------------------------------------------------------------
// BİRİM ÜYELİĞİ — (unit_id, roll_id) çiftleri; tek SQL parçası, liste ve top ucu aynısını kullanır.
// ---------------------------------------------------------------------------
function noteKeySql(): Prisma.Sql {
  return Prisma.sql`(n."ownerCustomerId"::text || ':' || btrim(n."customerBatchNo"))`;
}

export function membershipSql(unit: ReadyWorkUnit, onlyId?: string): Prisma.Sql {
  switch (unit) {
    case "workOrder":
      return Prisma.sql`
        SELECT b."workOrderId"::text AS unit_id, r.id AS roll_id
        FROM rolls r JOIN batches b ON b.id = r."batchId"
        ${onlyId ? Prisma.sql`WHERE b."workOrderId" = ${onlyId}::uuid` : Prisma.empty}`;
    case "customer":
      return Prisma.sql`
        SELECT r."ownerCustomerId"::text AS unit_id, r.id AS roll_id
        FROM rolls r
        WHERE r."ownerCustomerId" IS NOT NULL
        ${onlyId ? Prisma.sql`AND r."ownerCustomerId" = ${onlyId}::uuid` : Prisma.empty}`;
    case "deliveryNote":
    case "customerBatch": {
      const key = unit === "deliveryNote" ? Prisma.sql`n.id::text` : noteKeySql();
      const unitFilter = unit === "customerBatch"
        ? Prisma.sql`AND n."ownerCustomerId" IS NOT NULL AND btrim(COALESCE(n."customerBatchNo", '')) <> ''`
        : Prisma.empty;
      const idFilter = onlyId ? Prisma.sql`AND ${key} = ${onlyId}` : Prisma.empty;
      // Kök: belgenin onayla doğan topları; aşağı soy `parentRollId` (tambur bölmesi) üzerinden, derinlik tavanlı.
      return Prisma.sql`
        SELECT DISTINCT t.unit_id, t.roll_id FROM (
          WITH RECURSIVE tree(unit_id, roll_id, depth) AS (
            SELECT ${key} AS unit_id, l."rollId" AS roll_id, 0
            FROM customer_delivery_note_lines l
            JOIN customer_delivery_notes n ON n.id = l."noteId"
            WHERE l."rollId" IS NOT NULL AND n.status::text <> 'CANCELLED' ${unitFilter} ${idFilter}
            UNION ALL
            SELECT t.unit_id, c.id, t.depth + 1
            FROM tree t JOIN rolls c ON c."parentRollId" = t.roll_id
            WHERE t.depth < ${MAX_DESCENT_DEPTH}
          )
          SELECT unit_id, roll_id FROM tree
        ) t`;
    }
  }
}

interface AggRow {
  unit_id: string;
  ready_count: bigint;
  ready_m: Prisma.Decimal | null;
  in_process_count: bigint;
  in_process_m: Prisma.Decimal | null;
  shipped_m: Prisma.Decimal | null;
  scrap_m: Prisma.Decimal | null;
}

async function aggregateUnits(unit: ReadyWorkUnit): Promise<AggRow[]> {
  return prisma.$queryRaw<AggRow[]>(Prisma.sql`
    WITH members AS (${membershipSql(unit)}),
    classed AS (
      SELECT m.unit_id, r."currentQty" AS qty, ${readinessClassSql("r")} AS cls
      FROM members m JOIN rolls r ON r.id = m.roll_id
    )
    SELECT unit_id,
      COUNT(*) FILTER (WHERE cls = 'READY')            AS ready_count,
      SUM(qty) FILTER (WHERE cls = 'READY')            AS ready_m,
      COUNT(*) FILTER (WHERE cls = 'IN_PROCESS')       AS in_process_count,
      SUM(qty) FILTER (WHERE cls = 'IN_PROCESS')       AS in_process_m,
      SUM(qty) FILTER (WHERE cls = 'GONE')             AS shipped_m,
      SUM(qty) FILTER (WHERE cls = 'SCRAP')            AS scrap_m
    FROM classed
    WHERE cls IS NOT NULL
    GROUP BY unit_id
    HAVING COUNT(*) FILTER (WHERE cls IN ('READY', 'IN_PROCESS')) > 0`);
}

interface UnitMeta {
  label: string;
  target: Prisma.Decimal | null;
  /** Süzgecin baktığı müşteriler (İE: sipariş müşterileri ∪ top sahipleri). İlki birincil. */
  customers: Array<{ id: string; name: string }>;
}

async function loadUnitMeta(unit: ReadyWorkUnit, ids: string[]): Promise<Map<string, UnitMeta>> {
  const out = new Map<string, UnitMeta>();
  if (ids.length === 0) return out;
  if (unit === "workOrder") {
    const wos = await prisma.workOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        workOrderNumber: true,
        targetQuantity: true,
        orderLinks: {
          where: { unlinkedAt: null },
          orderBy: { createdAt: "asc" },
          select: { orderLine: { select: { order: { select: { customer: { select: { id: true, name: true } } } } } } },
        },
      },
    });
    const owners = await prisma.$queryRaw<Array<{ unit_id: string; id: string; name: string }>>(Prisma.sql`
      SELECT DISTINCT b."workOrderId"::text AS unit_id, c.id::text AS id, c.name
      FROM rolls r JOIN batches b ON b.id = r."batchId" JOIN customers c ON c.id = r."ownerCustomerId"
      WHERE b."workOrderId" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))})`);
    for (const w of wos) {
      const customers: Array<{ id: string; name: string }> = [];
      const push = (c: { id: string; name: string } | null | undefined): void => {
        if (c && !customers.some((x) => x.id === c.id)) customers.push({ id: c.id, name: c.name });
      };
      for (const l of w.orderLinks) push(l.orderLine?.order?.customer);
      for (const o of owners) if (o.unit_id === w.id) push(o);
      out.set(w.id, { label: w.workOrderNumber, target: w.targetQuantity, customers });
    }
    return out;
  }
  if (unit === "customer") {
    const cs = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    for (const c of cs) out.set(c.id, { label: c.name, target: null, customers: [{ id: c.id, name: c.name }] });
    return out;
  }
  // Belge birimleri: hedef = onayla top doğuran satırların Σ metresi (gelmeyen/atlanan satır beklenemez).
  const key = unit === "deliveryNote" ? Prisma.sql`n.id::text` : noteKeySql();
  const rows = await prisma.$queryRaw<
    Array<{ unit_id: string; label: string; owner_id: string | null; owner_name: string | null; target: Prisma.Decimal | null }>
  >(Prisma.sql`
    SELECT ${key} AS unit_id,
      ${unit === "deliveryNote" ? Prisma.sql`MIN(n."noteNo")` : Prisma.sql`MIN(btrim(n."customerBatchNo"))`} AS label,
      MIN(n."ownerCustomerId"::text) AS owner_id,
      MIN(c.name) AS owner_name,
      SUM(l.meters) FILTER (WHERE l."rollId" IS NOT NULL) AS target
    FROM customer_delivery_notes n
    JOIN customer_delivery_note_lines l ON l."noteId" = n.id
    LEFT JOIN customers c ON c.id = n."ownerCustomerId"
    WHERE n.status::text <> 'CANCELLED' AND ${key} IN (${Prisma.join(ids)})
    GROUP BY 1`);
  for (const r of rows) {
    out.set(r.unit_id, {
      label: r.label,
      target: r.target,
      customers: r.owner_id ? [{ id: r.owner_id, name: r.owner_name ?? "" }] : [],
    });
  }
  return out;
}

const STATE_RANK: Record<ShipReadyState, number> = { READY: 0, PARTIAL: 1, NONE: 2 };
const dec = (v: Prisma.Decimal | null): Prisma.Decimal => v ?? new Prisma.Decimal(0);
const num = (v: Prisma.Decimal): number => Number(v.toFixed(3));

type SortKey = [number, string, string];
const sortKeyOf = (r: ReadyWorkRow): SortKey => [STATE_RANK[r.state], r.label, r.id];
function compareKeys(a: SortKey, b: SortKey): number {
  return a[0] - b[0] || a[1].localeCompare(b[1], "tr") || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

/** Bütün birimleri hazırlığıyla üretir (süzgeçsiz) — liste ve bekçi aynı kaynağı okur. */
export async function computeReadyWorks(unit: ReadyWorkUnit, policy: ShipReadyPolicy): Promise<Array<ReadyWorkRow & { customerIds: string[] }>> {
  const agg = await aggregateUnits(unit);
  const meta = await loadUnitMeta(unit, agg.map((a) => a.unit_id));
  const rows: Array<ReadyWorkRow & { customerIds: string[] }> = [];
  for (const a of agg) {
    const m = meta.get(a.unit_id);
    const totals = {
      readyCount: Number(a.ready_count),
      readyMeters: dec(a.ready_m),
      inProcessCount: Number(a.in_process_count),
      inProcessMeters: dec(a.in_process_m),
      shippedMeters: dec(a.shipped_m),
      scrapMeters: dec(a.scrap_m),
      targetMeters: m?.target ?? null,
    };
    const verdict = classifyShipReadiness(totals, policy);
    if (!verdict.visible) continue;
    rows.push({
      unit,
      id: a.unit_id,
      label: m?.label ?? a.unit_id,
      customerId: m?.customers[0]?.id ?? null,
      customerName: m?.customers[0]?.name ?? null,
      customerIds: (m?.customers ?? []).map((c) => c.id),
      state: verdict.state,
      appliedRule: verdict.appliedRule,
      readyCount: totals.readyCount,
      readyMeters: num(totals.readyMeters),
      inProcessCount: totals.inProcessCount,
      inProcessMeters: num(totals.inProcessMeters),
      shippedMeters: num(totals.shippedMeters),
      scrapMeters: num(totals.scrapMeters),
      targetMeters: totals.targetMeters === null ? null : num(totals.targetMeters),
    });
  }
  return rows;
}

export async function listReadyWorks(q: ReadyWorkQuery): Promise<{ success: true; data: ReadyWorkList }> {
  const unit = parseReadyWorkUnit(q.groupBy);
  const states = readQueryList(q.state);
  const badState = states.find((s) => !SHIP_READY_STATES.includes(s as ShipReadyState));
  if (badState) throw AppError.badRequest(`Durum yalnız ${SHIP_READY_STATES.join(", ")} olabilir`, { code: "READY_WORKS_BAD_STATE" });
  const customerIds = readQueryList(q.customerId);
  if (customerIds.some((c) => !UUID_RE.test(c))) throw AppError.badRequest("Müşteri kimliği geçersiz");
  const limit = parseLimit(q.limit, DEFAULT_LIMIT, MAX_LIMIT);
  let after: SortKey | null = null;
  if (typeof q.cursor === "string" && q.cursor) {
    const c = decodeDynamicCursor(q.cursor);
    const parsed = c?.v ? (JSON.parse(c.v) as unknown) : null;
    if (!c || !Array.isArray(parsed) || typeof parsed[0] !== "number" || typeof parsed[1] !== "string") {
      throw AppError.badRequest("Geçersiz sayfa imleci");
    }
    after = [parsed[0], parsed[1], c.id];
  }

  const policy = await effectiveShipReadyPolicy();
  const all = await computeReadyWorks(unit, policy);
  // TEK WHERE: liste, imleç ve özet şeridi aynı süzülmüş diziden.
  const matchesFilter = (r: ReadyWorkRow & { customerIds: string[] }): boolean =>
    (states.length === 0 || states.includes(r.state)) && (customerIds.length === 0 || r.customerIds.some((c) => customerIds.includes(c)));
  const filtered = all.filter(matchesFilter).sort((a, b) => compareKeys(sortKeyOf(a), sortKeyOf(b)));

  const summary: ReadyWorkSummary = { units: 0, ready: 0, partial: 0, none: 0, readyMeters: 0, inProcessMeters: 0, shippedMeters: 0 };
  let rm = new Prisma.Decimal(0), im = new Prisma.Decimal(0), sm = new Prisma.Decimal(0);
  for (const r of filtered) {
    summary.units++;
    if (r.state === "READY") summary.ready++;
    else if (r.state === "PARTIAL") summary.partial++;
    else summary.none++;
    rm = rm.plus(r.readyMeters); im = im.plus(r.inProcessMeters); sm = sm.plus(r.shippedMeters);
  }
  summary.readyMeters = num(rm); summary.inProcessMeters = num(im); summary.shippedMeters = num(sm);

  const start = after ? filtered.findIndex((r) => compareKeys(sortKeyOf(r), after) > 0) : 0;
  const page = start < 0 ? [] : filtered.slice(start, start + limit);
  const hasMore = start >= 0 && start + limit < filtered.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeDynamicCursor({ v: JSON.stringify([STATE_RANK[last.state], last.label]), id: last.id, t: "s" }) : null;
  const items: ReadyWorkRow[] = page.map(({ customerIds: _omit, ...row }) => row);
  return { success: true, data: { items, nextCursor, summary, policy } };
}
