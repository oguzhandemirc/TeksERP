// =============================================================================
// İPLİK İHTİYAÇ PLANI (MAL-7; plan MALIYET-TEKLIF-PLAN §4.5)
// =============================================================================
// "Açık siparişleri dokumak için hangi iplikten kaç kg lazım, ne kadarı stokta/yolda, eksik ne?"
// Talep `ProductionBalanceService` dengesinden (açık sipariş kalemi tek kaynakları orada), kg
// maliyet motorunun `yarnUsagePerM`inden; stok/açık alış/hazır levent YALNIZ köprüden okunur
// (`maliyet-bridge.helper`) — kapalı modülün değeri `null`dır ("bilinmiyor"), 0 DEĞİL.
// İç hesap `Prisma.Decimal`; yuvarlama yalnız çıktıda (kg 3 hane, dize). Para YOK.
// =============================================================================
import { OrderStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDateTimeTr } from "../../constants/time";
import { ProductionBalanceService, type BalanceGroup } from "../production-balance.service";
import { ACTIVE_LINE, MEASURED_LINE } from "../helpers/order-line-scope.helper";
import { buildCostInput, loadCostSourcesTx } from "../helpers/cost-assembler.helper";
import { fabricMetersFromWarpM, yarnUsagePerM, type CostInput } from "../helpers/fabric-cost.helper";
import { readOpenPurchase, readReadyBeams, readYarnStock } from "../helpers/maliyet-bridge.helper";

type Dec = Prisma.Decimal;
const D0 = (): Dec => new Prisma.Decimal(0);
const kg = (v: Dec): string => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);
const m1 = (v: Dec): string => v.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1);
const maxD = (a: Dec, b: Dec): Dec => (a.gt(b) ? a : b);
const minD = (a: Dec, b: Dec): Dec => (a.lt(b) ? a : b);

export interface YarnNeedOptions {
  /** true (varsayılan): talep − depo − üretimde (üretim dengesi); false: brüt kalan (istenen − sevk). */
  netle?: boolean;
  /** true (varsayılan): devere açıksa hazır leventlerin kalanı çözgü ihtiyacından düşülür. */
  leventDus?: boolean;
  musteriId?: string;
  urunId?: string;
}

export interface YarnNeedRow {
  iplikId: string;
  iplikKodu: string;
  iplik: string;
  cozguKg: string;
  atkiKg: string;
  ihtiyacKg: string;
  serbestStokKg: string | null;
  emanetKg: string | null;
  acikAlisKg: string | null;
  eksikKg: string;
  eksikBelirsiz: boolean;
}

export interface YarnNeedSummary {
  iplikSayisi: number;
  cozguKg: string;
  atkiKg: string;
  ihtiyacKg: string;
  eksikKg: string;
  /** Dokunacak kumaş metresi (yapısı tam ürünler; hazır levent düşümünden ÖNCE). */
  kumasMetre: string;
}

export interface YarnNeedReport {
  satirlar: YarnNeedRow[];
  ozet: YarnNeedSummary;
  meta: {
    netle: boolean;
    leventDus: boolean;
    yapisiEksik: Array<{ urunId: string; urunKodu: string; urun: string; kalemSayisi: number; metre: string; eksikler: string[] }>;
    olculemeyen: Array<{ urunId: string; urunKodu: string; urun: string; birim: string; kalemSayisi: number; miktar: string }>;
    leventler: Array<{ cozguKartiId: string; leventSayisi: number; kalanCozguM: string; dusulenKumasM: string }>;
    kaynaklar: { stok: boolean; emanet: boolean; acikAlis: boolean; leventDusumu: boolean };
    hesapZamani: string;
    /** Süzgeç seçenekleri: talebi olan müşteriler ve ürünler (süzme sunucuda). */
    secenekler: { musteriler: Array<{ id: string; ad: string }>; urunler: Array<{ id: string; ad: string }> };
  };
}

/** Açık sipariş durumu — üretim dengesiyle aynı küme (KG/ADET listesi için). */
const OPEN_ORDER = { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } };

interface ItemDemand { itemId: string; lineCount: number; meters: Dec }

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

interface YarnAcc { warp: Dec; weft: Dec }

