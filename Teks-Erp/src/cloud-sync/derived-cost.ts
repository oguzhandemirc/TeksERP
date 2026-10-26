// TÜRETİLMİŞ ALANLAR — maliyet & teklif projeksiyonları (MAL-8). Fabrika hesaplar, bulut saklar: marj panelin
// `quoteMargin`i, "süresi doldu" teklif listesinin `isQuoteExpired`i, grup toplamları `sumCostGroups` (tek kaynak).
import type { CostComponent, Prisma, SalesQuoteStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { quoteMargin } from "../services/helpers/quote-view.helper";
import { isQuoteExpired, quoteToday } from "../services/helpers/sales-quote-state.helper";
import { sumCostGroups } from "../services/helpers/cost-component-groups.helper";

type RawRow = Record<string, unknown> & { id: string };
type DerivedValues = Map<string, Record<string, unknown>>;

async function names(model: "customer" | "item", keys: readonly unknown[]): Promise<Map<string, string>> {
  const idList = [...new Set(keys.filter((k): k is string => typeof k === "string"))];
  if (idList.length === 0) return new Map();
  const where = { id: { in: idList } };
  const select = { id: true, name: true } as const;
  const found = model === "customer" ? await prisma.customer.findMany({ where, select }) : await prisma.item.findMany({ where, select });
  return new Map(found.map((r) => [r.id, r.name]));
}

async function quoteDerived(rows: readonly RawRow[], nowMs: number): Promise<DerivedValues> {
  const customers = await names("customer", rows.map((r) => r.customerId));
  const today = quoteToday(new Date(nowMs));
  const out: DerivedValues = new Map();
  for (const r of rows) {
    const m = quoteMargin(r);
    out.set(r.id, {
      suresiDoldu: isQuoteExpired({ status: r.status as SalesQuoteStatus, validUntilDate: r.validUntilDate as Date }, today),
      brutMarjPct: m?.marjPct ?? null,
      musteriAdi: customers.get(r.customerId as string) ?? null,
    });
  }
  return out;
}

async function standardCostDerived(rows: readonly RawRow[]): Promise<DerivedValues> {
  const lines = await prisma.standardCostLine.findMany({
    where: { versionId: { in: rows.map((r) => r.id) } },
    select: { versionId: true, component: true, amountPerMTry: true },
  });
  const byVersion = new Map<string, Array<{ component: CostComponent; amountPerMTry: Prisma.Decimal }>>();
  for (const l of lines) byVersion.set(l.versionId, [...(byVersion.get(l.versionId) ?? []), l]);
  const items = await names("item", rows.map((r) => r.itemId));
  const out: DerivedValues = new Map();
  for (const r of rows) out.set(r.id, { ...sumCostGroups(byVersion.get(r.id) ?? []), urunAdi: items.get(r.itemId as string) ?? null });
  return out;
}

export const COST_DERIVERS = { teklif: quoteDerived, "standart-maliyet": standardCostDerived } as const;

/** Türeticinin ham satırdan okuduğu (tel'e girmeyen) kolonlar. */
export const COST_DERIVER_ROW_FIELDS: Readonly<Record<string, readonly string[]>> = {
  teklif: ["status", "validUntilDate", "customerId", "totalAmount", "fxRate", "totalCostTry"],
  "standart-maliyet": ["itemId"],
};
