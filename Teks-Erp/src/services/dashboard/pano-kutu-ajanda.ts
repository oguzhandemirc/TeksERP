// =============================================================================
// AÇILIŞ PANOSU — AJANDA kutusu (günün işleri + ay görünümü)
// =============================================================================
// "O gün ne planlı": beklenen alış teslimi (açık alış siparişi `expectedDate`), planlı başlangıcı o
// gün olan açık iş emri ve dokuma işi. Açıklık yüklemleri tek kaynaktan (`live-ref-where.helper`).
// GECİKME listesi/sayacı ÜRETİLMEZ (kullanıcı kararı: termin önemsiz). Sevkiyatın planlanan tarihi
// alanı YOK → planlı sevkiyatlar tarihsiz liste olarak döner, güne yerleştirilmez (uydurulmaz).
// Gün sınırları fabrika diliminde (`constants/time.ts`).
// =============================================================================
import { ShipmentStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDayStartOfKey, factoryYmd } from "../../constants/time";
import { OPEN_PURCHASE_ORDER, OPEN_WEAVING_ORDER, OPEN_WORK_ORDER } from "../helpers/live-ref-where.helper";
import { shiftDayKey } from "./pano-donem";
import type { PanoGates } from "./pano-kaynak";

/** Gün listesinde kalem tavanı; `toplam` tavandan önce sayılır. */
export const AGENDA_LIST_CAP = 20;
/** Ay sorgusunun emniyet tavanı (açık plan kalemi; aşılırsa `kesildi: true`). */
const MONTH_ROW_CAP = 2000;

export interface AgendaParams { gun: string; ay: string }

interface Range { from: Date; to: Date }
interface Dated { at: Date | null }

function dayRange(dayKey: string): Range {
  return { from: factoryDayStartOfKey(dayKey), to: factoryDayStartOfKey(shiftDayKey(dayKey, 1)) };
}

function nextMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

function monthRange(monthKey: string): Range {
  return { from: factoryDayStartOfKey(`${monthKey}-01`), to: factoryDayStartOfKey(`${nextMonthKey(monthKey)}-01`) };
}

export function defaultAgendaParams(now: Date, gun?: string, ay?: string): AgendaParams {
  const day = gun ?? factoryYmd(now);
  return { gun: day, ay: ay ?? day.slice(0, 7) };
}

const inRange = (r: Range) => ({ gte: r.from, lt: r.to });

function purchaseRows(r: Range) {
  return prisma.purchaseOrder.findMany({
    where: { ...OPEN_PURCHASE_ORDER, expectedDate: inRange(r) },
    select: { id: true, orderNo: true, status: true, expectedDate: true, supplier: { select: { name: true } }, subcontractorSupplier: { select: { name: true } } },
    orderBy: [{ expectedDate: "asc" }, { orderNo: "asc" }],
    take: MONTH_ROW_CAP,
  });
}

function workOrderRows(r: Range) {
  return prisma.workOrder.findMany({
    where: { ...OPEN_WORK_ORDER, plannedStartDate: inRange(r) },
    select: { id: true, workOrderNumber: true, status: true, plannedStartDate: true, targetQuantity: true },
    orderBy: [{ plannedStartDate: "asc" }, { workOrderNumber: "asc" }],
    take: MONTH_ROW_CAP,
  });
}

function weavingRows(r: Range) {
  return prisma.weavingOrder.findMany({
    where: { ...OPEN_WEAVING_ORDER, plannedStartDate: inRange(r) },
    select: { id: true, weavingOrderNumber: true, status: true, plannedStartDate: true, plannedM: true, item: { select: { name: true } } },
    orderBy: [{ plannedStartDate: "asc" }, { weavingOrderNumber: "asc" }],
    take: MONTH_ROW_CAP,
  });
}

type PurchaseRow = Awaited<ReturnType<typeof purchaseRows>>[number];
type WorkRow = Awaited<ReturnType<typeof workOrderRows>>[number];
type WeavingRow = Awaited<ReturnType<typeof weavingRows>>[number];

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const num = (d: { toString(): string } | null): number | null => (d === null ? null : Number(d.toString()));

