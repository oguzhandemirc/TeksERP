// Kârlılık raporu koşucusu (D4-G3) — hesap `profitability.helper`, biçim `profitability.sunum`; burada yalnız
// ad sözlükleri okunur (sunum saf kalsın, bekçi DB'siz ölçsün). Maliyet ya da ön muhasebe kapalı → null.
import prisma from "../../lib/prisma";
import { computeProfitability, type ProfitabilityResult } from "../helpers/profitability.helper";
import type { ResolvedDayRange } from "./temel/_day-range";
import {
  buildProfitabilitySunumu, compareMonthsOf, monthsOfWindow, PROFIT_BREAKDOWNS, type ProfitBreakdown, type ProfitNames, type ProfitScope,
} from "./profitability.sunum";
import { buildProductProfitabilitySunumu, PRODUCT_BREAKDOWNS, type ProductBreakdown, type ProductNames } from "./profitability-product.sunum";
import type { RaporSunumu } from "./sunum/sunum.types";
import { readCostProfitDefaultScope, readDokumaEnabled, type ProfitDefaultScope } from "../system-setting.service";
import { AppError } from "../../utils/app-error";

/** Kârlılık satırlarının ad sözlükleri (müşteri/işlem/makine/top) — panel raporu ve patron anlığı (D4-G4) ortak. */
export async function loadNames(results: ProfitabilityResult[]): Promise<ProfitNames> {
  const rows = results.flatMap((r) => r.rows);
  const ids = <T,>(pick: (x: (typeof rows)[number]) => T | null) => [...new Set(rows.map(pick).filter((v): v is T => v !== null))];
  const customers = await prisma.customer.findMany({ where: { id: { in: ids((r) => r.customerId) } }, select: { id: true, name: true } });
  const items = await prisma.serviceItem.findMany({ where: { id: { in: ids((r) => r.serviceItemId) } }, select: { id: true, name: true } });
  const machines = await prisma.machine.findMany({ where: { id: { in: ids((r) => r.machineId) } }, select: { id: true, name: true } });
  const rolls = await prisma.roll.findMany({ where: { id: { in: ids((r) => r.rollId) } }, select: { id: true, barcode: true } });
  // F4: levent sarım satırının öznesi levent — aynı sözlükte levent no ile (kimlikler çakışmaz, ikisi de UUID).
  const beams = await prisma.warpBeam.findMany({ where: { id: { in: ids((r) => r.warpBeamId) } }, select: { id: true, beamNo: true } });
  return {
    customers: new Map(customers.map((c) => [c.id, c.name])),
    serviceItems: new Map(items.map((i) => [i.id, i.name])),
    machines: new Map(machines.map((m) => [m.id, m.name])),
    rolls: new Map([...rolls.map((r): [string, string] => [r.id, r.barcode ?? "barkodsuz top"]), ...beams.map((b): [string, string] => [b.id, `Levent ${b.beamNo}`])]),
  };
}

/** Kumaş kapsamının ad sözlükleri (müşteri · ürün kartı · dokuma iş emri no). */
export async function loadProductNames(results: ProfitabilityResult[]): Promise<ProductNames> {
  const rows = results.flatMap((r) => r.productRows ?? []);
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((v): v is string => v !== null))];
  const customers = await prisma.customer.findMany({ where: { id: { in: uniq(rows.map((r) => r.customerId)) } }, select: { id: true, name: true } });
  const items = await prisma.item.findMany({ where: { id: { in: uniq(rows.map((r) => r.itemId)) } }, select: { id: true, name: true } });
  const orders = await prisma.weavingOrder.findMany({ where: { id: { in: uniq(rows.map((r) => r.weavingOrderId)) } }, select: { id: true, weavingOrderNumber: true } });
  return {
    customers: new Map(customers.map((c) => [c.id, c.name])),
    items: new Map(items.map((i) => [i.id, i.name])),
    weavingOrders: new Map(orders.map((o) => [o.id, o.weavingOrderNumber])),
  };
}

