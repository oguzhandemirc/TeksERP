// =============================================================================
// KÂRLILIK — KUMAŞ SATIŞI SATIRLARI (K1 dilim 1; PLAN-karlilik-dokuma-1126 §2)
// =============================================================================
// Satır = fatura × ürün kartı × dokuma işi. Hizmet satırlarından (`profitability.helper` `rows`) AYRI evrendir;
// havuz (işçilik/genel gider) ALMAZ (K1.4) — "katkı" = gelir − doğrudan maliyet. Sonuç saklanmaz.
//   Gelir: ÜRÜN satırı net tutarı × belge kuru; fatura satırı ↔ top bağı yok (K1.2) → sevkin o ürüne ait SATILAN
//   toplarına (brüt küme `collectShipmentGrossRolls`, emanet hariç) metre payıyla, son top kalanı alır.
//   Maliyet (K1.1): iş emrinin bugüne kadarki gerçekleşeni — "Dokuma maliyeti" tablosunun TEK kaynağı
//   (`weavingActualCostTx`, köprü `loadWeavingActualCosts`) TL/m × satılan metre; ücret çarpımı burada YOK.
//   Bilinmeyen parça `null` + kod; herhangi bir kod varsa katkı `null` (0 yazılmaz). İplik dilim 3'e dek `IPLIK_MALIYETI`.
// =============================================================================
import { InvoiceStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ProfitMachineTimeMode } from "../system-setting.service";
import type { ProductRevenueInvoiceRow } from "./profitability-finance.helper";
import { loadWeavingActualCosts } from "./maliyet-bridge.helper";
import { collectRollLineage } from "./service-billing-gate.helper";
import { collectShipmentGrossRolls, type ShipmentGrossRoll } from "./shipment-sold-rolls.helper";
import { isConsignedRoll } from "./stock-ownership.helper";
import { WEAVING_INFO_CODES, type WeavingActualCost, type WeavingActualMissing } from "./weaving-actual-cost.helper";
import { weavingOrdersOfRolls } from "./weaving-order-of-roll.helper";

type Dec = Prisma.Decimal;
const D0 = () => new Prisma.Decimal(0);

/**
 * Dokuma işinin tezgâh/devere kodları (`WeavingActualMissing`) + kumaş satışına özgü kodlar: `IPLIK_MALIYETI` iplik
 * maliyeti henüz okunmuyor · `DOKUMA_ISI_YOK` top hiçbir dokuma işine çözülmüyor (al-sat, stok devri) · `SEVK_BAGI_YOK`
 * faturanın sevki ya da sevkte o ürünün satılan topu yok · `DIS_FASON` zincirde boya/apre fason makbuzu (dilim 3).
 */
export type ProductMissingCode = WeavingActualMissing | "IPLIK_MALIYETI" | "DOKUMA_ISI_YOK" | "SEVK_BAGI_YOK" | "DIS_FASON";
/** Tablo düzeyi bilgi: genel gider dağıtılmadı (K1.4) · iade edilen top brütte kaldı, iade faturası dilim 4'te (K1.5). */
export type ProductNotice = "GENEL_GIDER_DAGITILMADI" | "IADE_DUSULMEDI";

export interface ProductProfitRow {
  month: string;
  kind: "INVOICED" | "CANCELLED" | "DRAFT";
  invoiceId: string;
  docNo: string;
  customerId: string | null;
  itemId: string;
  /** Topların çözüldüğü dokuma işi; çözülmeyen kova null (`DOKUMA_ISI_YOK` / `DIS_FASON` / `SEVK_BAGI_YOK`). */
  weavingOrderId: string | null;
  /** İş bitmedi ya da açık koşum var: maliyet bugünkü bilgiyle, yarın değişebilir. */
  ongoing: boolean;
  rollCount: number;
  /** Brütte kalan, sonradan iade edilmiş top sayısı (iade düşülmedi). */
  returnedRollCount: number;
  /** Satılan (sevk anındaki) metre. */
  meters: Dec;
  revenueTry: Dec;
  weavingTry: Dec | null;
  /** Devere payı; devere modülü kapalıysa null ve kodsuz (kalem yok). */
  warpingTry: Dec | null;
  warpingEstimated: boolean;
  yarnTry: Dec | null;
  /** Boya/apre fasonu: zincirde fason yoksa 0, varsa dilim 3'e dek null + `DIS_FASON`. */
  subcontractTry: Dec | null;
  /** Gelir − dokuma − devere − iplik − dış fason; herhangi bir kod varsa ya da taslakta `null`. */
  contributionTry: Dec | null;
  missing: ProductMissingCode[];
}

export interface ProductProfitability {
  rows: ProductProfitRow[];
  draftRows: ProductProfitRow[];
  notices: ProductNotice[];
}

type Bucket = { weavingOrderId: string | null; fason: boolean; rollCount: number; returnedRollCount: number; meters: Dec; revenueTry: Dec; noShipment: boolean };

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

