// =============================================================================
// ÜRETİM ZİNCİRİ HUB'I — "Hangi sipariş kalemi zincirin neresinde ve nerede takıldı?" (Z3, 2026-09-18)
// =============================================================================
// Satır = AÇIK sipariş satırı → iş emri → dokuma işi → levent. YALNIZ OKUR ve hiçbir sayıyı yeniden tanımlamaz
// (URETIM-BELGE-ZINCIRI §5.1): karşılama `computeLineLedgerTx` (SackAllocation) · iş emri adımı `WorkOrderStep` ·
// dokuma ilerlemesi Σ koşum `producedM` (fasonda kabul topları) ÷ `plannedM` · levent kalanı `remainingByBeam` (defter) ·
// gecikme plan bitişi ↔ bugün (fabrika günü). `plannedM` HEDEFTİR: %100 işi kapatmaz, ilerleme null ise uydurulmaz.
// Devere kapalıysa levent alanı HİÇ dönmez (kolon değil anahtar düşer). Bağsız kayıtlar (işsiz levent · siparişsiz dokuma ·
// dışarıdan gelen top) satır listesinden DEĞİL kendi sayımlarından gelir — satır listesine sığmayan ya da sipariş bağı
// olmayan kayıt eksik sayılmaz (test_rapor_zincir negatif sonda ①). Süzme SUNUCUDA: müşteri (DB) · durum · gecikmiş (satır).
// =============================================================================
import { OrderStatus, Prisma, RollEntrySource, StepStatus, WarpBeamStatus, WeavingExecutionKind, WeavingOrderStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDayStart } from "../../constants/time";
import { K18_DEAD_STATUSES } from "../batch.service";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { computeLineLedgerTx } from "../helpers/order-status.helper";
import { receivedMetersByWeavingOrder } from "../helpers/weaving-order-of-roll.helper";
import { remainingByBeam } from "../helpers/warp-beam.helper";
import { readDevereEnabled } from "../system-setting.service";
import { droppedRows, optionList, type Secenekler, type WithSecenekler } from "./_secenekler";

export const CHAIN_STATUSES = ["BEKLEYEN", "DEVAM", "GECIKMIS", "TAMAMLANAN"] as const;
export type ChainStatus = (typeof CHAIN_STATUSES)[number];

export interface ChainInput {
  customerId?: string[];
  durum?: ChainStatus;
  /** "true" → yalnız gecikmiş satırlar (aç/kapa süzgeci; anahtar yoksa hepsi). */
  gecikmis?: "true";
}

export interface ChainRow {
  orderLineId: string;
  siparis: { id: string; no: string; teslimTarihi: string | null };
  musteri: { id: string; ad: string };
  kumas: { id: string; ad: string };
  renk: { id: string; ad: string } | null;
  siparisM: number;
  sevkM: number;
  isEmri: { id: string; no: string; durum: WorkOrderStatus; adim: string | null } | null;
  dokuma: { id: string; no: string; durum: WeavingOrderStatus; dokunanM: number; planM: number | null; ilerlemePct: number | null; planBitis: string | null } | null;
  /** Yalnız devere AÇIKKEN anahtar var; açıkken bağ yoksa null. */
  levent?: { id: string; no: string; durum: WarpBeamStatus; kalanM: number } | null;
  gecikmeGun: number | null;
  durum: ChainStatus;
}

export interface ChainBuckets {
  /** Yalnız devere açıkken; kapalıyken anahtar YOK (kova çizilmez). */
  issizLevent?: number;
  siparissizDokuma: number;
  disaridanTop: number;
}

export interface ChainReport {
  satirlar: ChainRow[];
  /** Detay tavanına (500) sığmayan satır sayısı — özet HEPSİNİ kapsar. */
  satirOmitted: number;
  kovalar: ChainBuckets;
  ozet: { satir: number; gecikmis: number; bagsiz: number };
  moduller: { devere: boolean };
}

export const MAX_CHAIN_ROWS = 500;
const OPEN_ORDER: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.APPROVED, OrderStatus.PARTIAL_SHIPPED];
const LIVE_BEAM: WarpBeamStatus[] = [WarpBeamStatus.MOUNTED, WarpBeamStatus.READY, WarpBeamStatus.PLANNED];
const OPEN_WEAVING: WeavingOrderStatus[] = [WeavingOrderStatus.PLANNED, WeavingOrderStatus.IN_PROGRESS];
/** Dışarıdan gelen top: kendi tezgahımızda doğmamış (satın alma / tedarikçi / yarı mamul) ve şu an bir iş emri adımında. */
const OUTSIDE_SOURCES: RollEntrySource[] = [RollEntrySource.SUPPLIER_RECEIPT, RollEntrySource.PURCHASE_RECEIPT, RollEntrySource.SEMI_FINISHED];

const num = (v: Prisma.Decimal | number | string | null | undefined): number => (v == null ? 0 : Number(v));

/** Gecikme günü: plan bitişi bugünün fabrika gününden ÖNCEYSE aradaki gün; değilse null (yalnız pozitif basılır). */
export function lateDays(planEnd: Date | null | undefined, today: Date = factoryDayStart()): number | null {
  if (!planEnd) return null;
  const gun = Math.floor((today.getTime() - factoryDayStart(planEnd).getTime()) / 86_400_000);
  return gun > 0 ? gun : null;
}

