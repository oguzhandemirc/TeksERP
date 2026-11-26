// =============================================================================
// KÂRLILIK — KUMAŞ SATIŞI SATIRLARI (K1 dilim 1 + 3; PLAN-karlilik-dokuma-1126 §2)
// =============================================================================
// Satır = fatura × ürün kartı × dokuma işi. Hizmet satırlarından (`profitability.helper` `rows`) AYRI evrendir;
// havuz (işçilik/genel gider) ALMAZ (K1.4) — "katkı" = gelir − doğrudan maliyet. Sonuç saklanmaz.
//   Gelir: ÜRÜN satırı net tutarı × belge kuru; fatura satırı ↔ top bağı yok (K1.2) → sevkin o ürüne ait SATILAN
//   toplarına (brüt küme `collectShipmentGrossRolls`, emanet hariç) metre payıyla, son top kalanı alır.
//   Köken: top → dokuma işi (tambur atası, boya/apre makbuzunun ham topu) `weavingOriginsOfRolls`ten; boyahaneden
//   dönen top ham metresine çevrilir (makbuz düzeyinde Σ giren ÷ Σ doğan).
//   Maliyet (K1.1): iş emrinin bugüne kadarki gerçekleşeni — "Dokuma maliyeti" / iş emri Gerçekleşen tablosunun TEK
//   kaynağı (`weavingActualCostTx`, köprü `loadWeavingActualCosts`) TL/m × ham metre: tezgâh, devere, çözgü ve atkı
//   ipliği. Boya/apre: hizmet satırıyla aynı makbuz payı kuralı (`subcontractShareResolver`). Ücret çarpımı burada YOK.
//   Bilinmeyen parça `null` + kod; herhangi bir kod varsa katkı `null` (0 yazılmaz).
// =============================================================================
import { InvoiceStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ProfitMachineTimeMode, ProfitSubcontractSource } from "../system-setting.service";
import type { ProductRevenueInvoiceRow } from "./profitability-finance.helper";
import { subcontractShareResolver, type CostContext, type ProfitMissingCode } from "./profitability-cost.helper";
import { loadWeavingActualCosts } from "./maliyet-bridge.helper";
import { collectShipmentGrossRolls, type ShipmentGrossRoll } from "./shipment-sold-rolls.helper";
import { isConsignedRoll } from "./stock-ownership.helper";
import { WEAVING_INFO_CODES, type WeavingActualCost, type WeavingActualMissing } from "./weaving-actual-cost.helper";
import { weavingOriginsOfRolls, type RollOriginTrace } from "./weaving-order-of-roll.helper";

type Dec = Prisma.Decimal;
const D0 = () => new Prisma.Decimal(0);
const D1 = () => new Prisma.Decimal(1);

/**
 * Dokuma işinin tezgâh/devere/iplik kodları (`WeavingActualMissing`) + kumaş satışına özgü kodlar: `IPLIK_MALIYETI` iplik
 * payı ölçülemedi (ayrı kod yok) · `DOKUMA_ISI_YOK` top hiçbir dokuma işine çözülmüyor (al-sat, stok devri) ·
 * `SEVK_BAGI_YOK` faturanın sevki ya da sevkte o ürünün satılan topu yok · `HAM_METRE` boyahane dönüşünün ham metresi
 * çevrilemedi (doğan toplar ölçülmemiş) · `DIS_FASON_*` boya/apre makbuzunun bedeli (fatura/tarife) okunamadı.
 */
export type ProductMissingCode =
  | WeavingActualMissing | "IPLIK_MALIYETI" | "DOKUMA_ISI_YOK" | "SEVK_BAGI_YOK" | "HAM_METRE"
  | Extract<ProfitMissingCode, "DIS_FASON_FATURASI" | "DIS_FASON_TARIFESI">;
/**
 * Tablo düzeyi bilgi: genel gider dağıtılmadı (K1.4) · iade edilen top brütte kaldı, iade faturası dilim 4'te (K1.5) ·
 * devere modülü kapalı, çözgü ipliği okunmuyor (iş emri Gerçekleşen tablosunda da satır yok).
 */
export type ProductNotice = "GENEL_GIDER_DAGITILMADI" | "IADE_DUSULMEDI" | "COZGU_IPLIGI_OKUNMADI";

