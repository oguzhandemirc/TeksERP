// =============================================================================
// SİPARİŞ "NEREDE?" — TEK KAYNAK (2026-11-04, tasarım SIPARIS-NEREDE-TASARIM)
// =============================================================================
// Siparişin malı şu an nerede: bağlı AKTİF iş emirlerinin toplarından TÜRETİLİR (saklanmaz;
// yeni kolon/tablo yok). Top↔sipariş bağı yoktur → yer bilgisi İŞ EMRİ düzeyindedir; bir
// iş emri iki siparişe bağlıysa ikisinde de aynı yer görünür (Ek karar 4).
//
// Kaynaklar (kopya yazılmaz, hepsi tek kaynaktan):
//   · canlı top + istasyon   → `workorder-location.helper` (LOCATION_LIVE_STATUSES, currentStepId)
//   · iş emrinin topları     → `workorder-rolls.helper` (üç yol: producedInStep · currentStep · batch)
//   · sevke hazır / gitti    → `ship-readiness.helper` (SHIP_READY_READY / GONE kümeleri)
//   · fasonda firma + gün    → `roll-place.helper` (açık + outstanding kalem, top fasoncuda)
//   · termin                 → `order-deadline.helper`
//
// BOĞAZ İKİZİ: bellek-içi `deriveOrderWhere` (yer listesi) ↔ Prisma süzgeci `orderWhereFilterParts`
// (`order-where-filter.helper.ts`; dosya boyu tavanı için ayrı, sözleşme tek).
// Bekçi `scripts/test_order_where.ts` her fikstür siparişte "süzgecin döndürdüğü küme ==
// türetmede o yeri taşıyanlar" eşitliğini ölçer. Biri değişirse öteki de.
//
// Sorgu bütçesi: sayfa başına SABİT 2 sorgu (raw SQL gruplu top özeti + fason kalem listesi);
// sipariş başına sorgu yok.
// =============================================================================
import { OrderStatus, Prisma, RollStatus, StationType, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readFilterList } from "../../utils/query-parser";
import { factoryDayKeyUtcMidnight, factoryDayStartOfKey } from "../../constants/time";
import { LOCATION_LIVE_STATUSES } from "./workorder-location.helper";
import { whereWorkOrdersOfRolls } from "./workorder-rolls.helper";
import { SHIP_READY_GONE_STATUSES, SHIP_READY_READY_STATUSES } from "./ship-readiness.helper";
import { fasonItemNowWhere } from "./roll-place.helper";
import { daysPastDeadline, isDeadlineOpenStatus } from "./order-deadline.helper";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";

/**
 * Sipariş rollup'ında "aktif" iş emri: CANCELLED + SUPERSEDED hariç. "İş Emri" rozeti/süzgeci
 * (`order.service` WO_STATE_WHERE) ile "Nerede?" aynı kümeyi okur.
 */
export const WO_ROLLUP_ACTIVE: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.COMPLETED,
];

/** Sipariş hâlâ gönderim bekliyor: tamamlanmamış ve iptal edilmemiş. */
export const OPEN_ORDER_EXCLUDED: OrderStatus[] = [OrderStatus.COMPLETED, OrderStatus.CANCELLED];
export function isOrderOpenForWhere(status: OrderStatus): boolean {
  return !OPEN_ORDER_EXCLUDED.includes(status);
}

export type OrderWhereState = "IPTAL" | "TAMAM" | "IE_YOK" | "BASLANMADI" | "YERLER" | "GONDERILDI";
export type OrderWherePlaceKind = "ASAMA" | "FASON" | "HAZIR";

export interface OrderWherePlace {
  tur: OrderWherePlaceKind;
  /** ASAMA: istasyon id · FASON: firma id (firması çözülemeyen fason top → null) · HAZIR: null. */
  id: string | null;
  /** ASAMA: istasyon adı · FASON: firma adı (null olabilir) · HAZIR: null. */
  ad: string | null;
  topSayisi: number;
  metre: number;
  /** Yalnız FASON: en eski gönderimden bu yana geçen FABRİKA günü. */
  gun: number | null;
}

export interface OrderWhere {
  durum: OrderWhereState;
  /** Top sayısı çoktan aza; eşitlikte metre, sonra ad. */
  yerler: OrderWherePlace[];
  terminGecti: boolean;
  /** Bağlı iş emirlerinin toplarındaki en son durum değişimi (ISO); yoksa null. */
  sonHareket: string | null;
}

