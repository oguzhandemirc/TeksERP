// =============================================================================
// AÇILIŞ PANOSU — ilk turun kutuları (KPI, eğilim, dağılım, en çok, tezgah, stok, fason, bekleyen, finans)
// =============================================================================
// Her kurucu yalnız kendi kaynağını ister (bellekli `PanoSources`); biçim eski `GET /pano` yanıtının
// alanıyla bayt-aynıdır — eski yanıt bu kurucuların birleşimidir (`pano.service.ts`).
// Alt parçası kapalı kutu o parçayı `null` döner, kaynağını çağırmaz.
// =============================================================================
import { round1 } from "../reports/_breakdown";
import { changePct } from "./pano-donem";
import { PANO_TOP_N, type FloorData, type ItemRow, type BucketRow, type PanoGates, type PanoSources } from "./pano-kaynak";

export interface PanoKpi { deger: number; onceki: number; degisimYuzde: number | null }
export interface PanoUrun { itemId: string; kod: string; ad: string; metre: number }

export interface BoxInput {
  src: PanoSources;
  can: PanoGates;
}

export const kpi = (deger: number, onceki: number): PanoKpi => ({ deger: round1(deger), onceki: round1(onceki), degisimYuzde: changePct(deger, onceki) });
const none = <T>(): Promise<T | null> => Promise.resolve(null);

function topItems(rows: readonly ItemRow[]): PanoUrun[] {
  return rows
    .filter((r): r is ItemRow & { itemId: string } => r.itemId !== null && Number(r.qty ?? 0) > 0)
    .slice(0, PANO_TOP_N)
    .map((r) => ({ itemId: r.itemId, kod: r.code ?? "", ad: r.name ?? "", metre: round1(Number(r.qty ?? 0)) }));
}

export interface PanoDilim { itemId: string | null; ad: string; metre: number; yuzde: number }

