// =============================================================================
// GERÇEKLEŞEN KÂRLILIK — TEK KAYNAK (D4-G2a; DALGA4 §8.3 seçenek B, §8.5, §12.4)
// =============================================================================
// Soru: "hangi müşteri, hangi işlem, hangi ay ne kazandırdı?" Standart ürün maliyetini YALNIZ
// `fabric-cost.helper`, gerçekleşen dönem kârlılığını YALNIZ bu dosya (+ `profitability-cost/-finance`) üretir;
// birbirini import etmez (`test_karlilik_cekirdek` §0). Sonuç SAKLANMAZ; ayarlar okuma anında uygulanır.
//   İş = hizmet bağı (top × hizmet kalemi × adım). İş listesi YENİDEN YAZILMAZ: bağ, faturalamanın tek
//   listeleyicisinden (kurşun `serviceWorkKey`, bayrak `listFlagServiceWorks`) doğmuştur; burada yalnız okunur.
//   Gelir = ONAYLI fatura satırı net tutarı × belge kuru, aynı kalemin bağlarına `billedMeters` payıyla
//   (son bağ kalanı alır → toplam kuruşu kuruşuna satır toplamı). Ay = fatura tarihinin fabrika ayı.
//   İptal: İPTAL AYINDA aynı tutarlarla EKSİ satır; geçmiş ayın satırı değişmez (defter.md "ters kayıt bugüne").
//   Taslak: ayrı `draftRows`, katkıya GİRMEZ. Eksik norm/fiyat/kur: değer `null` + kod (0 değil).
//   D4-G2b: katkıya makine-saat maliyeti girer (`profitability-machine`); net = katkı − işçilik − genel gider
//   (`profitability-overhead`; genel gider varsayılan `YOK` → dağıtılmaz, net = katkı). Ay özeti `months`.
//   D4-G2c: bağlı masraf as-of doğrudan masraftır (`profitability-allocation`); bağ yoksa alan eklenmez (bayt-aynı).
// Modül: maliyet KAPALI → null, tabloya sorgu yok; finans kapalı → null (gelir faturadan; maliyet-bridge emsali).
// =============================================================================
import { InvoiceStatus, Prisma, ServiceMeterBasis } from "@prisma/client";
import { factoryDayStartOfKey, factoryYmd } from "../../constants/time";
import { AppError } from "../../utils/app-error";
import {
  readCostProfitCategoryClasses,
  readCostProfitConsumablePriceSource,
  readCostProfitMachineTime,
  readCostProfitOverheadKey,
  readCostProfitSubcontractSource,
  readFinanceExpenseAllocationField,
  readMaliyetEnabled,
  type ProfitCategoryClassMap,
  type ProfitConsumablePriceSource,
  type ProfitMachineTimeMode,
  type ProfitOverheadKey,
  type ProfitSubcontractSource,
} from "../system-setting.service";
import { loadProfitabilityFinance } from "./maliyet-bridge.helper";
import { computeWorkCosts, type ProfitMissingCode as CostMissingCode } from "./profitability-cost.helper";
import type { RevenueInvoiceRow, RevenueLinkRow } from "./profitability-finance.helper";
import { computeMachineCosts, type IdleMachineDay, type MachineMissingCode } from "./profitability-machine.helper";
import { attachDirectExpenses, deductFromPools, readMonthAllocations, workOrderOfSteps, type MonthDirectExpenses } from "./profitability-allocation.helper";
import { buildMonthPools, distributePool, overheadBase, type PoolCategory } from "./profitability-overhead.helper";

export type ProfitMissingCode = CostMissingCode | MachineMissingCode;
export type { IdleMachineDay } from "./profitability-machine.helper";

export type ProfitRowKind = "INVOICED" | "CANCELLED" | "DRAFT";