// ── İş emri düzeyi ham olgular ──────────────────────────────────────────────

export interface WoLiveGroup {
  stepId: string;
  stationId: string;
  stationName: string;
  dis: boolean;
  status: RollStatus;
  count: number;
  qty: number;
}
export interface WoFasonGroup {
  firmaId: string;
  firmaAd: string;
  count: number;
  qty: number;
  enEski: Date;
}
export interface WoFacts {
  live: WoLiveGroup[];
  fason: WoFasonGroup[];
  hazir: { count: number; qty: number };
  gitti: { count: number; qty: number };
  sonHareket: Date | null;
}

const emptyFacts = (): WoFacts => ({ live: [], fason: [], hazir: { count: 0, qty: 0 }, gitti: { count: 0, qty: 0 }, sonHareket: null });

type FactRow = {
  wo: string;
  kind: "LIVE" | "READY" | "GONE";
  status: string | null;
  stepId: string | null;
  stationId: string | null;
  stationName: string | null;
  stationType: string | null;
  n: number;
  qty: number;
  last: Date | null;
};

/** Fabrika günü farkı (takvim günü; saat dilimi `time.ts`ten). */
export function factoryDaysSince(at: Date, now: Date): number {
  const DAY = 86_400_000;
  return Math.max(0, Math.round((factoryDayKeyUtcMidnight(now).getTime() - factoryDayKeyUtcMidnight(at).getTime()) / DAY));
}

/** `dispatchedAt < eşik` ⇔ fabrika günü farkı > `days` ("X günden uzun"). */
export function fasonDayThreshold(days: number, now: Date): Date {
  const today = factoryDayKeyUtcMidnight(now);
  const key = new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return factoryDayStartOfKey(key);
}

/**
 * Verilen iş emirlerinin top özetleri — SABİT 2 sorgu (iş emri sayısından bağımsız).
 * (1) raw SQL: canlı toplar adım+istasyon+statü bazında + hazır/gitti toplar (üç yol, DISTINCT).
 * (2) fasonda kalemler: açık + outstanding sevkin kalemi, topu hâlâ AT_SUBCONTRACTOR.
 */