/** İlerleme yüzdesi: hedef yoksa uydurulmaz (null); hedef varken %100 aşılabilir (hedef tetik değildir). */
export function progressPct(dokunanM: number, planM: number | null): number | null {
  if (planM == null || planM <= 0) return null;
  return Math.round((dokunanM / planM) * 1000) / 10;
}

/** Satır durumu — süzgeç için sınıf; sayıların kendisi değil. */
export function rowStatus(r: { siparisM: number; sevkM: number; gecikmeGun: number | null; isEmri: unknown | null; dokuma: unknown | null }): ChainStatus {
  if (r.sevkM >= r.siparisM && r.siparisM > 0) return "TAMAMLANAN";
  if (r.gecikmeGun != null) return "GECIKMIS";
  if (r.isEmri || r.dokuma) return "DEVAM";
  return "BEKLEYEN";
}

/** İş emrinin ŞU ANKİ adımı: ilk ACTIVE, yoksa ilk PENDING, hepsi bittiyse son adım. */
function currentStepName(steps: Array<{ stepSequence: number; status: StepStatus; station: { name: string } | null }>): string | null {
  const sorted = [...steps].sort((a, b) => a.stepSequence - b.stepSequence);
  const hit = sorted.find((s) => s.status === StepStatus.ACTIVE) ?? sorted.find((s) => s.status === StepStatus.PENDING) ?? sorted[sorted.length - 1];
  return hit?.station?.name ?? null;
}

const beamRank = (s: WarpBeamStatus): number => LIVE_BEAM.indexOf(s);

/** Dokuma ilerlemesi: içeride Σ koşum `producedM` (iptal edilmemiş), fasonda kabul toplarının ilk metresi — iş başına, tek turda. */
async function wovenMetersByOrder(orders: Array<{ id: string; executionKind: WeavingExecutionKind }>): Promise<Map<string, number>> {
  const inHouseIds = [...new Set(orders.filter((w) => w.executionKind === WeavingExecutionKind.IN_HOUSE).map((w) => w.id))];
  const subIds = [...new Set(orders.filter((w) => w.executionKind !== WeavingExecutionKind.IN_HOUSE).map((w) => w.id))];
  const out = new Map<string, number>();
  if (inHouseIds.length > 0) {
    const runs = await prisma.machineRun.groupBy({ by: ["weavingOrderId"], where: { weavingOrderId: { in: inHouseIds }, revokedAt: null }, _sum: { producedM: true } });
    for (const r of runs) if (r.weavingOrderId) out.set(r.weavingOrderId, num(r._sum.producedM));
  }
  if (subIds.length > 0) for (const [id, m] of await receivedMetersByWeavingOrder(prisma, subIds)) out.set(id, (out.get(id) ?? 0) + m);
  return out;
}

/** Bağsız kovalar KENDİ sayımından (satır listesinden değil) + müşteri seçenekleri (süzgeçten bağımsız) + süzgeçli evren. */
async function bucketsAndOptions(devere: boolean, isFiltered: boolean): Promise<{ kovalar: ChainBuckets; secenekler: Secenekler; unfilteredCount: number | null }> {
  const [issizLevent, siparissizDokuma, disaridanTop, optionSource, unfilteredCount] = await Promise.all([
    devere ? prisma.warpBeam.count({ where: { weavingOrderId: null, status: { in: LIVE_BEAM } } }) : Promise.resolve(undefined),
    prisma.weavingOrder.count({ where: { status: { in: OPEN_WEAVING }, orderLineLinks: { none: {} } } }),
    prisma.roll.count({ where: { entrySource: { in: OUTSIDE_SOURCES }, status: { notIn: K18_DEAD_STATUSES }, currentStepId: { not: null } } }),
    prisma.order.findMany({ where: { status: { in: OPEN_ORDER }, lines: { some: ACTIVE_LINE } }, select: { customer: { select: { id: true, name: true } } }, distinct: ["customerId"] }),
    isFiltered ? prisma.orderLine.count({ where: { ...ACTIVE_LINE, order: { status: { in: OPEN_ORDER } } } }) : Promise.resolve(null),
  ]);
  return {
    kovalar: { ...(issizLevent === undefined ? {} : { issizLevent }), siparissizDokuma, disaridanTop },
    secenekler: { customerId: optionList(optionSource.map((o) => ({ id: o.customer.id, ad: o.customer.name }))) },
    unfilteredCount,
  };
}

