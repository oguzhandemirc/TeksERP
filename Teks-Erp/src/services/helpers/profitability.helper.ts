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
// Modül: maliyet KAPALI → null, tabloya sorgu yok; finans kapalı → null (gelir faturadan; maliyet-bridge emsali).
// =============================================================================
import { InvoiceStatus, Prisma, ServiceMeterBasis } from "@prisma/client";
import { factoryDayStartOfKey, factoryYmd } from "../../constants/time";
import { AppError } from "../../utils/app-error";
import {
  readCostProfitConsumablePriceSource,
  readCostProfitSubcontractSource,
  readMaliyetEnabled,
  type ProfitConsumablePriceSource,
  type ProfitSubcontractSource,
} from "../system-setting.service";
import { loadProfitabilityFinance } from "./maliyet-bridge.helper";
import { computeWorkCosts, type ProfitMissingCode } from "./profitability-cost.helper";
import type { RevenueInvoiceRow, RevenueLinkRow } from "./profitability-finance.helper";

export type { ProfitMissingCode } from "./profitability-cost.helper";

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
  /** Gelir − sarf − dış fason; herhangi biri eksikse `null`. Taslakta hep `null` (kâra girmez). */
  contributionTry: Prisma.Decimal | null;
  missing: ProfitMissingCode[];
}

export interface ProfitabilityResult {
  fromMonth: string;
  toMonth: string;
  settings: { subcontractSource: ProfitSubcontractSource; consumablePriceSource: ProfitConsumablePriceSource };
  rows: ProfitabilityRow[];
  draftRows: ProfitabilityRow[];
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
  const settings = { subcontractSource: await readCostProfitSubcontractSource(), consumablePriceSource: await readCostProfitConsumablePriceSource() };
  const start = factoryDayStartOfKey(`${fromMonth}-01`);
  const end = factoryDayStartOfKey(`${nextMonth(toMonth)}-01`);
  const invoices = await finance.readServiceRevenueInvoices(start, end);
  const inRange = (at: Date | null) => at !== null && at.getTime() >= start.getTime() && at.getTime() < end.getTime();

  const linkById = new Map<string, RevenueLinkRow>();
  for (const inv of invoices) for (const l of inv.links) linkById.set(l.id, l);
  const costs = await computeWorkCosts({ ...settings, finance }, [...linkById.values()]);

  const rows: ProfitabilityRow[] = [];
  const draftRows: ProfitabilityRow[] = [];
  for (const inv of invoices) {
    const revenue = revenueByLink(inv);
    const emit = (kind: ProfitRowKind, month: string, sign: 1 | -1) => {
      for (const l of inv.links) {
        const r = revenue.get(l.id)!;
        const c = costs.get(l.id)!;
        const neg = (d: Prisma.Decimal | null) => (d === null ? null : sign === 1 ? d : d.neg());
        const missing = [...r.missing, ...c.missing];
        // Gelir satırı eksikse (GELIR_SATIRI) gelir 0 taşır ama katkı uydurulmaz → null.
        const contribution = kind === "DRAFT" || r.missing.length > 0 || c.consumableTry === null || c.subcontractTry === null
          ? null
          : r.revenueTry.minus(c.consumableTry).minus(c.subcontractTry);
        (kind === "DRAFT" ? draftRows : rows).push({
          month, kind, invoiceId: inv.id, docNo: inv.docNo, linkId: l.id, customerId: l.ownerCustomerId ?? inv.cariCustomerId,
          rollId: l.rollId, serviceItemId: l.serviceItemId, workOrderStepId: l.workOrderStepId, machineId: l.machineId,
          meterBasis: l.meterBasis, meters: sign === 1 ? l.billedMeters : l.billedMeters.neg(),
          revenueTry: neg(r.revenueTry)!, consumableTry: neg(c.consumableTry), subcontractTry: neg(c.subcontractTry),
          subcontractEstimated: c.subcontractEstimated, contributionTry: neg(contribution), missing,
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
  return { fromMonth, toMonth, settings, rows, draftRows };
}

export type ProfitGroupBy = "customer" | "serviceItem" | "month" | "machine";

export interface ProfitSummary {
  key: string | null;
  revenueTry: Prisma.Decimal;
  consumableTry: Prisma.Decimal | null;
  subcontractTry: Prisma.Decimal | null;
  /** Grupta eksikli satır varsa `null` ("eksik" rozeti; 0 değil). */
  contributionTry: Prisma.Decimal | null;
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
    const g = groups.get(k) ?? { key: k, revenueTry: D0(), consumableTry: D0(), subcontractTry: D0(), contributionTry: D0(), missingRows: 0, estimatedRows: 0 };
    g.revenueTry = g.revenueTry.plus(r.revenueTry);
    g.consumableTry = add(g.consumableTry, r.consumableTry);
    g.subcontractTry = add(g.subcontractTry, r.subcontractTry);
    g.contributionTry = add(g.contributionTry, r.contributionTry);
    if (r.missing.length > 0) g.missingRows++;
    if (r.subcontractEstimated) g.estimatedRows++;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => String(a.key ?? "").localeCompare(String(b.key ?? "")));
}