export async function loadWorkOrderFacts(woIds: readonly string[]): Promise<Map<string, WoFacts>> {
  const out = new Map<string, WoFacts>();
  const ids = [...new Set(woIds)];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, emptyFacts());

  const live = LOCATION_LIVE_STATUSES.map((s) => s as string);
  const ready = SHIP_READY_READY_STATUSES.map((s) => s as string);
  const gone = SHIP_READY_GONE_STATUSES.map((s) => s as string);
  // Üç yol `whereRollsOfWorkOrder`in SQL karşılığıdır (producedInStep · currentStep · batch).
  const rows = await prisma.$queryRaw<FactRow[]>`
    SELECT s."workOrderId" AS wo, 'LIVE' AS kind, r.status::text AS status, s.id AS "stepId",
           st.id AS "stationId", st.name AS "stationName", st.type::text AS "stationType",
           COUNT(*)::int AS n, COALESCE(SUM(r."currentQty"), 0)::float8 AS qty, MAX(r."statusChangedAt") AS last
    FROM rolls r
    JOIN work_order_steps s ON s.id = r."currentStepId"
    JOIN stations st ON st.id = s."stationId"
    WHERE s."workOrderId" = ANY(${ids}::uuid[])
      AND r.status::text IN (${Prisma.join(live)})
    GROUP BY s."workOrderId", r.status, s.id, st.id, st.name, st.type
    UNION ALL
    SELECT wr.wo, CASE WHEN r.status::text IN (${Prisma.join(ready)}) THEN 'READY' ELSE 'GONE' END AS kind,
           NULL, NULL, NULL, NULL, NULL,
           COUNT(*)::int, COALESCE(SUM(r."currentQty"), 0)::float8, MAX(r."statusChangedAt")
    FROM (
      SELECT r2.id, s2."workOrderId" AS wo FROM rolls r2 JOIN work_order_steps s2 ON s2.id = r2."producedInStepId"
        WHERE s2."workOrderId" = ANY(${ids}::uuid[])
      UNION
      SELECT r3.id, s3."workOrderId" FROM rolls r3 JOIN work_order_steps s3 ON s3.id = r3."currentStepId"
        WHERE s3."workOrderId" = ANY(${ids}::uuid[])
      UNION
      SELECT r4.id, b."workOrderId" FROM rolls r4 JOIN batches b ON b.id = r4."batchId"
        WHERE b."workOrderId" = ANY(${ids}::uuid[])
    ) wr
    JOIN rolls r ON r.id = wr.id
    WHERE r.status::text IN (${Prisma.join([...ready, ...gone])})
    GROUP BY wr.wo, 2`;

  const bump = (f: WoFacts, last: Date | null) => {
    if (last && (!f.sonHareket || last > f.sonHareket)) f.sonHareket = last;
  };
  for (const r of rows) {
    const f = out.get(r.wo);
    if (!f) continue;
    bump(f, r.last);
    if (r.kind === "LIVE") {
      f.live.push({
        stepId: r.stepId as string,
        stationId: r.stationId as string,
        stationName: r.stationName as string,
        dis: r.stationType === StationType.EXTERNAL,
        status: r.status as RollStatus,
        count: r.n,
        qty: Number(r.qty),
      });
    } else {
      const bucket = r.kind === "READY" ? f.hazir : f.gitti;
      bucket.count += r.n;
      bucket.qty += Number(r.qty);
    }
  }

  const items = await prisma.subcontractorDispatchItem.findMany({
    where: fasonItemNowWhere({ workOrderId: { in: ids } }),
    select: {
      rollId: true,
      roll: { select: { currentQty: true } },
      dispatch: {
        select: { workOrderId: true, subcontractorId: true, dispatchedAt: true, subcontractor: { select: { name: true } } },
      },
    },
  });
  // Aynı top iki açık kalemde görünürse (olmamalı) en eski gönderim sayılır, top bir kez.
  const byRoll = new Map<string, (typeof items)[number]>();
  for (const it of items) {
    if (!it.rollId || !it.roll) continue;
    const prev = byRoll.get(it.rollId);
    if (!prev || it.dispatch.dispatchedAt < prev.dispatch.dispatchedAt) byRoll.set(it.rollId, it);
  }
  for (const it of byRoll.values()) {
    const f = it.dispatch.workOrderId ? out.get(it.dispatch.workOrderId) : undefined;
    if (!f) continue;
    const g = f.fason.find((x) => x.firmaId === it.dispatch.subcontractorId);
    const qty = Number(it.roll?.currentQty ?? 0);
    if (g) {
      g.count += 1;
      g.qty += qty;
      if (it.dispatch.dispatchedAt < g.enEski) g.enEski = it.dispatch.dispatchedAt;
    } else {
      f.fason.push({
        firmaId: it.dispatch.subcontractorId,
        firmaAd: it.dispatch.subcontractor.name,
        count: 1,
        qty,
        enEski: it.dispatch.dispatchedAt,
      });
    }
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** İş emirlerinin olgularından yer listesi (ASAMA istasyon bazında · FASON firma bazında · HAZIR tek). */
export function placesOfFacts(facts: readonly WoFacts[], now: Date): OrderWherePlace[] {
  const asama = new Map<string, OrderWherePlace>();
  const fason = new Map<string | null, OrderWherePlace & { enEski: Date | null }>();
  let hazir = { count: 0, qty: 0 };
  for (const f of facts) {
    let subLiveCount = 0;
    let subLiveQty = 0;
    for (const g of f.live) {
      if (g.status === RollStatus.AT_SUBCONTRACTOR) {
        subLiveCount += g.count;
        subLiveQty += g.qty;
        continue;
      }
      const p = asama.get(g.stationId) ?? { tur: "ASAMA", id: g.stationId, ad: g.stationName, topSayisi: 0, metre: 0, gun: null };
      p.topSayisi += g.count;
      p.metre += g.qty;
      asama.set(g.stationId, p);
    }
    let firmCount = 0;
    let firmQty = 0;
    for (const g of f.fason) {
      firmCount += g.count;
      firmQty += g.qty;
      const p = fason.get(g.firmaId) ?? { tur: "FASON", id: g.firmaId, ad: g.firmaAd, topSayisi: 0, metre: 0, gun: null, enEski: null };
      p.topSayisi += g.count;
      p.metre += g.qty;
      if (!p.enEski || g.enEski < p.enEski) p.enEski = g.enEski;
      fason.set(g.firmaId, p);
    }
    // Fasonda görünüp açık sevk kalemi bulunmayan top: firmasız "Fasonda".
    if (subLiveCount > firmCount) {
      const p = fason.get(null) ?? { tur: "FASON", id: null, ad: null, topSayisi: 0, metre: 0, gun: null, enEski: null };
      p.topSayisi += subLiveCount - firmCount;
      p.metre += Math.max(0, subLiveQty - firmQty);
      fason.set(null, p);
    }
    hazir = { count: hazir.count + f.hazir.count, qty: hazir.qty + f.hazir.qty };
  }
  const list: OrderWherePlace[] = [
    ...asama.values(),
    ...[...fason.values()].map(({ enEski, ...p }) => ({ ...p, gun: enEski ? factoryDaysSince(enEski, now) : null })),
  ];
  if (hazir.count > 0) list.push({ tur: "HAZIR", id: null, ad: null, topSayisi: hazir.count, metre: hazir.qty, gun: null });
  return list
    .map((p) => ({ ...p, metre: round1(p.metre) }))
    .sort((a, b) => b.topSayisi - a.topSayisi || b.metre - a.metre || (a.ad ?? "").localeCompare(b.ad ?? "", "tr"));
}

export interface OrderWhereInput {
  status: OrderStatus;
  deadline: Date | null;
  /** Siparişin AKTİF bağlarındaki iş emirleri (statüleriyle). */
  workOrders: ReadonlyArray<{ id: string; status: WorkOrderStatus }>;
}

/** Saf türetme — durum önceliği tasarımın sırasıdır. */
export function deriveOrderWhere(o: OrderWhereInput, facts: ReadonlyMap<string, WoFacts>, now: Date): OrderWhere {
  const terminGecti = daysPastDeadline(o.deadline, now.getTime()) !== null && isDeadlineOpenStatus(o.status);
  const base = { terminGecti, yerler: [] as OrderWherePlace[], sonHareket: null as string | null };
  if (o.status === OrderStatus.CANCELLED) return { ...base, durum: "IPTAL" };
  if (o.status === OrderStatus.COMPLETED) return { ...base, durum: "TAMAM" };
  const activeIds = [...new Set(o.workOrders.filter((w) => WO_ROLLUP_ACTIVE.includes(w.status)).map((w) => w.id))];
  if (activeIds.length === 0) return { ...base, durum: "IE_YOK" };
  const fs = activeIds.map((id) => facts.get(id)).filter((f): f is WoFacts => !!f);
  const last = fs.reduce<Date | null>((m, f) => (f.sonHareket && (!m || f.sonHareket > m) ? f.sonHareket : m), null);
  const yerler = placesOfFacts(fs, now);
  const sonHareket = last ? last.toISOString() : null;
  if (yerler.length > 0) return { ...base, yerler, sonHareket, durum: "YERLER" };
  if (fs.some((f) => f.gitti.count > 0)) return { ...base, sonHareket, durum: "GONDERILDI" };
  return { ...base, sonHareket, durum: "BASLANMADI" };
}

type ListOrder = {
  id: string;
  status: OrderStatus;
  deadline: Date | null;
  lines?: ReadonlyArray<{ workOrderLinks?: ReadonlyArray<{ workOrder: { id: string; status: WorkOrderStatus } | null }> }>;
};

function workOrdersOf(o: ListOrder): Array<{ id: string; status: WorkOrderStatus }> {
  const out: Array<{ id: string; status: WorkOrderStatus }> = [];
  for (const l of o.lines ?? []) for (const k of l.workOrderLinks ?? []) if (k.workOrder) out.push(k.workOrder);
  return out;
}

/** Liste satırlarına `nerede` ekler (ek alan — eski istemci görmezden gelir). Sayfa başına sabit 2 sorgu. */
export async function withOrderWhere<T extends ListOrder>(orders: T[], now = new Date()): Promise<Array<T & { nerede: OrderWhere }>> {
  const woIds = orders
    .filter((o) => isOrderOpenForWhere(o.status))
    .flatMap((o) => workOrdersOf(o).filter((w) => WO_ROLLUP_ACTIVE.includes(w.status)).map((w) => w.id));
  const facts = await loadWorkOrderFacts(woIds);
  return orders.map((o) => ({ ...o, nerede: deriveOrderWhere({ status: o.status, deadline: o.deadline, workOrders: workOrdersOf(o) }, facts, now) }));
}