/** Satılan topların ata zinciri: top → dokuma işi (ilk çözülen ata) ve zincirde boya/apre fason makbuzu var mı. */
async function resolveRollOrigins(rollIds: string[]): Promise<Map<string, { weavingOrderId: string | null; fason: boolean }>> {
  const out = new Map<string, { weavingOrderId: string | null; fason: boolean }>();
  if (rollIds.length === 0) return out;
  const lineage = await collectRollLineage(rollIds);
  const nodes = await prisma.roll.findMany({
    where: { id: { in: lineage } },
    select: { id: true, parentRollId: true, parentReceipt: { select: { cancelledAt: true, weavingOrderId: true } } },
  });
  // Fason dokuma makbuzu (`weavingOrderId` dolu) dokuma kaynağıdır, boya/apre değildir.
  const throughFason = await prisma.subcontractorReceiptItem.findMany({
    where: { newRollId: { in: lineage }, receipt: { cancelledAt: null, weavingOrderId: null } },
    select: { newRollId: true },
  });
  const fasonIds = new Set(throughFason.map((i) => i.newRollId));
  for (const n of nodes) if (n.parentReceipt && !n.parentReceipt.cancelledAt && !n.parentReceipt.weavingOrderId) fasonIds.add(n.id);
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentRollId]));
  const woOf = await weavingOrdersOfRolls(prisma, lineage);
  for (const id of rollIds) {
    let cur: string | null = id;
    let wo: string | null = null;
    let fason = false;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (fasonIds.has(cur)) fason = true;
      if (!wo) wo = woOf.get(cur)?.weavingOrderId ?? null;
      cur = parentOf.get(cur) ?? null;
    }
    out.set(id, { weavingOrderId: wo, fason });
  }
  return out;
}

/** Faturanın ürün × köken kovaları: satılan topa düşen gelir payı köken (iş + fason) başına toplanır. */
function bucketsOf(inv: ProductRevenueInvoiceRow, soldOf: (shipmentId: string, itemId: string) => ShipmentGrossRoll[], origins: Map<string, { weavingOrderId: string | null; fason: boolean }>): Array<{ itemId: string; bucket: Bucket }> {
  const out: Array<{ itemId: string; bucket: Bucket }> = [];
  for (const itemId of [...inv.lineTotalByItem.keys()].sort()) {
    const revenueTry = inv.lineTotalByItem.get(itemId)!.mul(inv.exchangeRate);
    const rolls = inv.shipmentId ? soldOf(inv.shipmentId, itemId) : [];
    if (rolls.length === 0) {
      out.push({ itemId, bucket: { weavingOrderId: null, fason: false, rollCount: 0, returnedRollCount: 0, meters: D0(), revenueTry, noShipment: true } });
      continue;
    }
    const shares = shareByMeters(revenueTry, rolls.map((r) => r.currentQty));
    const byKey = new Map<string, Bucket>();
    rolls.forEach((r, i) => {
      const o = origins.get(r.id) ?? { weavingOrderId: null, fason: false };
      const key = `${o.weavingOrderId ?? "-"}|${o.fason}`;
      const b = byKey.get(key) ?? { weavingOrderId: o.weavingOrderId, fason: o.fason, rollCount: 0, returnedRollCount: 0, meters: D0(), revenueTry: D0(), noShipment: false };
      b.rollCount++;
      if (r.returned) b.returnedRollCount++;
      b.meters = b.meters.plus(r.currentQty);
      b.revenueTry = b.revenueTry.plus(shares[i]!);
      byKey.set(key, b);
    });
    for (const key of [...byKey.keys()].sort()) out.push({ itemId, bucket: byKey.get(key)! });
  }
  return out;
}

/** Kovanın doğrudan maliyet parçaları ve eksik kodları (işaretsiz; iptal satırında çağıran eksiler). */
function costsOf(b: Bucket, cost: WeavingActualCost | undefined) {
  const missing: ProductMissingCode[] = [];
  if (b.noShipment) return { weavingTry: null, warpingTry: null, warpingEstimated: false, yarnTry: null, subcontractTry: null, ongoing: false, missing: ["SEVK_BAGI_YOK"] as ProductMissingCode[] };
  if (!b.weavingOrderId || !cost) {
    missing.push(b.fason ? "DIS_FASON" : "DOKUMA_ISI_YOK");
    return { weavingTry: null, warpingTry: null, warpingEstimated: false, yarnTry: null, subcontractTry: null, ongoing: false, missing };
  }
  // Standart sürüm boşluğu gerçek maliyeti etkilemez; bilgi kodları "eksik" saymaz.
  const gaps = cost.missing.filter((m) => m !== "STANDART_YOK" && !WEAVING_INFO_CODES.includes(m));
  const weavingTry = cost.actualPerMTry ? cost.actualPerMTry.mul(b.meters) : null;
  missing.push(...gaps);
  if (!weavingTry && gaps.length === 0) missing.push("TOP_YOK");
  let warpingTry: Dec | null = null;
  if (cost.warpingMissing !== null) {
    if (cost.warpingPerMTry) warpingTry = cost.warpingPerMTry.mul(b.meters);
    else missing.push(...(cost.warpingMissing.length > 0 ? cost.warpingMissing : (["COZGU_TUKETIMI"] as WeavingActualMissing[])));
  }
  missing.push("IPLIK_MALIYETI");
  if (b.fason) missing.push("DIS_FASON");
  return {
    weavingTry, warpingTry, warpingEstimated: warpingTry !== null && cost.warpingSource !== null && cost.warpingSource !== "FATURA",
    yarnTry: null as Dec | null, subcontractTry: b.fason ? null : D0(), ongoing: cost.ongoing, missing: [...new Set(missing)],
  };
}