/** Ay satırlarından güne düşenler (gün ayın içindeyse ikinci sorgu atılmaz). */
async function rowsOfDay<T>(params: AgendaParams, monthRows: T[] | null, at: (r: T) => Date | null, load: (r: Range) => Promise<T[]>): Promise<T[] | null> {
  if (monthRows === null) return null;
  if (params.gun.slice(0, 7) === params.ay) return monthRows.filter((r) => { const d = at(r); return d !== null && factoryYmd(d) === params.gun; });
  return load(dayRange(params.gun));
}

function listOf<T, U>(rows: T[] | null, map: (r: T) => U): { toplam: number; kalemler: U[] } | null {
  return rows === null ? null : { toplam: rows.length, kalemler: rows.slice(0, AGENDA_LIST_CAP).map(map) };
}

function monthDays(params: AgendaParams, groups: Array<{ key: "alis" | "isEmri" | "dokuma"; rows: Dated[] | null }>) {
  const counts = new Map<string, { alis: number; isEmri: number; dokuma: number }>();
  for (const g of groups) {
    for (const r of g.rows ?? []) {
      if (!r.at) continue;
      const day = factoryYmd(r.at);
      const c = counts.get(day) ?? { alis: 0, isEmri: 0, dokuma: 0 };
      c[g.key]++;
      counts.set(day, c);
    }
  }
  const days: Array<{ gun: string; alis: number; isEmri: number; dokuma: number; toplam: number }> = [];
  for (let d = `${params.ay}-01`; d.startsWith(params.ay); d = shiftDayKey(d, 1)) {
    const c = counts.get(d) ?? { alis: 0, isEmri: 0, dokuma: 0 };
    days.push({ gun: d, ...c, toplam: c.alis + c.isEmri + c.dokuma });
  }
  return days;
}

function plannedShipments(open: boolean) {
  if (!open) return Promise.resolve(null);
  const where = { status: ShipmentStatus.PLANNED };
  return Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where, take: AGENDA_LIST_CAP, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, shipmentNo: true, createdAt: true, customer: { select: { name: true } } },
    }),
  ]).then(([toplam, rows]) => ({
    toplam,
    kalemler: rows.map((s) => ({ id: s.id, no: s.shipmentNo, musteri: s.customer.name, olusturuldu: s.createdAt.toISOString() })),
  }));
}

export async function agendaBox(can: PanoGates, params: AgendaParams) {
  const month = monthRange(params.ay);
  const [po, wo, wv, sevkiyat] = await Promise.all([
    can.alis ? purchaseRows(month) : Promise.resolve(null),
    can.isEmri ? workOrderRows(month) : Promise.resolve(null),
    can.dokumaIsi ? weavingRows(month) : Promise.resolve(null),
    plannedShipments(can.sevkeHazir),
  ]);
  const [poDay, woDay, wvDay] = await Promise.all([
    rowsOfDay<PurchaseRow>(params, po, (r) => r.expectedDate, purchaseRows),
    rowsOfDay<WorkRow>(params, wo, (r) => r.plannedStartDate, workOrderRows),
    rowsOfDay<WeavingRow>(params, wv, (r) => r.plannedStartDate, weavingRows),
  ]);
  return {
    gun: params.gun,
    ay: params.ay,
    isler: {
      alisTeslim: listOf(poDay, (r) => ({ id: r.id, no: r.orderNo, durum: r.status, taraf: r.supplier?.name ?? r.subcontractorSupplier?.name ?? null, zaman: iso(r.expectedDate) })),
      isEmriBaslangic: listOf(woDay, (r) => ({ id: r.id, no: r.workOrderNumber, durum: r.status, hedefMetre: num(r.targetQuantity), zaman: iso(r.plannedStartDate) })),
      dokumaBaslangic: listOf(wvDay, (r) => ({ id: r.id, no: r.weavingOrderNumber, durum: r.status, kumas: r.item.name, planlananMetre: num(r.plannedM), zaman: iso(r.plannedStartDate) })),
    },
    planliSevkiyat: sevkiyat,
    ayGunleri: monthDays(params, [
      { key: "alis", rows: po?.map((r) => ({ at: r.expectedDate })) ?? null },
      { key: "isEmri", rows: wo?.map((r) => ({ at: r.plannedStartDate })) ?? null },
      { key: "dokuma", rows: wv?.map((r) => ({ at: r.plannedStartDate })) ?? null },
    ]),
    kesildi: [po, wo, wv].some((r) => (r?.length ?? 0) >= MONTH_ROW_CAP),
  };
}