export interface ProductProfitRow {
  month: string;
  kind: "INVOICED" | "CANCELLED" | "DRAFT";
  invoiceId: string;
  docNo: string;
  customerId: string | null;
  itemId: string;
  /** Topların çözüldüğü dokuma işi; çözülmeyen kova null (`DOKUMA_ISI_YOK` / `SEVK_BAGI_YOK`). */
  weavingOrderId: string | null;
  /** İş bitmedi ya da açık koşum var: maliyet bugünkü bilgiyle, yarın değişebilir. */
  ongoing: boolean;
  rollCount: number;
  /** Brütte kalan, sonradan iade edilmiş top sayısı (iade düşülmedi). */
  returnedRollCount: number;
  /** Satılan (sevk anındaki) metre. */
  meters: Dec;
  /** Dokuma maliyetinin metresi: boyahane dönüşünde ham karşılık, aksi hâlde satılan metre; çevrilemezse null. */
  hamMeters: Dec | null;
  revenueTry: Dec;
  weavingTry: Dec | null;
  /** Devere payı; devere modülü kapalıysa null ve kodsuz (kalem yok). */
  warpingTry: Dec | null;
  warpingEstimated: boolean;
  /** Çözgü + atkı ipliği; müşteri ipliği maliyete girmez (0 pay, `customerYarn`), eksik değildir. */
  yarnTry: Dec | null;
  /** İplik payının bir kısmı maliyet kartı fiyatından (lot fiyatı yok). */
  yarnEstimated: boolean;
  /** İpliğin bir kısmı ya da tamamı müşteri malı (bilgi). */
  customerYarn: boolean;
  /** Boya/apre fasonu: zincirde makbuz yoksa 0; fatura payı ya da (ayara göre) tarife tahmini; okunamazsa null + kod. */
  subcontractTry: Dec | null;
  subcontractEstimated: boolean;
  /** Gelir − dokuma − devere − iplik − dış fason; herhangi bir kod varsa ya da taslakta `null`. */
  contributionTry: Dec | null;
  missing: ProductMissingCode[];
}

export interface ProductProfitability {
  rows: ProductProfitRow[];
  draftRows: ProductProfitRow[];
  notices: ProductNotice[];
}

type SubcontractShare = { subcontractTry: Dec | null; estimated: boolean; missing: ProductMissingCode[] };
type Bucket = {
  weavingOrderId: string | null; rollCount: number; returnedRollCount: number; meters: Dec; hamMeters: Dec | null; revenueTry: Dec;
  subcontractTry: Dec | null; subcontractEstimated: boolean; subMissing: Set<ProductMissingCode>; noShipment: boolean;
};
const NO_ORIGIN: RollOriginTrace = { origins: [{ weavingOrderId: null, share: D1(), hamPerM: D1() }], passes: [] };

/** Toplam tutarı metre payıyla böler; son pay kalanı alır (Σ pay = toplam, kuruşu kuruşuna). Metresiz kümede eşit pay. */
export function shareByMeters(totalTry: Dec, meters: Dec[]): Dec[] {
  const sum = meters.reduce((a, m) => a.plus(m), D0());
  const out: Dec[] = [];
  let used = D0();
  meters.forEach((m, i) => {
    if (i + 1 === meters.length) { out.push(totalTry.minus(used)); return; }
    const share = sum.gt(0) ? totalTry.mul(m).div(sum) : totalTry.div(meters.length);
    used = used.plus(share);
    out.push(share);
  });
  return out;
}

/** Satılan topun boya/apre bedeli: zincirdeki her makbuzun payı (satılan metreye düşen makbuz çıkışı); makbuz yoksa 0. */
async function rollSubcontracts(sold: ShipmentGrossRoll[], traces: Map<string, RollOriginTrace>, ctx: Pick<CostContext, "subcontractSource" | "finance">): Promise<Map<string, SubcontractShare>> {
  const receiptIds = [...new Set([...traces.values()].flatMap((t) => t.passes.map((p) => p.receiptId)))].sort();
  const shareOf = subcontractShareResolver(ctx, await ctx.finance.readSubcontractInvoiceTotals(receiptIds));
  const out = new Map<string, SubcontractShare>();
  for (const r of sold) {
    const key = `${r.id}|${r.currentQty.toString()}`;
    if (out.has(key)) continue;
    let total: Dec | null = D0();
    let estimated = false;
    const missing = new Set<ProductMissingCode>();
    for (const p of (traces.get(r.id) ?? NO_ORIGIN).passes) {
      if (!p.perM) { total = null; missing.add("HAM_METRE"); continue; }
      const s = await shareOf({ id: p.receiptId, subcontractorId: p.subcontractorId, receivedAt: p.receivedAt, meters: p.outputM }, p.perM.mul(r.currentQty));
      estimated = estimated || s.estimated;
      s.missing.forEach((m) => missing.add(m as ProductMissingCode));
      total = total && s.subcontractTry ? total.plus(s.subcontractTry) : null;
    }
    out.set(key, { subcontractTry: total, estimated, missing: [...missing] });
  }
  return out;
}