/** Halka: ilk 5 kumaş + "Diğer"; yüzde toplamın payı (bir ondalık). Boş dönemde boş dizi. */
function distribution(rows: readonly ItemRow[]): PanoDilim[] {
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

// ── KPI kutuları ─────────────────────────────────────────────────────────────

export async function productionKpiBox({ src }: BoxInput) {
  const [cur, prev] = await Promise.all([src.producedCur(), src.producedPrev()]);
  return { metre: kpi(cur.qty, prev.qty), top: kpi(cur.rolls, prev.rolls) };
}

export async function shipmentKpiBox({ src }: BoxInput) {
  const [cur, prev] = await Promise.all([src.shippedCur(), src.shippedPrev()]);
  return { metre: kpi(cur.qty, prev.qty), irsaliye: kpi(cur.docs, prev.docs) };
}

export async function orderKpiBox({ src }: BoxInput) {
  const s = (await src.intake()).summary;
  return { adet: kpi(s.orderCount, s.prevOrderCount ?? 0), metre: kpi(s.totalQty, s.prevTotalQty ?? 0) };
}

export async function subcontractKpiBox({ src }: BoxInput) {
  const s = (await src.subcontract()).summary;
  return { gidenMetre: kpi(s.dispatchedQty, s.prevDispatchedQty ?? 0), donenMetre: round1(s.returnedQty) };
}

async function yarnKg({ src, can }: BoxInput): Promise<number | null> {
  return can.iplik ? round1(Number((await src.yarn()).totals.balanceKg)) : null;
}

export async function stockKpiBox(input: BoxInput) {
  const [stock, kg] = await Promise.all([input.src.stock(), yarnKg(input)]);
  const s = stock.summary;
  return { mamulMetre: round1(s.finishedQty), hamMetre: round1(s.rawQty), iplikKg: kg };
}

// ── grafik ve liste kutuları ─────────────────────────────────────────────────

export async function trendBox({ src, can }: BoxInput) {
  const [prod, ship] = await Promise.all([can.uretim ? src.producedBuckets() : none<BucketRow[]>(), can.sevk ? src.shippedBuckets() : none<BucketRow[]>()]);
  const prodSeries = seriesOf(prod);
  const shipSeries = seriesOf(ship);
  return {
    kova: src.window.kova,
    noktalar: src.window.anahtarlar.map((k) => ({
      anahtar: k,
      uretimMetre: prodSeries ? round1(prodSeries.get(k) ?? 0) : null,
      sevkMetre: shipSeries ? round1(shipSeries.get(k) ?? 0) : null,
    })),
  };
}

export async function distributionBox({ src }: BoxInput) {
  return { boyut: "kumas" as const, dilimler: distribution(await src.producedItems()) };
}

export async function topItemsBox({ src, can }: BoxInput) {
  const [prod, ship] = await Promise.all([can.uretim ? src.producedItems() : none<ItemRow[]>(), can.sevk ? src.shippedItems() : none<ItemRow[]>()]);
  return { uretilen: prod ? topItems(prod) : null, sevkEdilen: ship ? topItems(ship) : null };
}

export async function loomBox({ src }: BoxInput) {
  const data: FloorData["data"] = (await src.floor()).data;
  return {
    toplam: data.summary.total,
    calisan: data.summary.running,
    duran: data.summary.stopped,
    izlenmeyen: data.summary.unmonitored,
    // Dokuma kapalıyken koşum bilgisi yok → işsiz tezgah ölçülemez (null, 0 değil).
    issiz: data.dokumaEnabled ? data.looms.filter((l) => (l.openRuns ?? []).length === 0).length : null,
    suAnYuzde: data.summary.nowPct,
  };
}

export async function stockSummaryBox(input: BoxInput) {
  const [stock, kg] = await Promise.all([input.src.stock(), yarnKg(input)]);
  const s = stock.summary;
  return {
    mamul: { top: s.finishedCount, metre: round1(s.finishedQty) },
    ham: { top: s.rawCount, metre: round1(s.rawQty) },
    yariMamul: { top: s.semiCount, metre: round1(s.semiQty) },
    iplikKg: kg,
    // Sistemde "düşük stok" (asgari stok) tanımı yok — uydurulmaz.
    dusukStokKalem: null,
  };
}

export async function outsideBox({ src }: BoxInput) {
  const data = (await src.outside()).data;
  return {
    disaridakiMetre: round1(data.total.totalQty),
    disaridakiTop: data.total.rollCount,
    fasoncuSayisi: data.bySubcontractor.filter((r) => r.subcontractorId !== null).length,
  };
}

export async function consignedBox({ src }: BoxInput) {
  const c = (await src.stock()).summary.consigned;
  if (!c) return null;
  return { top: c.finishedCount + c.rawCount + c.semiCount, metre: round1(c.finishedQty + c.rawQty + c.semiQty) };
}

export async function pendingBox({ src, can }: BoxInput) {
  const [notes, planned, noWo] = await Promise.all([
    can.gelenBelge ? src.notes() : none<Awaited<ReturnType<PanoSources["notes"]>>>(),
    can.sevkeHazir ? src.planned() : none<Awaited<ReturnType<PanoSources["planned"]>>>(),
    can.uretimeBekleyen ? src.noWorkOrder() : none<number>(),
  ]);
  return {
    onayBekleyenBelge: notes ? { taslak: notes.DRAFT, kismi: notes.PARTIAL, toplam: notes.DRAFT + notes.PARTIAL } : null,
    sevkeHazir: planned ? { sevkiyat: planned.shipmentCount, metre: round1(planned.totalMeters) } : null,
    uretimeGonderilmemisSiparis: noWo,
  };
}

export async function receivablesBox({ src }: BoxInput) {
  const aging = await src.aging();
  return { alacaklar: aging.blocks.map((b) => ({ paraBirimi: b.currency, acikAlacak: Number(b.totals.openTotal), vadesiGecmis: Number(b.totals.overdueTotal) })) };
}
