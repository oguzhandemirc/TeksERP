// =============================================================================
// MÜŞTERİ DÖNEM ÖZETİ — cari kayıt sayfasının sayı kartları (cari-be madde 3)
// =============================================================================
// Yeni tanım YOK; panonun kutuları müşteri süzgeciyle: brüt sevk `_shipped` gövdesi (pano `shippedTotal`), ciro
// `collectMoneyRows` + `aggregateMoney` (pano `revenueBox`, semantik `sevk.tutar`), sipariş `getOrderIntake` karnesi
// (pano `orderKpiBox`). Pencere `resolvePanoPencere` (fabrika günü); kapılar `panoGates` — izinsiz ölçü `null`.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { shippedPartsSql } from "./reports/_shipped";
import type { DateRange } from "./reports/_shared";
import { aggregateMoney, collectMoneyRows } from "./reports/_destination-mix-money";
import { getOrderIntake } from "./reports/order-intake.report.service";
import { loadAccessContext } from "./reports/semantik/izin";
import { panoGates, type PanoKullanici } from "./dashboard/pano-kaynak";
import { resolvePanoPencere, type PanoDonem } from "./dashboard/pano-donem";
import { kpi, type PanoKpi } from "./dashboard/pano-kutu-mevcut";
import { moneyKpis, type PanoParaKpi } from "./dashboard/pano-kutu-satis";
import { factoryYmd } from "../constants/time";

export interface CustomerPeriodSummary {
  donem: PanoDonem;
  /** Fabrika günü olarak pencere (`YYYY-AA-GG`). */
  aralik: { baslangic: string; bitis: string };
  sevk: { metre: PanoKpi; irsaliye: PanoKpi } | null;
  ciro: { tutarlar: PanoParaKpi[]; fiyatsizSatir: number } | null;
  siparis: { adet: PanoKpi; metre: PanoKpi } | null;
}

async function shippedForCustomer(range: DateRange, customerId: string): Promise<{ qty: number; docs: number }> {
  const [r] = await prisma.$queryRaw<Array<{ qty: number | null; docs: bigint | null }>>(Prisma.sql`
    WITH parts AS (${shippedPartsSql(range)})
    SELECT SUM(qty)::float AS qty, COUNT(DISTINCT sid) AS docs FROM parts WHERE "customerId" = ${customerId}::uuid`);
  return { qty: Number(r?.qty ?? 0), docs: Number(r?.docs ?? 0) };
}

async function revenueForCustomer(range: DateRange, customerId: string) {
  return aggregateMoney((await collectMoneyRows(range)).filter((row) => row.customerId === customerId));
}

const amountMap = (agg: ReturnType<typeof aggregateMoney>) => new Map(agg.amounts.map((a) => [a.currency as string, a.amount]));

/** `now` yalnız bekçi içindir (pano `getPanoBoxes` emsali); HTTP ucu vermez. */
export async function getCustomerPeriodSummary(customerId: string, donem: PanoDonem, user: PanoKullanici, now: Date = new Date()): Promise<CustomerPeriodSummary> {
  const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Cari bulunamadı.", { code: "CUSTOMER_NOT_FOUND", customerId });
  const can = panoGates(await loadAccessContext(user));
  const w = resolvePanoPencere(donem, now);
  const [sevkCur, sevkPrev, ciroCur, ciroPrev, intake] = await Promise.all([
    can.sevk ? shippedForCustomer(w.aralik, customerId) : null,
    can.sevk ? shippedForCustomer(w.oncekiAralik, customerId) : null,
    can.sevkTutar ? revenueForCustomer(w.aralik, customerId) : null,
    can.sevkTutar ? revenueForCustomer(w.oncekiAralik, customerId) : null,
    can.siparis ? getOrderIntake(w.aralik, w.oncekiAralik, { customerId: [customerId] }) : null,
  ]);
  const s = intake?.summary;
  return {
    donem,
    aralik: { baslangic: factoryYmd(w.aralik.from), bitis: factoryYmd(w.aralik.to) },
    sevk: sevkCur && sevkPrev ? { metre: kpi(sevkCur.qty, sevkPrev.qty), irsaliye: kpi(sevkCur.docs, sevkPrev.docs) } : null,
    ciro: ciroCur && ciroPrev ? { tutarlar: moneyKpis(amountMap(ciroCur), amountMap(ciroPrev)), fiyatsizSatir: ciroCur.lineCount - ciroCur.pricedLineCount } : null,
    siparis: s ? { adet: kpi(s.orderCount, s.prevOrderCount ?? 0), metre: kpi(s.totalQty, s.prevTotalQty ?? 0) } : null,
  };
}
