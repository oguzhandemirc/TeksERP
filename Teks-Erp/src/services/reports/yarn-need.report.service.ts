// =============================================================================
// İPLİK İHTİYAÇ PLANI (MAL-7; plan MALIYET-TEKLIF-PLAN §4.5)
// =============================================================================
// "Açık siparişleri dokumak için hangi iplikten kaç kg lazım, ne kadarı stokta/yolda, eksik ne?"
// Talep `ProductionBalanceService` dengesinden (açık sipariş kalemi tek kaynakları orada), kg
// maliyet motorunun `yarnUsagePerM`inden; talep MAMUL (sipariş) metresidir → HAM metreye `rawMetersFromFinished`
// (boy çekmesi: maliyet girdisinin aynı çözücüden gelen değeri + dokuma firesi ayarı) ile çevrilir; stok/açık alış/hazır levent YALNIZ köprüden okunur
// (`maliyet-bridge.helper`) — kapalı modülün değeri `null`dır ("bilinmiyor"), 0 DEĞİL.
// İç hesap `Prisma.Decimal`; yuvarlama yalnız çıktıda (kg 3 hane, dize). Para YOK.
// =============================================================================
import { OrderStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDateTimeTr } from "../../constants/time";
import { ProductionBalanceService, type BalanceGroup } from "../production-balance.service";
import { ACTIVE_LINE, MEASURED_LINE } from "../helpers/order-line-scope.helper";
import { buildCostInput, loadCostSourcesTx } from "../helpers/cost-assembler.helper";
import { fabricMetersFromWarpM, yarnUsagePerM, type CostInput, type CostWarpLayer } from "../helpers/fabric-cost.helper";
import { readOpenPurchase, readReadyBeams, readYarnReservation, readYarnStock } from "../helpers/maliyet-bridge.helper";
import { isSharedBeamLayer, layerHasOwnBeam } from "../helpers/warp-layer-beam.helper";
import { rawMetersFromFinished } from "../helpers/raw-need.helper";
import { resolveDokumaWeavingWastePct } from "../system-setting.service";
import type { YarnWasteSource } from "../helpers/yarn-waste.helper";
import type { YarnNeedOptions, YarnNeedReport, YarnNeedRow } from "./yarn-need.types";
export type { YarnNeedOptions, YarnNeedReport, YarnNeedRow, YarnNeedSummary } from "./yarn-need.types";

type Dec = Prisma.Decimal;
const D0 = (): Dec => new Prisma.Decimal(0);
const kg = (v: Dec): string => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);
const m1 = (v: Dec): string => v.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1);
const maxD = (a: Dec, b: Dec): Dec => (a.gt(b) ? a : b);
const minD = (a: Dec, b: Dec): Dec => (a.lt(b) ? a : b);

/** Açık sipariş durumu — üretim dengesiyle aynı küme (KG/ADET listesi için). */
const OPEN_ORDER = { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } };

export interface ItemDemand { itemId: string; lineCount: number; meters: Dec }
export type ReadyItem = { d: ItemDemand; code: string; input: CostInput; usage: ReturnType<typeof yarnUsagePerM>; rawM: Dec };

/**
 * Ürün başına dokunacak metre. Netlemede (ürün, renk) grubunun kumaş açığı (`malzemeAcigi` = talep −
 * depo − üretimde − ham/yarı mamul) esas alınır: dokunmuş kumaş iplik istemez. Müşteri süzgecinde
 * grubun açığı müşterinin brüt kalanını aşamaz (depo/üretim önce diğer siparişlere gider varsayımı).
 */
export function demandFromBalance(groups: readonly BalanceGroup[], o: { netle: boolean; musteriId?: string }): Map<string, ItemDemand> {
  const out = new Map<string, ItemDemand>();
  for (const g of groups) {
    const lines = g.specs.flatMap((s) => s.lines).filter((l) => !o.musteriId || l.customerId === o.musteriId);
    if (lines.length === 0) continue;
    const gross = lines.reduce((a, l) => a.plus(maxD(l.remaining, D0())), D0());
    const meters = !o.netle ? gross : o.musteriId ? minD(gross, g.malzemeAcigi) : g.malzemeAcigi;
    const acc = out.get(g.itemId) ?? { itemId: g.itemId, lineCount: 0, meters: D0() };
    acc.lineCount += lines.length;
    acc.meters = acc.meters.plus(meters);
    out.set(g.itemId, acc);
  }
  return out;
}