/** Faturanın ürün × dokuma işi kovaları: satılan topun gelir payı ve metresi köken payıyla işlere bölünür. */
type RollsOf = (shipmentId: string, itemId: string) => ShipmentGrossRoll[];
function bucketsOf(inv: ProductRevenueInvoiceRow, { soldOf, consignedOf }: { soldOf: RollsOf; consignedOf: RollsOf }, traces: Map<string, RollOriginTrace>, subs: Map<string, SubcontractShare>): Array<{ itemId: string; bucket: Bucket }> {
  const out: Array<{ itemId: string; bucket: Bucket }> = [];
  for (const itemId of [...inv.lineTotalByItem.keys()].sort()) {
    const revenueTry = inv.lineTotalByItem.get(itemId)!.mul(inv.exchangeRate);
    const rolls = inv.shipmentId ? soldOf(inv.shipmentId, itemId) : [];
    const consigned = inv.shipmentId ? consignedOf(inv.shipmentId, itemId) : [];
    // Yalnız emanet taşıyan satır kumaş evrenine girmez (müşterinin malı satılmaz).
    if (rolls.length === 0 && consigned.length > 0) continue;
    if (rolls.length === 0) {
      out.push({ itemId, bucket: { weavingOrderId: null, rollCount: 0, returnedRollCount: 0, meters: D0(), hamMeters: null, revenueTry, subcontractTry: null, subcontractEstimated: false, subMissing: new Set(), noShipment: true } });
      continue;
    }
    // Satır miktarı kendi metremizi aşıyorsa emanet metresi de satıra yazılmış (hizmet faturası kapalı taslak): emanet payı düşer.
    const ownM = rolls.reduce((a, r) => a.plus(r.currentQty), D0());
    const pool = consigned.length > 0 && (inv.qtyByItem.get(itemId) ?? D0()).gt(ownM) ? [...rolls, ...consigned] : rolls;
    const shares = shareByMeters(revenueTry, pool.map((r) => r.currentQty));
    const byKey = new Map<string, Bucket>();
    rolls.forEach((r, i) => {
      const origins = (traces.get(r.id) ?? NO_ORIGIN).origins;
      const sub = subs.get(`${r.id}|${r.currentQty.toString()}`) ?? { subcontractTry: D0(), estimated: false, missing: [] };
      const revenueParts = shareByMeters(shares[i]!, origins.map((o) => o.share));
      origins.forEach((o, j) => {
        const key = o.weavingOrderId ?? "-";
        const b = byKey.get(key) ?? { weavingOrderId: o.weavingOrderId, rollCount: 0, returnedRollCount: 0, meters: D0(), hamMeters: D0(), revenueTry: D0(), subcontractTry: D0(), subcontractEstimated: false, subMissing: new Set<ProductMissingCode>(), noShipment: false };
        const meters = r.currentQty.mul(o.share);
        b.rollCount++;
        if (r.returned) b.returnedRollCount++;
        b.meters = b.meters.plus(meters);
        b.hamMeters = b.hamMeters && o.hamPerM ? b.hamMeters.plus(meters.mul(o.hamPerM)) : null;
        b.revenueTry = b.revenueTry.plus(revenueParts[j]!);
        b.subcontractTry = b.subcontractTry && sub.subcontractTry ? b.subcontractTry.plus(sub.subcontractTry.mul(o.share)) : null;
        b.subcontractEstimated = b.subcontractEstimated || sub.estimated;
        sub.missing.forEach((m) => b.subMissing.add(m));
        byKey.set(key, b);
      });
    });
    for (const key of [...byKey.keys()].sort()) out.push({ itemId, bucket: byKey.get(key)! });
  }
  return out;
}

type YarnPart = { perMTry: Dec | null; missing: WeavingActualMissing[] | null; source: string | null };

/**
 * Çözgü + atkı ipliği TL/m — iş emri Gerçekleşen tablosunun iki satırı. Alan yoksa (devere kapalı → çözgü) okunmaz;
 * müşteri ipliği (sayı yok + yalnız bilgi kodu) 0 pay ve bilgidir; başka her boşluk eksik.
 */