export async function yarnNeedReport(opts: YarnNeedOptions = {}): Promise<YarnNeedReport> {
  const netle = opts.netle ?? true;
  const leventDus = opts.leventDus ?? true;
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
  const ready: Array<{ d: ItemDemand; code: string; input: CostInput; usage: ReturnType<typeof yarnUsagePerM> }> = [];
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
    ready.push({ d, code, input, usage });
  }
  ready.sort((a, b) => a.code.localeCompare(b.code, "tr"));

  // Hazır çözgü: aynı çözgü kartının kalan levent metresi, kartın ürünlerine kod sırasıyla dağıtılır.
  const warpSpecIds = [...new Set(ready.map((r) => r.input.warp?.warpSpecId).filter((x): x is string => !!x))].sort();
  const beams = leventDus ? await readReadyBeams(warpSpecIds) : null;
  const warpMeters = new Map<typeof ready[number], Dec>();
  const leventler: YarnNeedReport["meta"]["leventler"] = [];
  const pool = new Map<string, Dec>();
  if (beams) for (const [id, b] of beams) pool.set(id, b.remainingM);
  const covered = new Map<string, Dec>();
  for (const r of ready) {
    let need = r.d.meters;
    const specId = r.input.warp?.warpSpecId ?? null;
    const remW = specId ? pool.get(specId) : undefined;
    if (specId && remW && remW.gt(0) && need.gt(0)) {
      const fabricAvail = fabricMetersFromWarpM(r.input, remW);
      if (fabricAvail && fabricAvail.gt(0)) {
        const take = minD(need, fabricAvail);
        // Kullanılan çözgü metresi oranla (take-up formülü kopyalanmaz): remW × take / fabricAvail.
        pool.set(specId, remW.minus(remW.mul(take).div(fabricAvail)));
        covered.set(specId, (covered.get(specId) ?? D0()).plus(take));
        need = need.minus(take);
      }
    }
    warpMeters.set(r, need);
  }
  if (beams) {
    for (const id of warpSpecIds) {
      const b = beams.get(id);
      if (b) leventler.push({ cozguKartiId: id, leventSayisi: b.beamCount, kalanCozguM: m1(b.remainingM), dusulenKumasM: m1(covered.get(id) ?? D0()) });
    }
  }

  const perYarn = new Map<string, YarnAcc>();
  const add = (id: string | null, k: keyof YarnAcc, v: Dec) => {
    if (!id) return;
    const a = perYarn.get(id) ?? { warp: D0(), weft: D0() };
    a[k] = a[k].plus(v);
    perYarn.set(id, a);
  };
  let kumasMetre = D0();
  for (const r of ready) {
    kumasMetre = kumasMetre.plus(r.d.meters);
    add(r.usage.warp!.yarnItemId, "warp", r.usage.warp!.kgPerM.mul(warpMeters.get(r)!));
    for (const w of r.usage.weft) add(w.yarnItemId, "weft", w.kgPerM.mul(r.d.meters));
  }

  const yarnIds = [...perYarn.keys()].sort();
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
  const rows = yarnIds.map((id) => {
    const a = perYarn.get(id)!;
    const need = a.warp.plus(a.weft);
    const s = stock ? (stock.byItem.get(id) ?? { serbestKg: D0(), emanetKg: consignmentOn ? D0() : null }) : null;
    const p = purchase ? (purchase.get(id) ?? D0()) : null;
    const short = maxD(D0(), need.minus(s?.serbestKg ?? D0()).minus(p ?? D0()));
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
    },
    meta: {
      netle,
      leventDus,
      yapisiEksik: yapisiEksik.sort((a, b) => a.urunKodu.localeCompare(b.urunKodu, "tr")),
      olculemeyen,
      leventler,
      kaynaklar: { stok: stock !== null, emanet: consignmentOn, acikAlis: purchase !== null, leventDusumu: beams !== null },
      hesapZamani: factoryDateTimeTr(new Date()),
      secenekler: {
        musteriler: [...musteriler].map(([id, ad]) => ({ id, ad })).sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
        urunler: [...urunler].map(([id, ad]) => ({ id, ad })).sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
      },
    },
  };
}