/**
 * Kapsam + kırılım çözümü (SAF; bekçi DB'siz ölçer). Kapsamsız istekte ayar `KUMAS` yalnız dokuma açıkken uygulanır
 * (yeni ayarın varsayılanı `HIZMET` = bugünkü tablo). Kapsama ait olmayan kırılım 400 — sessizce başka tablo çizilmez.
 */
export function resolveProfitView(q: { kapsam?: ProfitScope; kirilim?: string }, dokuma: boolean, defaultScope: ProfitDefaultScope):
  { scope: "hizmet"; breakdown: ProfitBreakdown } | { scope: "kumas"; breakdown: ProductBreakdown } {
  const scope: ProfitScope = q.kapsam ?? (dokuma && defaultScope === "KUMAS" ? "kumas" : "hizmet");
  if (scope === "kumas") {
    const b = q.kirilim ?? "desen";
    if (!(PRODUCT_BREAKDOWNS as readonly string[]).includes(b)) throw AppError.badRequest("Kumaş satışı kapsamında bu kırılım yok; Desen, Müşteri, Ay ya da İş seçin", { code: "PROFIT_BREAKDOWN_SCOPE" });
    return { scope, breakdown: b as ProductBreakdown };
  }
  const b = q.kirilim ?? "musteri";
  if (!(PROFIT_BREAKDOWNS as readonly string[]).includes(b)) throw AppError.badRequest("Hizmet işleri kapsamında bu kırılım yok; Müşteri, İşlem, Makine, Ay ya da İş seçin", { code: "PROFIT_BREAKDOWN_SCOPE" });
  return { scope, breakdown: b as ProfitBreakdown };
}

/**
 * Panel ucu (K1 dilim 2): hizmet kapsamı bugünkü koşucuyla aynı sayıları verir; dokuma açıkken kapsam çipi beyan edilir.
 * Dokuma kapalıyken `kapsam=kumas` uç kapısında 403 olur; istek sırasında kapanırsa `productRows` yoktur → null (409).
 */
export async function profitabilityScopedReport(window: ResolvedDayRange, q: { kapsam?: ProfitScope; kirilim?: string }): Promise<RaporSunumu | null> {
  const dokuma = await readDokumaEnabled();
  const view = resolveProfitView(q, dokuma, await readCostProfitDefaultScope());
  const months = monthsOfWindow(window.days);
  const cmpMonths = compareMonthsOf(window);
  if (view.scope === "hizmet") {
    const result = await computeProfitability(months);
    if (!result) return null;
    const previous = cmpMonths ? await computeProfitability(cmpMonths) : null;
    const names = await loadNames(previous ? [result, previous] : [result]);
    return buildProfitabilitySunumu({ result, previous, names, window, breakdown: view.breakdown, ...(dokuma ? { scopeOffered: true } : {}) });
  }
  const result = await computeProfitability({ ...months, includeProducts: true });
  if (!result?.productRows) return null;
  const previous = cmpMonths ? await computeProfitability({ ...cmpMonths, includeProducts: true }) : null;
  const names = await loadProductNames(previous ? [result, previous] : [result]);
  return buildProductProfitabilitySunumu({ result, previous, names, window, breakdown: view.breakdown });
}

export async function profitabilityReport(window: ResolvedDayRange, breakdown: ProfitBreakdown, allowedBreakdowns?: readonly ProfitBreakdown[]): Promise<RaporSunumu | null> {
  const result = await computeProfitability(monthsOfWindow(window.days));
  if (!result) return null;
  const cmpMonths = compareMonthsOf(window);
  const previous = cmpMonths ? await computeProfitability(cmpMonths) : null;
  const names = await loadNames(previous ? [result, previous] : [result]);
  return buildProfitabilitySunumu({ result, previous, names, window, breakdown, allowedBreakdowns });
}