function yarnOf(parts: YarnPart[], hamMeters: Dec) {
  let yarnTry: Dec | null = D0();
  let estimated = false;
  let customer = false;
  const missing: ProductMissingCode[] = [];
  for (const p of parts) {
    if (p.missing === null) continue;
    const own = p.missing.includes("MUSTERI_IPLIGI");
    customer = customer || own;
    if (p.perMTry) {
      yarnTry = yarnTry ? yarnTry.plus(p.perMTry.mul(hamMeters)) : null;
      estimated = estimated || p.source === "MALIYET_FIYATI" || p.source === "KARMA";
      continue;
    }
    const gaps = p.missing.filter((m) => !WEAVING_INFO_CODES.includes(m));
    if (gaps.length === 0 && own) continue;
    yarnTry = null;
    missing.push(...(gaps.length > 0 ? gaps : (["IPLIK_MALIYETI"] as ProductMissingCode[])));
  }
  return { yarnTry, estimated, customer, missing };
}

/** Kovanın doğrudan maliyet parçaları ve eksik kodları (işaretsiz; iptal satırında çağıran eksiler). */
function costsOf(b: Bucket, cost: WeavingActualCost | undefined) {
  const subcontract = { subcontractTry: b.subcontractTry, subcontractEstimated: b.subcontractEstimated };
  const empty = { weavingTry: null, warpingTry: null, warpingEstimated: false, yarnTry: null, yarnEstimated: false, customerYarn: false, ongoing: false };
  if (b.noShipment) return { ...empty, subcontractTry: null, subcontractEstimated: false, missing: ["SEVK_BAGI_YOK"] as ProductMissingCode[] };
  const missing: ProductMissingCode[] = [...b.subMissing];
  if (!b.weavingOrderId || !cost) return { ...empty, ...subcontract, missing: [...new Set<ProductMissingCode>(["DOKUMA_ISI_YOK", ...missing])] };
  if (!b.hamMeters) return { ...empty, ...subcontract, ongoing: cost.ongoing, missing: [...new Set<ProductMissingCode>(["HAM_METRE", ...missing])] };
  const ham = b.hamMeters;
  // Standart sürüm boşluğu gerçek maliyeti etkilemez; bilgi kodları "eksik" saymaz.
  const gaps = cost.missing.filter((m) => m !== "STANDART_YOK" && !WEAVING_INFO_CODES.includes(m));
  const weavingTry = cost.actualPerMTry ? cost.actualPerMTry.mul(ham) : null;
  missing.push(...gaps);
  if (!weavingTry && gaps.length === 0) missing.push("TOP_YOK");
  let warpingTry: Dec | null = null;
  if (cost.warpingMissing !== null) {
    if (cost.warpingPerMTry) warpingTry = cost.warpingPerMTry.mul(ham);
    else missing.push(...(cost.warpingMissing.length > 0 ? cost.warpingMissing : (["COZGU_TUKETIMI"] as WeavingActualMissing[])));
  }
  const yarn = yarnOf([
    { perMTry: cost.warpYarnPerMTry, missing: cost.warpYarnMissing, source: cost.warpYarnSource },
    { perMTry: cost.weftYarnPerMTry, missing: cost.weftYarnMissing, source: cost.weftYarnSource },
  ], ham);
  missing.push(...yarn.missing);
  return {
    weavingTry, warpingTry, warpingEstimated: warpingTry !== null && cost.warpingSource !== null && cost.warpingSource !== "FATURA",
    yarnTry: yarn.yarnTry, yarnEstimated: yarn.estimated, customerYarn: yarn.customer, ...subcontract, ongoing: cost.ongoing, missing: [...new Set(missing)],
  };
}

type Costs = ReturnType<typeof costsOf>;

type Emit = { kind: ProductProfitRow["kind"]; month: string; sign: 1 | -1 };
function rowOf(inv: ProductRevenueInvoiceRow, p: { itemId: string; bucket: Bucket; c: Costs }, { kind, month, sign }: Emit): ProductProfitRow {
  const { itemId, bucket: b, c } = p;
  const neg = (d: Dec | null) => (d === null ? null : sign === 1 ? d : d.neg());
  const known = kind !== "DRAFT" && c.missing.length === 0 && c.weavingTry && c.yarnTry && c.subcontractTry;
  const contribution = known ? b.revenueTry.minus(c.weavingTry!).minus(c.warpingTry ?? D0()).minus(c.yarnTry!).minus(c.subcontractTry!) : null;
  return {
    month, kind, invoiceId: inv.id, docNo: inv.docNo, customerId: inv.cariCustomerId, itemId, weavingOrderId: b.weavingOrderId,
    ongoing: c.ongoing, rollCount: b.rollCount, returnedRollCount: b.returnedRollCount, meters: neg(b.meters)!, hamMeters: neg(b.hamMeters), revenueTry: neg(b.revenueTry)!,
    weavingTry: neg(c.weavingTry), warpingTry: neg(c.warpingTry), warpingEstimated: c.warpingEstimated, yarnTry: neg(c.yarnTry),
    yarnEstimated: c.yarnEstimated, customerYarn: c.customerYarn, subcontractTry: neg(c.subcontractTry), subcontractEstimated: c.subcontractEstimated,
    contributionTry: neg(contribution), missing: c.missing,
  };
}

