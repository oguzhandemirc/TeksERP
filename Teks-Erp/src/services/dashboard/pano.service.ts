// =============================================================================
// AÇILIŞ PANOSU — `GET /api/dashboard/pano` (salt okuma, YENİ İŞ MANTIĞI YOK)
// =============================================================================
// Her kutu var olan tek kaynaktan okunur (biten kumaş `_produced`, brüt sevk `_shipped`, Sipariş /
// Fason / Stok karneleri, liste özetleri, salon özeti, yaşlandırma). Kutu başına izin + modül
// kapısı; kapalı/izinsiz kutu `null` döner, hata değil. Termin/gecikme kutusu bilinçli YOK.
// Okumalar tx dışında paralel (tx.* + Promise.all yasağı yalnız tx içindir).
// =============================================================================
import { Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { canAccess, isModuleOpen, loadAccessContext, type AccessContext } from "../reports/semantik/izin";
import { SEMANTIC_CUBES } from "../reports/semantik/katalog";
import { producedRollsSql } from "../reports/_produced";
import { shippedPartsSql } from "../reports/_shipped";
import { round1 } from "../reports/_breakdown";
import type { DateRange } from "../reports/_shared";
import { getOrderIntake } from "../reports/order-intake.report.service";
import { getSubcontractScorecard } from "../reports/subcontract-scorecard.report.service";
import { getStockScorecard } from "../reports/stock-scorecard.report.service";
import { getAgingReport } from "../reports/finance-aging.report";
import { InventoryService } from "../inventory.service";
import { yarnService } from "../yarn.service";
import { getLoomFloor } from "../loom-floor.service";
import { buildDeliveryNoteBaseWhere, deliveryNoteStatusSummary } from "../gelen-belge-note.service";
import { buildShipmentListSummary } from "../shipping/list";
import { WO_STATE_WHERE } from "../order/list";
import { DEADLINE_OPEN_ORDER_STATUSES } from "../helpers/order-deadline.helper";
import { bucketKeySql, changePct, resolvePanoPencere, type PanoDonem, type PanoKova, type PanoPencere } from "./pano-donem";

/** "En çok" listeleri ve halka dilimi sayısı. */
export const PANO_TOP_N = 5;

export interface PanoKullanici {
  userId: string;
  permissions: readonly string[];
}

/** Uç kapısının izin birleşimi — kullanıcının en az bir kutuyu görebilmesi gerekir. */
export const PANO_ROUTE_PERMISSIONS = [
  "report:quality", "report:sales", "report:subcontract", "report:inventory",
  "warehouse:read", "roll:read", "loom:live-view", "gelen-belge:read", "shipping:read", "order:read", "finance:read",
] as const;

export interface PanoKpi { deger: number; onceki: number; degisimYuzde: number | null }
export interface PanoUrun { itemId: string; kod: string; ad: string; metre: number }

export interface PanoSummary {
  donem: PanoDonem;
  aralik: { from: string; to: string };
  oncekiAralik: { from: string; to: string };
  olusturuldu: string;
  kpi: {
    uretim: { metre: PanoKpi; top: PanoKpi } | null;
    sevk: { metre: PanoKpi; irsaliye: PanoKpi } | null;
    siparis: { adet: PanoKpi; metre: PanoKpi } | null;
    fason: { gidenMetre: PanoKpi; donenMetre: number } | null;
    stok: { mamulMetre: number; hamMetre: number; iplikKg: number | null } | null;
  };
  egilim: { kova: PanoKova; noktalar: Array<{ anahtar: string; uretimMetre: number | null; sevkMetre: number | null }> };
  dagilim: { boyut: "kumas"; dilimler: Array<{ itemId: string | null; ad: string; metre: number; yuzde: number }> } | null;
  enCok: { uretilen: PanoUrun[] | null; sevkEdilen: PanoUrun[] | null };
  tezgah: { toplam: number; calisan: number; duran: number; izlenmeyen: number; issiz: number | null; suAnYuzde: number | null } | null;
  stokOzeti: {
    mamul: { top: number; metre: number };
    ham: { top: number; metre: number };
    yariMamul: { top: number; metre: number };
    iplikKg: number | null;
    dusukStokKalem: null;
  } | null;
  fasonOzeti: { disaridakiMetre: number; disaridakiTop: number; fasoncuSayisi: number } | null;
  emanet: { top: number; metre: number } | null;
  bekleyen: {
    onayBekleyenBelge: { taslak: number; kismi: number; toplam: number } | null;
    sevkeHazir: { sevkiyat: number; metre: number } | null;
    uretimeGonderilmemisSiparis: number | null;
  };
  finans: { alacaklar: Array<{ paraBirimi: string; acikAlacak: number; vadesiGecmis: number }> } | null;
}

// ── kapılar ──────────────────────────────────────────────────────────────────

/** Semantik küp + ölçünün izin ve modülü — panonun sayısı ile rapor/analizin sayısı aynı kapıdan. */
function measureGate(ctx: AccessContext, cubeId: string, measureId: string): boolean {
  const cube = SEMANTIC_CUBES.find((c) => c.id === cubeId);
  const measure = cube?.measures.find((m) => m.id === measureId);
  return Boolean(cube && measure && canAccess(cube, ctx) && canAccess(measure, ctx));
}

function gate(ctx: AccessContext, permission: string, ...modules: string[]): boolean {
  return matchesPermission(ctx.permissions, permission) && modules.every((m) => isModuleOpen(m, ctx));
}

const skip = <T>(): Promise<T | null> => Promise.resolve(null);
const kpi = (deger: number, onceki: number): PanoKpi => ({ deger: round1(deger), onceki: round1(onceki), degisimYuzde: changePct(deger, onceki) });

// ── toplayıcılar (tek kaynak SQL gövdelerinin üstünde yalnız gruplama) ──────

interface TotalRow { qty: number | null; cnt: bigint | null; docs?: bigint | null }
interface BucketRow { k: string; qty: number | null }
interface ItemRow { itemId: string | null; code: string | null; name: string | null; qty: number | null }

async function producedTotal(range: DateRange): Promise<{ qty: number; rolls: number }> {
  const [r] = await prisma.$queryRaw<TotalRow[]>`SELECT SUM(p.qty)::float AS qty, COUNT(*) AS cnt FROM ${producedRollsSql(range)}`;
  return { qty: Number(r?.qty ?? 0), rolls: Number(r?.cnt ?? 0) };
}

function producedByBucket(range: DateRange, kova: PanoKova): Promise<BucketRow[]> {
  return prisma.$queryRaw<BucketRow[]>`SELECT ${bucketKeySql(kova, "p.at")} AS k, SUM(p.qty)::float AS qty FROM ${producedRollsSql(range)} GROUP BY 1`;
}

function producedByItem(range: DateRange): Promise<ItemRow[]> {
  return prisma.$queryRaw<ItemRow[]>`
    SELECT p."itemId" AS "itemId", i.code AS code, i.name AS name, SUM(p.qty)::float AS qty
    FROM ${producedRollsSql(range)} LEFT JOIN items i ON i.id = p."itemId"
    GROUP BY p."itemId", i.code, i.name ORDER BY qty DESC NULLS LAST, i.code ASC`;
}

async function shippedTotal(range: DateRange): Promise<{ qty: number; docs: number }> {
  const [r] = await prisma.$queryRaw<TotalRow[]>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT SUM(qty)::float AS qty, SUM(cnt) AS cnt, COUNT(DISTINCT sid) AS docs FROM parts`);
  return { qty: Number(r?.qty ?? 0), docs: Number(r?.docs ?? 0) };
}

function shippedByBucket(range: DateRange, kova: PanoKova): Promise<BucketRow[]> {
  return prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT ${bucketKeySql(kova, "p.at")} AS k, SUM(p.qty)::float AS qty FROM parts p GROUP BY 1`);
}