/**
 * Ay aralığının kumaş satışı satırları. Dönem kuralı hizmet satırlarıyla aynı: ay = fatura tarihinin fabrika ayı; taslak
 * ayrı (katkı yok); iptal İPTAL AYINDA eksi satır, geçmiş ay değişmez.
 */
export async function computeProductProfitability(ctx: {
  readInvoices: (start: Date, end: Date) => Promise<ProductRevenueInvoiceRow[]>;
  machineTime: ProfitMachineTimeMode; start: Date; end: Date; monthOf: (at: Date) => string;
}): Promise<ProductProfitability> {
  const { start, end, monthOf } = ctx;
  const invoices = await ctx.readInvoices(start, end);
  const sold = (await collectShipmentGrossRolls(invoices.flatMap((i) => (i.shipmentId ? [i.shipmentId] : [])))).filter((r) => !isConsignedRoll(r));
  const soldIndex = new Map<string, ShipmentGrossRoll[]>();
  for (const r of sold) soldIndex.set(`${r.shipmentId}|${r.itemId}`, [...(soldIndex.get(`${r.shipmentId}|${r.itemId}`) ?? []), r]);
  for (const list of soldIndex.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  const soldOf = (shipmentId: string, itemId: string) => soldIndex.get(`${shipmentId}|${itemId}`) ?? [];
  const origins = await resolveRollOrigins([...new Set(sold.map((r) => r.id))]);
  const woIds = [...new Set([...origins.values()].flatMap((o) => (o.weavingOrderId ? [o.weavingOrderId] : [])))].sort();
  const costs = new Map(((await loadWeavingActualCosts(woIds, ctx.machineTime)) ?? []).map((c) => [c.weavingOrderId, c]));
  const inRange = (at: Date | null) => at !== null && at.getTime() >= start.getTime() && at.getTime() < end.getTime();

  const rows: ProductProfitRow[] = [];
  const draftRows: ProductProfitRow[] = [];
  let returned = false;
  for (const inv of invoices) {
    const parts = bucketsOf(inv, soldOf, origins).map((p) => ({ ...p, c: costsOf(p.bucket, p.bucket.weavingOrderId ? costs.get(p.bucket.weavingOrderId) : undefined) }));
    const emit = (kind: ProductProfitRow["kind"], month: string, sign: 1 | -1) => {
      const neg = (d: Dec | null) => (d === null ? null : sign === 1 ? d : d.neg());
      for (const { itemId, bucket: b, c } of parts) {
        if (kind !== "DRAFT" && b.returnedRollCount > 0) returned = true;
        const known = kind !== "DRAFT" && c.missing.length === 0 && c.weavingTry && c.yarnTry && c.subcontractTry;
        const contribution = known ? b.revenueTry.minus(c.weavingTry!).minus(c.warpingTry ?? D0()).minus(c.yarnTry!).minus(c.subcontractTry!) : null;
        (kind === "DRAFT" ? draftRows : rows).push({
          month, kind, invoiceId: inv.id, docNo: inv.docNo, customerId: inv.cariCustomerId, itemId, weavingOrderId: b.weavingOrderId,
          ongoing: c.ongoing, rollCount: b.rollCount, returnedRollCount: b.returnedRollCount, meters: neg(b.meters)!, revenueTry: neg(b.revenueTry)!,
          weavingTry: neg(c.weavingTry), warpingTry: neg(c.warpingTry), warpingEstimated: c.warpingEstimated, yarnTry: neg(c.yarnTry),
          subcontractTry: neg(c.subcontractTry), contributionTry: neg(contribution), missing: c.missing,
        });
      }
    };
    if (inv.status === InvoiceStatus.DRAFT) { if (inRange(inv.issueDate)) emit("DRAFT", monthOf(inv.issueDate), 1); continue; }
    if (inv.confirmedAt === null) continue;
    if (inRange(inv.issueDate)) emit("INVOICED", monthOf(inv.issueDate), 1);
    if (inRange(inv.cancelledAt)) emit("CANCELLED", monthOf(inv.cancelledAt!), -1);
  }
  const order = (a: ProductProfitRow, b: ProductProfitRow) => a.month.localeCompare(b.month) || (a.kind === b.kind ? 0 : a.kind === "INVOICED" ? -1 : 1);
  rows.sort(order);
  return { rows, draftRows, notices: returned ? ["GENEL_GIDER_DAGITILMADI", "IADE_DUSULMEDI"] : ["GENEL_GIDER_DAGITILMADI"] };
}