/**
 * Ay aralığının kumaş satışı satırları. Dönem kuralı hizmet satırlarıyla aynı: ay = fatura tarihinin fabrika ayı; taslak
 * ayrı (katkı yok); iptal İPTAL AYINDA eksi satır, geçmiş ay değişmez.
 */
export async function computeProductProfitability(ctx: {
  readInvoices: (start: Date, end: Date) => Promise<ProductRevenueInvoiceRow[]>;
  machineTime: ProfitMachineTimeMode; subcontractSource: ProfitSubcontractSource; finance: CostContext["finance"];
  start: Date; end: Date; monthOf: (at: Date) => string;
}): Promise<ProductProfitability> {
  const { start, end, monthOf } = ctx;
  const invoices = await ctx.readInvoices(start, end);
  const gross = await collectShipmentGrossRolls(invoices.flatMap((i) => (i.shipmentId ? [i.shipmentId] : [])));
  const sold = gross.filter((r) => !isConsignedRoll(r));
  const indexOf = (list: ShipmentGrossRoll[]) => {
    const idx = new Map<string, ShipmentGrossRoll[]>();
    for (const r of list) idx.set(`${r.shipmentId}|${r.itemId}`, [...(idx.get(`${r.shipmentId}|${r.itemId}`) ?? []), r]);
    for (const l of idx.values()) l.sort((a, b) => a.id.localeCompare(b.id));
    return (shipmentId: string, itemId: string) => idx.get(`${shipmentId}|${itemId}`) ?? [];
  };
  const soldOf = indexOf(sold);
  const consignedOf = indexOf(gross.filter((r) => isConsignedRoll(r)));
  const traces = await weavingOriginsOfRolls(prisma, [...new Set(sold.map((r) => r.id))].sort());
  const subs = await rollSubcontracts(sold, traces, ctx);
  const woIds = [...new Set([...traces.values()].flatMap((t) => t.origins.flatMap((o) => (o.weavingOrderId ? [o.weavingOrderId] : []))))].sort();
  const costs = new Map(((await loadWeavingActualCosts(woIds, ctx.machineTime)) ?? []).map((c) => [c.weavingOrderId, c]));
  const inRange = (at: Date | null) => at !== null && at.getTime() >= start.getTime() && at.getTime() < end.getTime();

  const rows: ProductProfitRow[] = [];
  const draftRows: ProductProfitRow[] = [];
  for (const inv of invoices) {
    const parts = bucketsOf(inv, { soldOf, consignedOf }, traces, subs).map((p) => ({ ...p, c: costsOf(p.bucket, p.bucket.weavingOrderId ? costs.get(p.bucket.weavingOrderId) : undefined) }));
    const emit = (kind: ProductProfitRow["kind"], month: string, sign: 1 | -1) => { for (const p of parts) (kind === "DRAFT" ? draftRows : rows).push(rowOf(inv, p, { kind, month, sign })); };
    if (inv.status === InvoiceStatus.DRAFT) { if (inRange(inv.issueDate)) emit("DRAFT", monthOf(inv.issueDate), 1); continue; }
    if (inv.confirmedAt === null) continue;
    if (inRange(inv.issueDate)) emit("INVOICED", monthOf(inv.issueDate), 1);
    if (inRange(inv.cancelledAt)) emit("CANCELLED", monthOf(inv.cancelledAt!), -1);
  }
  const order = (a: ProductProfitRow, b: ProductProfitRow) => a.month.localeCompare(b.month) || (a.kind === b.kind ? 0 : a.kind === "INVOICED" ? -1 : 1);
  rows.sort(order);
  const notices: ProductNotice[] = ["GENEL_GIDER_DAGITILMADI"];
  if (rows.some((r) => r.returnedRollCount > 0)) notices.push("IADE_DUSULMEDI");
  if ([...costs.values()].some((c) => c.warpYarnMissing === null)) notices.push("COZGU_IPLIGI_OKUNMADI");
  return { rows, draftRows, notices };
}
