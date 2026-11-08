// ANLIK fason projeksiyonları (genel fason PB1, 2026-11-08): `emanet-bakiye` · `fason-acik` · `hizmet-geliri`.
// HESAP FABRİKADA, yeni iş mantığı YOK: emanet topu İçerideki İşler (`getConsignedWorkSummary`), iplik/levent
// `consignedMaterialByOwner`, fason açık/gecikme F10 kokpitinin özeti (`getSubcontractorCockpit`) — bulut ve uygulama
// aritmetik yapmaz (`test_bulut_fason_ozeti`). Tel yalnız ad + sayı taşır: top barkodu, belge no, kişi GİTMEZ (katı şema).
import { z } from "zod";
import { Prisma, InvoiceLineType, InvoiceStatus, InvoiceType } from "@prisma/client";
import prisma from "../lib/prisma";
import { getConsignedWorkSummary } from "../services/roll-owner.service";
import { consignedMaterialByOwner } from "../services/helpers/consigned-material.helper";
import { getSubcontractorCockpit } from "../services/subcontractor-cockpit.service";
import { readDevereEnabled, readEmanetEnabled, readIplikEnabled } from "../services/system-setting.service";
import { STANDARD_PERIODS, periodRange, type StandardPeriod } from "./periods";

export const CONSIGNED_SNAPSHOT = "emanet-bakiye";
export const SUBCONTRACT_OPEN_SNAPSHOT = "fason-acik";
export const SERVICE_REVENUE_SNAPSHOT = "hizmet-geliri";

const NumStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const Num = z.number();
const Uuid = z.string().uuid();
const PERIOD_KEY: Readonly<Record<StandardPeriod, string>> = { bugun: "bugun", "bu-ay": "buAy", "gecen-ay": "gecenAy", "son-30-gun": "son30Gun" };

const ConsignedBalance = {
  topAdet: Num,
  topMiktar: Num,
  /** `null` = iplik modülü kapalı (ölçülmedi; 0 değil). */
  iplikKg: NumStr.nullable(),
  /** `null` = devere modülü kapalı. */
  leventAdet: Num.nullable(),
};

/** Müşteri başına içerideki emanet (top · iplik · levent); sıra fabrikada (top metresi azalan, ad). */
export const CONSIGNED_SNAPSHOT_SCHEMA = z.strictObject({
  toplam: z.strictObject(ConsignedBalance),
  cariler: z.array(z.strictObject({ cariKartId: Uuid, etiket: z.string(), ...ConsignedBalance })),
});

/** F10 kokpit özeti: açık sevk, termini geçen, yaklaşan, fasonda kalan metre + firma şeridi (sıra kokpitinki). */
export const SUBCONTRACT_OPEN_SNAPSHOT_SCHEMA = z.strictObject({
  acikSevk: Num,
  geciken: Num,
  yaklasan: Num,
  kalanMiktar: NumStr,
  /** Açık sevk kokpit tavanını aştı: firma şeridi ilk N sevkten (sayılar `acikSevk` hariç eksik olabilir). */
  kirpildi: z.boolean(),
  firmalar: z.array(z.strictObject({
    fasonFirmaId: Uuid,
    etiket: z.string(),
    acikSevk: Num,
    geciken: Num,
    kalanMiktar: NumStr,
    iplikKg: NumStr,
    leventAdet: Num,
  })),
});

const RevenuePeriod = z.strictObject({
  toplamTl: NumStr,
  kalemler: z.array(z.strictObject({ hizmetId: Uuid, etiket: z.string(), miktar: NumStr, birim: z.string(), tutarTl: NumStr })),
});

/** Onaylı satış faturalarının hizmet satırları, hizmet kartı (süreç) kırılımıyla; dört standart dönem. */
export const SERVICE_REVENUE_SNAPSHOT_SCHEMA = z.strictObject({ bugun: RevenuePeriod, buAy: RevenuePeriod, gecenAy: RevenuePeriod, son30Gun: RevenuePeriod });

type ConsignedInput = z.input<typeof CONSIGNED_SNAPSHOT_SCHEMA>;