function shippedByItem(range: DateRange): Promise<ItemRow[]> {
  return prisma.$queryRaw<ItemRow[]>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT p."itemId" AS "itemId", i.code AS code, i.name AS name, SUM(p.qty)::float AS qty
    FROM parts p JOIN items i ON i.id = p."itemId"
    GROUP BY p."itemId", i.code, i.name ORDER BY qty DESC NULLS LAST, i.code ASC
    LIMIT ${PANO_TOP_N}`);
}

function topItems(rows: readonly ItemRow[]): PanoUrun[] {
  return rows
    .filter((r): r is ItemRow & { itemId: string } => r.itemId !== null && Number(r.qty ?? 0) > 0)
    .slice(0, PANO_TOP_N)
    .map((r) => ({ itemId: r.itemId, kod: r.code ?? "", ad: r.name ?? "", metre: round1(Number(r.qty ?? 0)) }));
}

/** Halka: ilk 5 kumaş + "Diğer"; yüzde toplamın payı (bir ondalık). Boş dönemde boş dizi. */
function distribution(rows: readonly ItemRow[]): NonNullable<PanoSummary["dagilim"]>["dilimler"] {
  const positive = rows.filter((r) => Number(r.qty ?? 0) > 0);
  const total = positive.reduce((a, r) => a + Number(r.qty ?? 0), 0);
  if (total <= 0) return [];
  const pct = (q: number): number => Math.round((q * 1000) / total) / 10;
  const head = positive.slice(0, PANO_TOP_N).map((r) => {
    const q = Number(r.qty ?? 0);
    return { itemId: r.itemId, ad: r.name ?? "Kumaşı bilinmeyen", metre: round1(q), yuzde: pct(q) };
  });
  const restQty = positive.slice(PANO_TOP_N).reduce((a, r) => a + Number(r.qty ?? 0), 0);
  return restQty > 0 ? [...head, { itemId: null, ad: "Diğer", metre: round1(restQty), yuzde: pct(restQty) }] : head;
}

function seriesOf(rows: readonly BucketRow[] | null): Map<string, number> | null {
  return rows ? new Map(rows.map((r) => [r.k, Number(r.qty ?? 0)])) : null;
}

// ── ana giriş ─────────────────────────────────────────────────────────────────

function panoGates(ctx: AccessContext) {
  return {
    uretim: measureGate(ctx, "uretim", "kalite.bitenMetre"),
    sevk: measureGate(ctx, "sevk", "sevk.brutMetre"),
    siparis: measureGate(ctx, "siparis", "siparis.metre"),
    fason: measureGate(ctx, "fason", "fason.gonderilenMetre"),
    stok: measureGate(ctx, "stok", "stok.bitmisMetre"),
    iplik: gate(ctx, "warehouse:read", "ticaretEnabled", "iplikEnabled"),
    fasonOzeti: gate(ctx, "roll:read"),
    emanet: gate(ctx, "report:inventory", "emanetEnabled"),
    tezgah: gate(ctx, "loom:live-view", "tezgahEnabled"),
    gelenBelge: gate(ctx, "gelen-belge:read", "gelenBelgeEnabled"),
    sevkeHazir: gate(ctx, "shipping:read"),
    uretimeBekleyen: gate(ctx, "order:read", "productionEnabled"),
    finans: gate(ctx, "finance:read", "financeEnabled"),
  };
}
type PanoGates = ReturnType<typeof panoGates>;

/** Kapısı açık her kaynağı TEK `Promise.all` ile okur (tx dışı; kapalı kutu sorgu atmaz). */
async function fetchSources(p: PanoPencere, can: PanoGates, now: Date) {
  const [
    prodCur, prodPrev, prodBuckets, prodItems,
    shipCur, shipPrev, shipBuckets, shipItems,
    intake, sub, stock, yarn, outside, floor, notes, planned, noWo, aging,
  ] = await Promise.all([
    can.uretim ? producedTotal(p.aralik) : skip<{ qty: number; rolls: number }>(),
    can.uretim ? producedTotal(p.oncekiAralik) : skip<{ qty: number; rolls: number }>(),
    can.uretim ? producedByBucket(p.aralik, p.kova) : skip<BucketRow[]>(),
    can.uretim ? producedByItem(p.aralik) : skip<ItemRow[]>(),
    can.sevk ? shippedTotal(p.aralik) : skip<{ qty: number; docs: number }>(),
    can.sevk ? shippedTotal(p.oncekiAralik) : skip<{ qty: number; docs: number }>(),
    can.sevk ? shippedByBucket(p.aralik, p.kova) : skip<BucketRow[]>(),
    can.sevk ? shippedByItem(p.aralik) : skip<ItemRow[]>(),
    can.siparis ? getOrderIntake(p.aralik, p.oncekiAralik) : skip<Awaited<ReturnType<typeof getOrderIntake>>>(),
    can.fason ? getSubcontractScorecard(p.aralik, p.oncekiAralik) : skip<Awaited<ReturnType<typeof getSubcontractScorecard>>>(),
    can.stok || can.emanet ? getStockScorecard() : skip<Awaited<ReturnType<typeof getStockScorecard>>>(),
    can.iplik ? yarnService.listStocks({ pageSize: 1 }) : skip<Awaited<ReturnType<typeof yarnService.listStocks>>>(),
    can.fasonOzeti ? new InventoryService().getRollSubcontractorSummary() : skip<Awaited<ReturnType<InventoryService["getRollSubcontractorSummary"]>>>(),
    can.tezgah ? getLoomFloor(now) : skip<Awaited<ReturnType<typeof getLoomFloor>>>(),
    can.gelenBelge ? deliveryNoteStatusSummary(buildDeliveryNoteBaseWhere({})) : skip<Awaited<ReturnType<typeof deliveryNoteStatusSummary>>>(),
    can.sevkeHazir ? buildShipmentListSummary({ status: ShipmentStatus.PLANNED }, null) : skip<Awaited<ReturnType<typeof buildShipmentListSummary>>>(),
    can.uretimeBekleyen
      ? prisma.order.count({ where: { AND: [{ status: { in: [...DEADLINE_OPEN_ORDER_STATUSES] } }, WO_STATE_WHERE.NONE as Prisma.OrderWhereInput] } })
      : skip<number>(),
    can.finans ? getAgingReport({ asOf: now }) : skip<Awaited<ReturnType<typeof getAgingReport>>>(),
  ]);
  return { prodCur, prodPrev, prodBuckets, prodItems, shipCur, shipPrev, shipBuckets, shipItems, intake, sub, stock, yarn, outside, floor, notes, planned, noWo, aging };
}
type PanoSources = Awaited<ReturnType<typeof fetchSources>>;

function kpiBox(can: PanoGates, d: PanoSources, yarnKg: number | null): PanoSummary["kpi"] {
  const { prodCur, prodPrev, shipCur, shipPrev, intake, sub } = d;
  const s = d.stock?.summary;
  return {
    uretim: prodCur && prodPrev ? { metre: kpi(prodCur.qty, prodPrev.qty), top: kpi(prodCur.rolls, prodPrev.rolls) } : null,
    sevk: shipCur && shipPrev ? { metre: kpi(shipCur.qty, shipPrev.qty), irsaliye: kpi(shipCur.docs, shipPrev.docs) } : null,
    siparis: intake
      ? { adet: kpi(intake.summary.orderCount, intake.summary.prevOrderCount ?? 0), metre: kpi(intake.summary.totalQty, intake.summary.prevTotalQty ?? 0) }
      : null,
    fason: sub ? { gidenMetre: kpi(sub.summary.dispatchedQty, sub.summary.prevDispatchedQty ?? 0), donenMetre: round1(sub.summary.returnedQty) } : null,
    stok: can.stok && s ? { mamulMetre: round1(s.finishedQty), hamMetre: round1(s.rawQty), iplikKg: yarnKg } : null,
  };
}

function tezgahBox(floorData: NonNullable<PanoSources["floor"]>["data"] | undefined): PanoSummary["tezgah"] {
  if (!floorData) return null;
  return {
    toplam: floorData.summary.total,
    calisan: floorData.summary.running,
    duran: floorData.summary.stopped,
    izlenmeyen: floorData.summary.unmonitored,
    // Dokuma kapalıyken koşum bilgisi yok → işsiz tezgah ölçülemez (null, 0 değil).
    issiz: floorData.dokumaEnabled ? floorData.looms.filter((l) => (l.openRuns ?? []).length === 0).length : null,
    suAnYuzde: floorData.summary.nowPct,
  };
}

function stockBoxes(can: PanoGates, d: PanoSources, yarnKg: number | null): Pick<PanoSummary, "stokOzeti" | "fasonOzeti" | "emanet"> {
  const s = d.stock?.summary;
  const outsideData = d.outside?.data;
  return {
    stokOzeti: can.stok && s
      ? {
          mamul: { top: s.finishedCount, metre: round1(s.finishedQty) },
          ham: { top: s.rawCount, metre: round1(s.rawQty) },
          yariMamul: { top: s.semiCount, metre: round1(s.semiQty) },
          iplikKg: yarnKg,
          // Sistemde "düşük stok" (asgari stok) tanımı yok — uydurulmaz.
          dusukStokKalem: null,
        }
      : null,
    fasonOzeti: outsideData
      ? {
          disaridakiMetre: round1(outsideData.total.totalQty),
          disaridakiTop: outsideData.total.rollCount,
          fasoncuSayisi: outsideData.bySubcontractor.filter((r) => r.subcontractorId !== null).length,
        }
      : null,
    emanet: can.emanet && s?.consigned
      ? {
          top: s.consigned.finishedCount + s.consigned.rawCount + s.consigned.semiCount,
          metre: round1(s.consigned.finishedQty + s.consigned.rawQty + s.consigned.semiQty),
        }
      : null,
  };
}

export async function getPanoSummary(donem: PanoDonem, user: PanoKullanici, now: Date = new Date()): Promise<PanoSummary> {
  const p = resolvePanoPencere(donem, now);
  const can = panoGates(await loadAccessContext(user));
  const d = await fetchSources(p, can, now);
  const prodSeries = seriesOf(d.prodBuckets);
  const shipSeries = seriesOf(d.shipBuckets);
  const yarnKg = d.yarn ? round1(Number(d.yarn.totals.balanceKg)) : null;
  const { notes, planned, prodItems, shipItems, aging } = d;

  return {
    donem,
    aralik: { from: p.aralik.from.toISOString(), to: p.aralik.to.toISOString() },
    oncekiAralik: { from: p.oncekiAralik.from.toISOString(), to: p.oncekiAralik.to.toISOString() },
    olusturuldu: now.toISOString(),
    kpi: kpiBox(can, d, yarnKg),
    egilim: {
      kova: p.kova,
      noktalar: p.anahtarlar.map((k) => ({
        anahtar: k,
        uretimMetre: prodSeries ? round1(prodSeries.get(k) ?? 0) : null,
        sevkMetre: shipSeries ? round1(shipSeries.get(k) ?? 0) : null,
      })),
    },
    dagilim: prodItems ? { boyut: "kumas", dilimler: distribution(prodItems) } : null,
    enCok: { uretilen: prodItems ? topItems(prodItems) : null, sevkEdilen: shipItems ? topItems(shipItems) : null },
    tezgah: tezgahBox(d.floor?.data),
    ...stockBoxes(can, d, yarnKg),
    bekleyen: {
      onayBekleyenBelge: notes ? { taslak: notes.DRAFT, kismi: notes.PARTIAL, toplam: notes.DRAFT + notes.PARTIAL } : null,
      sevkeHazir: planned ? { sevkiyat: planned.shipmentCount, metre: round1(planned.totalMeters) } : null,
      uretimeGonderilmemisSiparis: d.noWo,
    },
    finans: aging
      ? { alacaklar: aging.blocks.map((b) => ({ paraBirimi: b.currency, acikAlacak: Number(b.totals.openTotal), vadesiGecmis: Number(b.totals.overdueTotal) })) }
      : null,
  };
}