export interface ProfitabilityRow {
  /** Fabrika ayı `YYYY-MM` (fatura tarihi; iptal satırında iptal anı). */
  month: string;
  kind: ProfitRowKind;
  invoiceId: string;
  docNo: string;
  linkId: string;
  customerId: string | null;
  rollId: string;
  serviceItemId: string;
  workOrderStepId: string | null;
  machineId: string | null;
  meterBasis: ServiceMeterBasis;
  meters: Prisma.Decimal;
  revenueTry: Prisma.Decimal;
  consumableTry: Prisma.Decimal | null;
  subcontractTry: Prisma.Decimal | null;
  subcontractEstimated: boolean;
  /** D4-G2b: işin makinesi ölçüm okumasından atfedildi mi (değilse makine maliyeti 0, süre boşta satırında). */
  machineAttributed: boolean;
  machineHours: Prisma.Decimal | null;
  machineTry: Prisma.Decimal | null;
  /** Gelir − sarf − dış fason − makine; herhangi biri eksikse `null`. Taslakta hep `null` (kâra girmez). */
  contributionTry: Prisma.Decimal | null;
  /** D4-G2b: ayın işçilik havuzundan makine saati payı (iptal/taslak satırda 0). */
  laborTry: Prisma.Decimal;
  /** D4-G2b: ayın genel gider havuzundan pay (`YOK` ya da iptal/taslak satırda 0). */
  overheadTry: Prisma.Decimal;
  /** D4-G2c: masraf bağından doğrudan masraf payı — yalnız o ay bu satıra bağ düştüyse var. */
  directExpenseTry?: Prisma.Decimal;
  /** Katkı − işçilik − genel gider (− doğrudan masraf); katkı `null` ise `null`. `YOK` + sınıfsız kurulumda = katkı. */
  netTry: Prisma.Decimal | null;
  missing: ProfitMissingCode[];
}

/** D4-G2b: ay özeti — havuzlar, dağıtılan kısım, boşta makine (dağıtılmayan her şey burada görünür). */
export interface ProfitMonthSummary {
  month: string;
  overheadPoolTry: Prisma.Decimal;
  overheadDistributedTry: Prisma.Decimal;
  laborPoolTry: Prisma.Decimal;
  laborDistributedTry: Prisma.Decimal;
  excludedTry: Prisma.Decimal;
  idleMachineHours: Prisma.Decimal;
  /** Tarifesi eksik boşta gün varsa `null`. */
  idleMachineTry: Prisma.Decimal | null;
  categories: PoolCategory[];
  /** D4-G2c: ayın masraf bağı parçaları (as-of + geç bağ düzeltmesi + iptal tersi); bağ yoksa alan yok. */
  directExpenses?: MonthDirectExpenses;
}