async function unmeasuredLines(o: YarnNeedOptions): Promise<YarnNeedReport["meta"]["olculemeyen"]> {
  const rows = await prisma.orderLine.findMany({
    where: {
      order: { ...OPEN_ORDER, ...(o.musteriId ? { customerId: o.musteriId } : {}) },
      ...ACTIVE_LINE,
      // KG/ADET kalem metreye çevrilmez — ayrı listede, kg'a katılmaz.
      NOT: { ...MEASURED_LINE },
      ...(o.urunId ? { itemId: o.urunId } : {}),
    },
    select: { itemId: true, unit: true, quantity: true, item: { select: { code: true, name: true } } },
  });
  const acc = new Map<string, { urunId: string; urunKodu: string; urun: string; birim: string; kalemSayisi: number; miktar: Dec }>();
  for (const r of rows) {
    const key = `${r.itemId}|${r.unit}`;
    const a = acc.get(key) ?? { urunId: r.itemId, urunKodu: r.item.code, urun: r.item.name, birim: r.unit, kalemSayisi: 0, miktar: D0() };
    a.kalemSayisi += 1;
    a.miktar = a.miktar.plus(r.quantity);
    acc.set(key, a);
  }
  return [...acc.values()]
    .sort((a, b) => a.urunKodu.localeCompare(b.urunKodu, "tr") || a.birim.localeCompare(b.birim))
    .map((a) => ({ ...a, miktar: a.miktar.toFixed(3) }));
}

interface YarnAcc { warp: Dec; weft: Dec; wasteSource: YarnWasteSource }

/** Hazır levent düşümüne giren çözgü kartları (zemin + kendi leventi olan katmanlar), sıralı. */
export function readyWarpSpecIds(ready: readonly ReadyItem[]): string[] {
  return [...new Set(ready.flatMap((r) => [r.input.warp?.warpSpecId, ...ownBeamLayers(r).map((l) => l.warpSpecId)]).filter((x): x is string => !!x))].sort();
}

const ownBeamLayers = (r: ReadyItem) => (r.input.warpLayers ?? []).filter((l) => layerHasOwnBeam(l.beamMode) && l.warpSpecId);

/**
 * ÇEKİRDEK: ürünlerin ham metresi → iplik başına çözgü/atkı kg (hazır levent düşümüyle). Rapor ve üretim önerisinin
 * iplik özeti AYNI fonksiyonu çağırır. `beams` null → düşüm yok. Havuz çağrı başına tazedir (sıra: verilen sıra).
 */
export function yarnKgByYarn(ready: readonly ReadyItem[], beams: Map<string, { remainingM: Dec }> | null): { perYarn: Map<string, YarnAcc>; covered: Map<string, Dec>; poolAfter: Map<string, Dec> } {
  // Hazır çözgü: aynı çözgü kartının kalan levent metresi, kartın ürünlerine kod sırasıyla dağıtılır.
  // SY-N2: SEPARATE_BEAM katmanının kendi leventi de AYNI düşümle (katman başına) — SHARED zemini izler, CREEL düşülmez.
  const warpMeters = new Map<ReadyItem, Dec>();
  const layerMeters = new Map<string, Dec>();
  const pool = new Map<string, Dec>();
  if (beams) for (const [id, b] of beams) pool.set(id, b.remainingM);
  const covered = new Map<string, Dec>();
  const deductReadyBeam = (r: ReadyItem, specId: string | null, layer?: CostWarpLayer): Dec => {
    let need = r.rawM;
    const remW = specId ? pool.get(specId) : undefined;
    if (specId && remW && remW.gt(0) && need.gt(0)) {
      const fabricAvail = fabricMetersFromWarpM(r.input, remW, layer);
      if (fabricAvail && fabricAvail.gt(0)) {
        const take = minD(need, fabricAvail);
        // Kullanılan çözgü metresi oranla (take-up formülü kopyalanmaz): remW × take / fabricAvail.
        pool.set(specId, remW.minus(remW.mul(take).div(fabricAvail)));
        covered.set(specId, (covered.get(specId) ?? D0()).plus(take));
        need = need.minus(take);
      }
    }
    return need;
  };
  for (const r of ready) {
    warpMeters.set(r, deductReadyBeam(r, r.input.warp?.warpSpecId ?? null));
    for (const l of ownBeamLayers(r)) layerMeters.set(`${r.d.itemId}|${l.warpSpecId}`, deductReadyBeam(r, l.warpSpecId, l));
  }
  const perYarn = new Map<string, YarnAcc>();
  const add = (id: string | null, k: "warp" | "weft", v: Dec, src: YarnWasteSource) => {
    if (!id) return;
    const a = perYarn.get(id) ?? { warp: D0(), weft: D0(), wasteSource: src };
    a[k] = a[k].plus(v);
    if (src === "IPLIK") a.wasteSource = "IPLIK";
    perYarn.set(id, a);
  };
  for (const r of ready) {
    add(r.usage.warp!.yarnItemId, "warp", r.usage.warp!.kgPerM.mul(warpMeters.get(r)!), r.usage.warp!.wasteSource);
    // SY-B1/N2: SHARED_BEAM zemin leventinde (aynı düşüm); SEPARATE kendi leventinin düşümüyle; CREEL tam talep (stoktan).
    for (const l of r.usage.warpLayers) {
      const own = layerMeters.get(`${r.d.itemId}|${l.warpSpecId}`);
      add(l.yarnItemId, "warp", l.kgPerM.mul(isSharedBeamLayer(l.beamMode) ? warpMeters.get(r)! : (own ?? r.rawM)), l.wasteSource);
    }
    for (const w of r.usage.weft) add(w.yarnItemId, "weft", w.kgPerM.mul(r.rawM), w.wasteSource);
  }
  // `poolAfter` (SY-3 I1): düşümden sonra kalan levent metresi — iplik ayırması önce işlere, kalanı talebe verir.
  return { perYarn, covered, poolAfter: pool };
}