export async function getProductionChain(input: ChainInput = {}): Promise<ChainReport & WithSecenekler> {
  const devere = await readDevereEnabled();
  const customerFilter = input.customerId && input.customerId.length > 0 ? { customerId: { in: input.customerId } } : {};
  const lines = await prisma.orderLine.findMany({
    where: { ...ACTIVE_LINE, order: { status: { in: OPEN_ORDER }, ...customerFilter } },
    select: {
      id: true, quantity: true,
      order: { select: { id: true, orderNumber: true, deadline: true, orderDate: true, customer: { select: { id: true, name: true } } } },
      item: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
      workOrderLinks: {
        where: { ...ACTIVE_ORDER_LINK, workOrder: { status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } } },
        select: { workOrder: { select: { id: true, workOrderNumber: true, status: true, createdAt: true, steps: { select: { stepSequence: true, status: true, station: { select: { name: true } } } } } } },
      },
      weavingOrderLinks: {
        where: { weavingOrder: { status: { not: WeavingOrderStatus.CANCELLED } } },
        select: { weavingOrder: { select: { id: true, weavingOrderNumber: true, status: true, plannedM: true, plannedEndDate: true, executionKind: true, createdAt: true, warpBeams: { where: { status: { in: LIVE_BEAM } }, select: { id: true, beamNo: true, status: true, createdAt: true } } } } },
      },
    },
    orderBy: [{ order: { orderNumber: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
  });

  const lineIds = lines.map((l) => l.id);
  const shipped = await computeLineLedgerTx(prisma as unknown as Prisma.TransactionClient, lineIds);

  const woAll = lines.flatMap((l) => l.weavingOrderLinks.map((k) => k.weavingOrder));
  const wovenByOrder = await wovenMetersByOrder(woAll);

  // Levent: iş başına EN İLERİ canlı levent (takılı > hazır > planlı; eşitse en yeni); kalan metre defterden tek sorguyla.
  const pickBeam = (w: (typeof woAll)[number]) => [...w.warpBeams].sort((a, b) => beamRank(a.status) - beamRank(b.status) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const beamIds = devere ? [...new Set(woAll.map((w) => pickBeam(w)?.id).filter((x): x is string => Boolean(x)))] : [];
  const remaining = beamIds.length > 0 ? await remainingByBeam(prisma, beamIds) : new Map<string, number>();

  const today = factoryDayStart();
  const all: ChainRow[] = lines.map((l) => {
    const wo = [...l.workOrderLinks.map((k) => k.workOrder)].sort((a, b) => (a.status === WorkOrderStatus.IN_PROGRESS ? -1 : 0) - (b.status === WorkOrderStatus.IN_PROGRESS ? -1 : 0) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    const dk = [...l.weavingOrderLinks.map((k) => k.weavingOrder)].sort((a, b) => (a.status === WeavingOrderStatus.IN_PROGRESS ? -1 : 0) - (b.status === WeavingOrderStatus.IN_PROGRESS ? -1 : 0) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    const beam = devere && dk ? pickBeam(dk) : null;
    const planM = dk?.plannedM == null ? null : num(dk.plannedM);
    const dokunanM = dk ? wovenByOrder.get(dk.id) ?? 0 : 0;
    const siparisM = num(l.quantity);
    const sevkM = num(shipped.get(l.id)?.shipped);
    const planEnd = dk?.plannedEndDate ?? l.order.deadline ?? null;
    const gecikmeGun = sevkM >= siparisM && siparisM > 0 ? null : lateDays(planEnd, today);
    const row: ChainRow = {
      orderLineId: l.id,
      siparis: { id: l.order.id, no: l.order.orderNumber, teslimTarihi: l.order.deadline ? l.order.deadline.toISOString() : null },
      musteri: { id: l.order.customer.id, ad: l.order.customer.name },
      kumas: { id: l.item.id, ad: l.item.name },
      renk: l.color ? { id: l.color.id, ad: l.color.name } : null,
      siparisM, sevkM,
      isEmri: wo ? { id: wo.id, no: wo.workOrderNumber, durum: wo.status, adim: currentStepName(wo.steps) } : null,
      dokuma: dk ? { id: dk.id, no: dk.weavingOrderNumber, durum: dk.status, dokunanM, planM, ilerlemePct: progressPct(dokunanM, planM), planBitis: dk.plannedEndDate ? dk.plannedEndDate.toISOString() : null } : null,
      ...(devere ? { levent: beam ? { id: beam.id, no: beam.beamNo, durum: beam.status, kalanM: remaining.get(beam.id) ?? 0 } : null } : {}),
      gecikmeGun,
      durum: "BEKLEYEN",
    };
    row.durum = rowStatus(row);
    return row;
  });

  const filtered = all.filter((r) => (!input.durum || r.durum === input.durum) && (input.gecikmis !== "true" || r.gecikmeGun != null));
  const isFiltered = Boolean(input.customerId?.length) || Boolean(input.durum) || input.gecikmis === "true";

  const { kovalar, secenekler, unfilteredCount } = await bucketsAndOptions(devere, isFiltered);
  const bagsiz = (kovalar.issizLevent ?? 0) + kovalar.siparissizDokuma + kovalar.disaridanTop;
  return {
    satirlar: filtered.slice(0, MAX_CHAIN_ROWS),
    satirOmitted: Math.max(0, filtered.length - MAX_CHAIN_ROWS),
    kovalar,
    ozet: { satir: filtered.length, gecikmis: filtered.filter((r) => r.gecikmeGun != null).length, bagsiz },
    moduller: { devere },
    secenekler,
    dusenSatir: droppedRows(unfilteredCount, filtered.length),
  };
}