export interface ProfitabilityResult {
  fromMonth: string;
  toMonth: string;
  settings: {
    subcontractSource: ProfitSubcontractSource; consumablePriceSource: ProfitConsumablePriceSource;
    machineTime: ProfitMachineTimeMode; overheadKey: ProfitOverheadKey; categoryClasses: ProfitCategoryClassMap;
  };
  rows: ProfitabilityRow[];
  draftRows: ProfitabilityRow[];
  months: ProfitMonthSummary[];
  idleMachineDays: IdleMachineDay[];
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const D0 = () => new Prisma.Decimal(0);

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Tarihin fabrika ayı — tek kaynak `constants/time.ts`. */
export function factoryMonthOf(at: Date): string {
  return factoryYmd(at).slice(0, 7);
}

/** Kalem grubunun TL gelirini bağlara metre payıyla böler; son bağ kalanı alır (toplam = satır toplamı, tam). */
function allocateRevenue(totalTry: Prisma.Decimal, links: RevenueLinkRow[]): Prisma.Decimal[] {
  const meters = links.reduce((a, l) => a.plus(l.billedMeters), D0());
  const out: Prisma.Decimal[] = [];
  let used = D0();
  links.forEach((l, i) => {
    if (i === links.length - 1) { out.push(totalTry.minus(used)); return; }
    const share = meters.gt(0) ? totalTry.mul(l.billedMeters).div(meters) : totalTry.div(links.length);
    used = used.plus(share);
    out.push(share);
  });
  return out;
}

/** Faturanın bağ başına geliri (TL). Satırı olmayan kalemin bağı GELIR_SATIRI eksiğiyle 0 gelir taşır. */
function revenueByLink(inv: RevenueInvoiceRow): Map<string, { revenueTry: Prisma.Decimal; missing: ProfitMissingCode[] }> {
  const out = new Map<string, { revenueTry: Prisma.Decimal; missing: ProfitMissingCode[] }>();
  const byItem = new Map<string, RevenueLinkRow[]>();
  for (const l of inv.links) byItem.set(l.serviceItemId, [...(byItem.get(l.serviceItemId) ?? []), l]);
  for (const [itemId, group] of byItem) {
    const line = inv.lineTotalByItem.get(itemId);
    const shares = allocateRevenue((line ?? D0()).mul(inv.exchangeRate), group);
    group.forEach((l, i) => out.set(l.id, { revenueTry: shares[i]!, missing: line ? [] : ["GELIR_SATIRI"] }));
  }
  return out;
}

/** Ay aralığının kârlılık satırları. Maliyet ya da finans kapalı → null (tabloya sorgu atılmaz). */
export async function computeProfitability(params: { fromMonth: string; toMonth: string }): Promise<ProfitabilityResult | null> {
  const { fromMonth, toMonth } = params;
  if (!MONTH_RE.test(fromMonth) || !MONTH_RE.test(toMonth) || fromMonth > toMonth) {
    throw AppError.badRequest("Ay aralığı YYYY-AA biçiminde ve başlangıç ≤ bitiş olmalı", { code: "PROFIT_RANGE_INVALID" });
  }
  if (!(await readMaliyetEnabled())) return null;
  const finance = await loadProfitabilityFinance();
  if (!finance) return null;
  const settings = {
    subcontractSource: await readCostProfitSubcontractSource(), consumablePriceSource: await readCostProfitConsumablePriceSource(),
    machineTime: await readCostProfitMachineTime(), overheadKey: await readCostProfitOverheadKey(), categoryClasses: await readCostProfitCategoryClasses(),
  };
  const start = factoryDayStartOfKey(`${fromMonth}-01`);
  const end = factoryDayStartOfKey(`${nextMonth(toMonth)}-01`);
  const invoices = await finance.readServiceRevenueInvoices(start, end);
  const inRange = (at: Date | null) => at !== null && at.getTime() >= start.getTime() && at.getTime() < end.getTime();

  const linkById = new Map<string, RevenueLinkRow>();
  for (const inv of invoices) for (const l of inv.links) linkById.set(l.id, l);
  const costs = await computeWorkCosts({ ...settings, finance }, [...linkById.values()]);
  const machine = await computeMachineCosts(settings.machineTime, [...linkById.values()], start, end);

  const rows: ProfitabilityRow[] = [];
  const draftRows: ProfitabilityRow[] = [];
  for (const inv of invoices) {
    const revenue = revenueByLink(inv);
    const emit = (kind: ProfitRowKind, month: string, sign: 1 | -1) => {
      for (const l of inv.links) {
        const r = revenue.get(l.id)!;
        const c = costs.get(l.id)!;
        const mc = machine.byLink.get(l.id)!;
        const neg = (d: Prisma.Decimal | null) => (d === null ? null : sign === 1 ? d : d.neg());
        const missing: ProfitMissingCode[] = [...r.missing, ...c.missing, ...mc.missing];
        // Gelir satırı eksikse (GELIR_SATIRI) gelir 0 taşır ama katkı uydurulmaz → null.
        const contribution = kind === "DRAFT" || r.missing.length > 0 || c.consumableTry === null || c.subcontractTry === null || mc.machineTry === null
          ? null
          : r.revenueTry.minus(c.consumableTry).minus(c.subcontractTry).minus(mc.machineTry);
        (kind === "DRAFT" ? draftRows : rows).push({
          month, kind, invoiceId: inv.id, docNo: inv.docNo, linkId: l.id, customerId: l.ownerCustomerId ?? inv.cariCustomerId,
          rollId: l.rollId, serviceItemId: l.serviceItemId, workOrderStepId: l.workOrderStepId, machineId: l.machineId,
          meterBasis: l.meterBasis, meters: sign === 1 ? l.billedMeters : l.billedMeters.neg(),
          revenueTry: neg(r.revenueTry)!, consumableTry: neg(c.consumableTry), subcontractTry: neg(c.subcontractTry),
          subcontractEstimated: c.subcontractEstimated, machineAttributed: mc.machineAttributed, machineHours: neg(mc.machineHours),
          machineTry: neg(mc.machineTry), contributionTry: neg(contribution), laborTry: D0(), overheadTry: D0(), netTry: neg(contribution), missing,
        });
      }
    };
    if (inv.status === InvoiceStatus.DRAFT) { if (inRange(inv.issueDate)) emit("DRAFT", factoryMonthOf(inv.issueDate), 1); continue; }
    if (inv.confirmedAt === null) continue;
    if (inRange(inv.issueDate)) emit("INVOICED", factoryMonthOf(inv.issueDate), 1);
    if (inRange(inv.cancelledAt)) emit("CANCELLED", factoryMonthOf(inv.cancelledAt!), -1);
  }
  const order = (a: ProfitabilityRow, b: ProfitabilityRow) => a.month.localeCompare(b.month) || (a.kind === b.kind ? 0 : a.kind === "INVOICED" ? -1 : 1);
  rows.sort(order);
  const months = await applyPools(rows, { settings, finance, fromMonth, toMonth, start, end, idle: machine.idle });
  return { fromMonth, toMonth, settings, rows, draftRows, months, idleMachineDays: machine.idle };
}

/** Ay havuzlarını o ayın FATURALANAN satırlarına dağıtır (satırı yerinde günceller) ve ay özetini döner. */
async function applyPools(
  rows: ProfitabilityRow[],
  ctx: {
    settings: ProfitabilityResult["settings"]; finance: NonNullable<Awaited<ReturnType<typeof loadProfitabilityFinance>>>;
    fromMonth: string; toMonth: string; start: Date; end: Date; idle: IdleMachineDay[];
  },
): Promise<ProfitMonthSummary[]> {
  const { settings, finance, fromMonth, toMonth, start, end, idle } = ctx;
  const monthList: string[] = [];
  for (let m = fromMonth; m <= toMonth; m = nextMonth(m)) monthList.push(m);
  const cells = await finance.readExpenseCells(start, end, Object.keys(settings.categoryClasses));
  const pools = buildMonthPools(monthList, cells, settings.categoryClasses);
  const bounds = monthList.map((m) => ({ month: m, start: factoryDayStartOfKey(`${m}-01`), end: factoryDayStartOfKey(`${nextMonth(m)}-01`) }));
  const pieces = await readMonthAllocations((await readFinanceExpenseAllocationField()) !== "OFF", finance.readExpenseAllocationPieces, bounds, Object.keys(settings.categoryClasses));
  const workOrderOf = await workOrderOfSteps(pieces, rows.map((r) => r.workOrderStepId));
  return monthList.map((month) => {
    const p = pools.get(month)!;
    const monthPieces = pieces.get(month);
    if (monthPieces) deductFromPools(p, monthPieces, settings.categoryClasses);
    const target = rows.filter((r) => r.month === month && r.kind === "INVOICED");
    const labor = distributePool(p.laborPoolTry, target.map((r) => r.machineHours ?? D0()));
    const overhead = settings.overheadKey === "YOK" ? null : distributePool(p.overheadPoolTry, target.map((r) => overheadBase(settings.overheadKey as Exclude<ProfitOverheadKey, "YOK">, r)));
    target.forEach((r, i) => {
      if (labor) r.laborTry = labor[i]!;
      if (overhead) r.overheadTry = overhead[i]!;
      if (labor || overhead) r.netTry = r.contributionTry === null ? null : r.contributionTry.minus(r.laborTry).minus(r.overheadTry);
    });
    const direct = monthPieces ? attachDirectExpenses(target, monthPieces, settings.categoryClasses, workOrderOf) : undefined;
    if (direct) for (const r of target) if (r.directExpenseTry && r.contributionTry !== null) r.netTry = r.contributionTry.minus(r.laborTry).minus(r.overheadTry).minus(r.directExpenseTry);
    const idleHere = idle.filter((d) => d.month === month);
    return {
      month, overheadPoolTry: p.overheadPoolTry, overheadDistributedTry: overhead ? p.overheadPoolTry : D0(),
      laborPoolTry: p.laborPoolTry, laborDistributedTry: labor ? p.laborPoolTry : D0(), excludedTry: p.excludedTry,
      idleMachineHours: idleHere.reduce((a, d) => a.plus(d.hours), D0()),
      idleMachineTry: idleHere.some((d) => d.costTry === null) ? null : idleHere.reduce((a, d) => a.plus(d.costTry!), D0()),
      categories: p.categories, ...(direct ? { directExpenses: direct } : {}),
    };
  });
}

export type ProfitGroupBy = "customer" | "serviceItem" | "month" | "machine";

export interface ProfitSummary {
  key: string | null;
  revenueTry: Prisma.Decimal;
  consumableTry: Prisma.Decimal | null;
  subcontractTry: Prisma.Decimal | null;
  machineTry: Prisma.Decimal | null;
  /** Grupta eksikli satır varsa `null` ("eksik" rozeti; 0 değil). */
  contributionTry: Prisma.Decimal | null;
  laborTry: Prisma.Decimal;
  overheadTry: Prisma.Decimal;
  /** D4-G2c: grupta doğrudan masraflı satır varsa toplamı (yoksa alan yok). */
  directExpenseTry?: Prisma.Decimal;
  netTry: Prisma.Decimal | null;
  missingRows: number;
  estimatedRows: number;
}

/** Satırları kırılıma toplar (yalnız `rows`; taslak ayrı kolon olarak çağıranda). Eksik tek satır grubu `null` yapar. */
export function summarizeProfitability(rows: ProfitabilityRow[], by: ProfitGroupBy): ProfitSummary[] {
  const keyOf = (r: ProfitabilityRow) => (by === "customer" ? r.customerId : by === "serviceItem" ? r.serviceItemId : by === "month" ? r.month : r.machineId);
  const groups = new Map<string | null, ProfitSummary>();
  const add = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) => (a === null || b === null ? null : a.plus(b));
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k) ?? {
      key: k, revenueTry: D0(), consumableTry: D0(), subcontractTry: D0(), machineTry: D0(), contributionTry: D0(),
      laborTry: D0(), overheadTry: D0(), netTry: D0(), missingRows: 0, estimatedRows: 0,
    };
    g.revenueTry = g.revenueTry.plus(r.revenueTry);
    g.consumableTry = add(g.consumableTry, r.consumableTry);
    g.subcontractTry = add(g.subcontractTry, r.subcontractTry);
    g.machineTry = add(g.machineTry, r.machineTry);
    g.contributionTry = add(g.contributionTry, r.contributionTry);
    g.laborTry = g.laborTry.plus(r.laborTry);
    g.overheadTry = g.overheadTry.plus(r.overheadTry);
    g.netTry = add(g.netTry, r.netTry);
    if (r.directExpenseTry) g.directExpenseTry = (g.directExpenseTry ?? D0()).plus(r.directExpenseTry);
    if (r.missing.length > 0) g.missingRows++;
    if (r.subcontractEstimated) g.estimatedRows++;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => String(a.key ?? "").localeCompare(String(b.key ?? "")));
}
