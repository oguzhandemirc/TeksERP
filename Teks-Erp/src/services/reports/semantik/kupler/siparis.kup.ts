// =============================================================================
// KÜP `siparis` — dönemde alınan iş (R1-SEMKUP)
// =============================================================================
// Metre Sipariş Karnesi'nin evrenidir: sipariş tarihi dönemde, iptal edilmiş sipariş ve iptal
// edilmiş kalem DIŞINDA (`ACTIVE_LINE` = `cancelledAt IS NULL`, `order-line-scope.helper.ts`).
// Termin, iptal ve iade ölçüleri TEK tanımlarıyla mevcut servislere bağlı helper'dır: zamanında
// teslim (terminsiz sipariş paydaya girmez, ayrıca sayılır), iptal oranı İptal Karnesi'nden
// (Sipariş Karnesi'ndeki ikinci tanım kullanılmaz), iade oranı brüt sevk paydasıyla.
// =============================================================================
import { Prisma } from "@prisma/client";
import { getShipmentScorecard } from "../../shipment-scorecard.report.service";
import { getOrderCancellationScorecard } from "../../order-cancellation.report.service";
import { getReturnScorecard } from "../../return-scorecard.report.service";
import { getOrderLeadTime } from "../../order-leadtime.report.service";
import { colorDimension, customerDimension, enumDimension, itemDimension, timeDimensions } from "../boyutlar";
import { totalOnly } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube, SemanticMeasure } from "../tipler";

const SALES_PERMISSION = "report:sales";
const SALES_MODULE = "cekirdek:siparis-musteri";
export const DESTINATION_LABELS = { DOMESTIC: "Yurtiçi", EXPORT: "Yurtdışı" } as const;

function orderLinesSql(range: { from: Date; to: Date }): Prisma.Sql {
  return Prisma.sql`(
    SELECT o."orderDate" AS at, ol.quantity::float AS qty, o."customerId", ol."itemId", ol."colorId",
           o.destination::text AS destination
    FROM order_lines ol
    JOIN orders o ON o.id = ol."orderId"
    WHERE ol."cancelledAt" IS NULL
      AND o."orderDate" >= ${range.from} AND o."orderDate" <= ${range.to}
      AND o.status <> 'CANCELLED'
  ) p`;
}

async function computeOnTime(input: HelperInput): Promise<HelperResult> {
  const s = (await getShipmentScorecard(input.range)).summary;
  const notes = s.noDeadlineOrders > 0 ? [`Termini olmayan ${s.noDeadlineOrders} sipariş orana girmedi.`] : [];
  return totalOnly(s.withDeadlineOrders > 0 ? s.onTimePct : null, notes);
}

async function computeCancelRate(input: HelperInput): Promise<HelperResult> {
  return totalOnly((await getOrderCancellationScorecard(input.range)).summary.cancelRatePct);
}

async function computeReturnRate(input: HelperInput): Promise<HelperResult> {
  const s = (await getReturnScorecard(input.range)).summary;
  return totalOnly(s.shippedQty > 0 ? s.returnPct : null);
}

function leadTime(pick: "medianDays" | "p90Days") {
  return async (input: HelperInput): Promise<HelperResult> => totalOnly((await getOrderLeadTime(input.range)).fullClose[pick]);
}

function helperMeasure(id: string, compute: (i: HelperInput) => Promise<HelperResult>, parity: SemanticMeasure["parity"]): SemanticMeasure {
  return { id, permission: SALES_PERMISSION, module: SALES_MODULE, kind: "helper", helper: { dimensions: [], perCurrency: false, compute }, parity };
}

export const orderCube: SemanticCube = {
  id: "siparis",
  name: "Sipariş ve termin",
  permission: SALES_PERMISSION,
  module: SALES_MODULE,
  source: orderLinesSql,
  timeColumn: "p.at",
  measures: [
    { id: "siparis.metre", permission: SALES_PERMISSION, module: SALES_MODULE, kind: "sum", sql: Prisma.sql`SUM(p.qty)`,
      parity: { report: "sales/siparis-talep", field: "anaSayi", legacy: "sales/order-intake" } },
    helperMeasure("termin.zamanindaYuzde", computeOnTime, { report: "sales/termin", field: "anaSayi", legacy: "sales/shipment-scorecard" }),
    helperMeasure("termin.yariSureGun", leadTime("medianDays"), { report: "sales/order-leadtime", field: "fullClose.medianDays" }),
    helperMeasure("termin.dokuzdaDokuzGun", leadTime("p90Days"), { report: "sales/order-leadtime", field: "fullClose.p90Days" }),
    helperMeasure("siparis.iptalOrani", computeCancelRate, { report: "sales/order-cancellation", field: "summary.cancelRatePct" }),
    helperMeasure("iade.oran", computeReturnRate, { report: "sales/return-scorecard", field: "summary.returnPct" }),
  ],
  dimensions: [
    ...timeDimensions("p.at"),
    customerDimension(`p."customerId"`),
    itemDimension(`p."itemId"`),
    colorDimension(`p."colorId"`),
    enumDimension({ id: "yon", name: "Yön", column: "p.destination", labels: DESTINATION_LABELS, nullLabel: "Yön kaydı yok" }),
  ],
  notes: ["Sipariş, alındığı güne yazılır; iptal edilen sipariş ve iptal edilen kalem alınan işe sayılmaz."],
};