/** Eksik = ihtiyaç − serbest stok − açık alış, sıfırın altına inmez; bilinmeyen kaynak (null) düşülmez. */
export function yarnShortKg(need: Dec, freeStockKg: Dec | null, openPurchaseKg: Dec | null): Dec {
  return maxD(D0(), need.minus(freeStockKg ?? D0()).minus(openPurchaseKg ?? D0()));
}

export async function yarnNeedReport(opts: YarnNeedOptions = {}): Promise<YarnNeedReport> {
  const netle = opts.netle ?? true;
  const leventDus = opts.leventDus ?? true;
  // SY-3 I1: kapalıyken null ve sorgu yok → aşağıdaki her dal bugünküyle aynı.
  const reservation = await readYarnReservation({ leventDus });
  const talepNetlendi = reservation !== null && !opts.musteriId;
  let netlenenKumasM = D0();
  const balance = await new ProductionBalanceService().getBalance({ itemId: opts.urunId });
  const groups = balance.data ?? [];
  const demand = demandFromBalance(groups, { netle, musteriId: opts.musteriId });
  const olculemeyen = await unmeasuredLines(opts);

  const musteriler = new Map<string, string>();
  const urunler = new Map<string, string>();
  for (const g of groups) {
    urunler.set(g.itemId, g.itemName);
    for (const l of g.specs.flatMap((s) => s.lines)) musteriler.set(l.customerId, l.customerName);
  }

  // Yapı: tek seferde yükle (kalem başı sorgu yok); fiyat/kur eksikliği burada önemsiz.
  const itemIds = [...demand.keys()].sort();
  const src = await loadCostSourcesTx(prisma as unknown as Prisma.TransactionClient, itemIds);
  const yapisiEksik: YarnNeedReport["meta"]["yapisiEksik"] = [];
  const ready: ReadyItem[] = [];
  const wastePct = await resolveDokumaWeavingWastePct();
  for (const id of itemIds) {
    const d = demand.get(id)!;
    const item = src.items.get(id);
    const code = item?.code ?? "";
    const name = item?.name ?? "";
    if (!item || item.itemType !== "FABRIC") {
      yapisiEksik.push({ urunId: id, urunKodu: code, urun: name, kalemSayisi: d.lineCount, metre: m1(d.meters), eksikler: ["NOT_FABRIC"] });
      continue;
    }
    const input = buildCostInput(src, { itemId: id });
    const usage = yarnUsagePerM(input);
    if (usage.missing.length > 0 || !usage.warp) {
      yapisiEksik.push({ urunId: id, urunKodu: code, urun: name, kalemSayisi: d.lineCount, metre: m1(d.meters), eksikler: usage.missing });
      continue;
    }
    // Ham metre: çekme maliyet girdisindeki tek-çözücü değeri (YAPI → tarife), fire etkin ayar.
    let rawM = rawMetersFromFinished(d.meters, input.lengthShrinkPct.value, wastePct) ?? d.meters;
    const open = talepNetlendi ? reservation.openRawMByItem.get(id) : undefined;
    if (open) {
      const cut = minD(rawM, open);
      netlenenKumasM = netlenenKumasM.plus(cut);
      rawM = rawM.minus(cut);
    }
    ready.push({ d, code, input, usage, rawM });
  }
  ready.sort((a, b) => a.code.localeCompare(b.code, "tr"));

  const warpSpecIds = readyWarpSpecIds(ready);
  const beams = leventDus ? await readReadyBeams(warpSpecIds) : null;
  // SY-3 I1: hazır levent önce açık işlere gitti; talep kalan havuzu görür (meta.leventler fiziki kalanı gösterir).
  const demandBeams = beams && reservation?.beamsAfter
    ? new Map([...beams].map(([id, b]) => [id, reservation.beamsAfter!.get(id) ?? b]))
    : beams;
  const { perYarn, covered } = yarnKgByYarn(ready, demandBeams);
  const leventler: YarnNeedReport["meta"]["leventler"] = [];
  if (beams) {
    for (const id of warpSpecIds) {
      const b = beams.get(id);
      if (b) leventler.push({ cozguKartiId: id, leventSayisi: b.beamCount, kalanCozguM: m1(b.remainingM), dusulenKumasM: m1(covered.get(id) ?? D0()) });
    }
  }
  let kumasMetre = D0();
  let siparisMetre = D0();
  for (const r of ready) {
    kumasMetre = kumasMetre.plus(r.rawM);
    siparisMetre = siparisMetre.plus(r.d.meters);
  }

  // SY-3 I1: süzgeçsiz görünümde yalnız ayrılan iplikler de satırdır (stoğu işlere bağlı iplik görünmeli).
  const filtered = !!(opts.musteriId || opts.urunId);
  const yarnIds = [...new Set([...perYarn.keys(), ...(reservation && !filtered ? reservation.reservedKg.keys() : [])])].sort();
  const [stock, purchase, names] = await Promise.all([
    readYarnStock(yarnIds),
    readOpenPurchase(yarnIds),
    yarnIds.length ? prisma.item.findMany({ where: { id: { in: yarnIds } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n]));
  const consignmentOn = stock?.emanetAcik ?? false;

  let tWarp = D0();
  let tWeft = D0();
  let tShort = D0();
  let tReserved = D0();
  const rows = yarnIds.map((id) => {
    const r = reservation?.reservedKg.get(id);
    const a = perYarn.get(id) ?? { warp: D0(), weft: D0(), wasteSource: r?.wasteSource ?? "KART" };
    const need = a.warp.plus(a.weft);
    const s = stock ? (stock.byItem.get(id) ?? { serbestKg: D0(), emanetKg: consignmentOn ? D0() : null }) : null;
    const p = purchase ? (purchase.get(id) ?? D0()) : null;
    const reservedKg = r?.kg ?? D0();
    const free = s ? s.serbestKg.minus(reservedKg) : null;
    const short = yarnShortKg(need, reservation ? free : (s?.serbestKg ?? null), p);
    tReserved = tReserved.plus(reservedKg);
    tWarp = tWarp.plus(a.warp);
    tWeft = tWeft.plus(a.weft);
    tShort = tShort.plus(short);
    const n = nameOf.get(id);
    return {
      short,
      row: {
        iplikId: id,
        iplikKodu: n?.code ?? "",
        iplik: n?.name ?? "",
        cozguKg: kg(a.warp),
        atkiKg: kg(a.weft),
        ihtiyacKg: kg(need),
        serbestStokKg: s ? kg(s.serbestKg) : null,
        emanetKg: s?.emanetKg ? kg(s.emanetKg) : null,
        acikAlisKg: p ? kg(p) : null,
        eksikKg: kg(short),
        eksikBelirsiz: stock === null,
        fireKaynagi: r?.wasteSource === "IPLIK" ? "IPLIK" : a.wasteSource,
        ...(reservation ? { ayrilanKg: kg(reservedKg), serbestKg: free ? kg(free) : null } : {}),
      } satisfies YarnNeedRow,
    };
  });
  rows.sort((x, y) => y.short.comparedTo(x.short) || x.row.iplikKodu.localeCompare(y.row.iplikKodu, "tr"));

  return {
    satirlar: rows.map((r) => r.row),
    ozet: {
      iplikSayisi: rows.length,
      cozguKg: kg(tWarp),
      atkiKg: kg(tWeft),
      ihtiyacKg: kg(tWarp.plus(tWeft)),
      eksikKg: kg(tShort),
      kumasMetre: m1(kumasMetre),
      siparisMetre: m1(siparisMetre),
      ...(reservation ? { ayrilanKg: kg(tReserved) } : {}),
    },
    meta: {
      netle,
      leventDus,
      metreEsasi: "HAM",
      dokumaFiresiPct: wastePct,
      yapisiEksik: yapisiEksik.sort((a, b) => a.urunKodu.localeCompare(b.urunKodu, "tr")),
      olculemeyen,
      leventler,
      kaynaklar: { stok: stock !== null, emanet: consignmentOn, acikAlis: purchase !== null, leventDusumu: beams !== null },
      hesapZamani: factoryDateTimeTr(new Date()),
      secenekler: {
        musteriler: [...musteriler].map(([id, ad]) => ({ id, ad })).sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
        urunler: [...urunler].map(([id, ad]) => ({ id, ad })).sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
      },
      ...(reservation ? {
        ayirma: {
          isSayisi: reservation.orderCount,
          yapisiEksikIsler: reservation.unmeasured.map((u) => ({ isId: u.weavingOrderId, isNo: u.weavingOrderNumber, eksikler: u.missing })),
          talepNetlendi,
          netlenenKumasM: m1(netlenenKumasM),
        },
      } : {}),
    },
  };
}