/** Emanet modülü kapalıyken `null` (anlık üretilmez — müşteri adı sızmasın, İçerideki İşler kapısının aynası). */
export async function buildConsignedSnapshotData(): Promise<ConsignedInput | null> {
  if (!(await readEmanetEnabled())) return null;
  const [rolls, yarn, beam] = await Promise.all([getConsignedWorkSummary(), readIplikEnabled(), readDevereEnabled()]);
  const material = await consignedMaterialByOwner({ yarn, beam });
  const names = new Map(rolls.data!.rows.map((r) => [r.ownerCustomerId, r.ownerName]));
  const missing = [...material.keys()].filter((id) => !names.has(id));
  if (missing.length > 0) {
    for (const c of await prisma.customer.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) names.set(c.id, c.name);
  }
  const byRoll = new Map(rolls.data!.rows.map((r) => [r.ownerCustomerId, r.total]));
  const ids = [...new Set([...byRoll.keys(), ...material.keys()])];
  const zero = new Prisma.Decimal(0);
  let yarnTotal = zero;
  let beamTotal = 0;
  const rows = ids.map((id) => {
    const t = byRoll.get(id) ?? { count: 0, qty: 0 };
    const m = material.get(id);
    const kg = yarn ? (m?.yarnKg ?? zero) : null;
    const beams = beam ? (m?.beamCount ?? 0) : null;
    if (kg) yarnTotal = yarnTotal.plus(kg);
    if (beams !== null) beamTotal += beams;
    return { cariKartId: id, etiket: names.get(id) ?? "—", topAdet: t.count, topMiktar: t.qty, iplikKg: kg ? kg.toFixed(3) : null, leventAdet: beams };
  });
  rows.sort((a, b) => b.topMiktar - a.topMiktar || a.etiket.localeCompare(b.etiket, "tr"));
  const tot = rolls.data!.totals.total;
  return {
    toplam: { topAdet: tot.count, topMiktar: tot.qty, iplikKg: yarn ? yarnTotal.toFixed(3) : null, leventAdet: beam ? beamTotal : null },
    cariler: rows,
  };
}

export async function buildSubcontractOpenSnapshotData(now: Date): Promise<z.input<typeof SUBCONTRACT_OPEN_SNAPSHOT_SCHEMA>> {
  // Sayfa istenmez (limit 1); özet ve firma şeridi kokpitin kendi tavanlı kümesinden.
  const res = await getSubcontractorCockpit({ limit: "1" }, now);
  const s = res.data!.summary;
  return {
    acikSevk: s.openDispatchCount,
    geciken: s.overdueCount,
    yaklasan: s.dueSoonCount,
    kalanMiktar: s.outstandingQty,
    kirpildi: (res.warnings?.length ?? 0) > 0,
    firmalar: s.firms.map((f) => ({
      fasonFirmaId: f.subcontractor.id, etiket: f.subcontractor.name, acikSevk: f.openDispatchCount, geciken: f.overdueCount,
      kalanMiktar: f.outstandingQty, iplikKg: f.yarnOutstandingKg, leventAdet: f.beamOutstandingCount,
    })),
  };
}

/**
 * Dönemin hizmet geliri: ONAYLI satış faturası (iptal edilen girmez — KDV özetiyle aynı kapsam ve `issueDate` çıpası),
 * hizmet satırı net tutarı × belgenin damgalı kuru (TL, kuruşa yuvarlı). Toplama DB'de (satır belleğe alınmaz).
 */
export async function serviceRevenueByItem(range: { from: Date; to: Date }): Promise<z.input<typeof RevenuePeriod>> {
  const rows = await prisma.$queryRaw<Array<{ serviceItemId: string; name: string; unit: string; qty: Prisma.Decimal; amountTry: Prisma.Decimal }>>(Prisma.sql`
    SELECT l."serviceItemId" AS "serviceItemId", si.name AS name, l.unit AS unit,
           SUM(l.qty) AS qty, SUM(ROUND(l."lineTotal" * i."exchangeRate", 2)) AS "amountTry"
    FROM invoice_lines l
    JOIN invoices i ON i.id = l."invoiceId"
    JOIN service_items si ON si.id = l."serviceItemId"
    WHERE i.type = ${InvoiceType.SALES}::"InvoiceType" AND i.status = ${InvoiceStatus.CONFIRMED}::"InvoiceStatus"
      AND l."lineType" = ${InvoiceLineType.SERVICE}::"InvoiceLineType"
      AND i."issueDate" >= ${range.from} AND i."issueDate" <= ${range.to}
    GROUP BY 1, 2, 3
    ORDER BY "amountTry" DESC, name ASC
  `);
  let total = new Prisma.Decimal(0);
  const kalemler = rows.map((r) => {
    const amount = new Prisma.Decimal(r.amountTry);
    total = total.plus(amount);
    return { hizmetId: r.serviceItemId, etiket: r.name, miktar: new Prisma.Decimal(r.qty).toFixed(3), birim: r.unit, tutarTl: amount.toFixed(2) };
  });
  return { toplamTl: total.toFixed(2), kalemler };
}

export async function buildServiceRevenueSnapshotData(now: Date): Promise<z.input<typeof SERVICE_REVENUE_SNAPSHOT_SCHEMA>> {
  const out: Record<string, z.input<typeof RevenuePeriod>> = {};
  for (const p of STANDARD_PERIODS) out[PERIOD_KEY[p]] = await serviceRevenueByItem(periodRange(p, now));
  return out as z.input<typeof SERVICE_REVENUE_SNAPSHOT_SCHEMA>;
}
