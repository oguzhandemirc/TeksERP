// =============================================================================
// KÜP `sevk` — dönemde sevk edilen mal (R1-SEMCEK, ilk küp)
// =============================================================================
// Metre YALNIZ `_shipped.ts` boğazından gelir (BRÜT: iade geri-eklenir, doğrudan sevk dahil);
// ikinci bir brüt tanım YASAK (kök CLAUDE.md). Tutar mevcut `_destination-mix-money.ts`
// toplayıcısına bağlı helper ölçüdür: para birimleri ayrı kalır, fiyatsız satır 0 sayılmaz.
// İzin: tutar bugün Yurtiçi/Yurtdışı Satış'ta `report:sales` ile görünür (ölçüldü:
// `sales.routes.ts` /destination-mix guard'ı) — aynı izin taşınır, finans kapısı eklenmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../../../lib/prisma";
import { factoryDaySql, factoryMonthSql, factoryWeekSql } from "../../../../constants/time";
import { shippedPartsSql } from "../../_shipped";
import { aggregateMoney, collectMoneyRows, type MoneyRow } from "../../_destination-mix-money";
import type { HelperInput, HelperResult, HelperRow, SemanticCube, SemanticDimension } from "../tipler";
import { applyMemoryFilters, capMemoryGroups } from "../bellek-kirilim";

const SALES_PERMISSION = "report:sales";
const SALES_MODULE = "cekirdek:siparis-musteri";
const DEFAULT_CAP = 50;

const dimensions: SemanticDimension[] = [
  { id: "gun", name: "Gün", kind: "time", keySql: factoryDaySql("p.at"), valueType: "date", cardinalityCap: 0 },
  { id: "hafta", name: "Hafta", kind: "time", keySql: factoryWeekSql("p.at"), valueType: "date", cardinalityCap: 0 },
  { id: "ay", name: "Ay", kind: "time", keySql: factoryMonthSql("p.at"), valueType: "date", cardinalityCap: 0 },
  {
    id: "musteri", name: "Müşteri", kind: "category", valueType: "uuid", cardinalityCap: DEFAULT_CAP,
    keySql: Prisma.sql`p."customerId"`, labelSql: Prisma.sql`dm_cu.name`,
    joins: Prisma.sql`LEFT JOIN customers dm_cu ON dm_cu.id = p."customerId"`,
  },
  {
    id: "kumas", name: "Kumaş", kind: "category", valueType: "uuid", cardinalityCap: DEFAULT_CAP,
    keySql: Prisma.sql`p."itemId"`, labelSql: Prisma.sql`dm_it.name`,
    joins: Prisma.sql`LEFT JOIN items dm_it ON dm_it.id = p."itemId"`,
  },
  {
    id: "renk", name: "Renk", kind: "category", valueType: "uuid", cardinalityCap: DEFAULT_CAP,
    keySql: Prisma.sql`p."colorId"`, labelSql: Prisma.sql`dm_co.name`,
    joins: Prisma.sql`LEFT JOIN colors dm_co ON dm_co.id = p."colorId"`,
  },
  {
    id: "yon", name: "Yön", kind: "category", valueType: "enum", enumValues: ["DOMESTIC", "EXPORT"], cardinalityCap: DEFAULT_CAP,
    keySql: Prisma.sql`p.destination::text`,
    labelSql: Prisma.sql`(CASE p.destination WHEN 'DOMESTIC' THEN 'Yurtiçi' WHEN 'EXPORT' THEN 'Yurtdışı' ELSE 'Yön kaydı yok' END)`,
  },
];

/** Tahsis satırından boyut değeri — helper ölçünün desteklediği üç boyut. */
function moneyKey(dimensionId: string, r: MoneyRow): string | null {
  if (dimensionId === "musteri") return r.customerId;
  if (dimensionId === "kumas") return r.itemId;
  return r.bucket === "NONE" ? null : r.bucket;
}

async function computeShippedAmount(input: HelperInput): Promise<HelperResult> {
  const all = await collectMoneyRows(input.range);
  const rows = applyMemoryFilters(all, input.filters, moneyKey);
  const groups = capMemoryGroups(rows, { dimensions: input.dimensions, key: moneyKey, weight: (r) => r.qty, cap: input.cap });
  const labels = await loadMoneyLabels(rows);
  const out: HelperRow[] = [];
  for (const g of groups) {
    for (const a of aggregateMoney(g.rows).amounts) {
      const keys: HelperRow["keys"] = {};
      for (const d of input.dimensions) {
        const k = g.keys[d.id]!;
        keys[d.id] = k.other ? { value: null, label: "Diğer", other: true } : { value: k.value, label: labelOf(d.id, k.value, labels) };
      }
      out.push({ keys, currency: a.currency, value: a.amount });
    }
  }
  const total = aggregateMoney(rows);
  const notes: string[] = [];
  const unpriced = total.lineCount - total.pricedLineCount;
  if (unpriced > 0) notes.push(`Fiyatı girilmemiş ${unpriced} sevk satırı tutara girmedi (sıfır sayılmadı).`);
  return { rows: out, totals: total.amounts.map((a) => ({ currency: a.currency, value: a.amount })), notes };
}

interface MoneyLabels { customers: Map<string, string>; items: Map<string, string> }

async function loadMoneyLabels(rows: MoneyRow[]): Promise<MoneyLabels> {
  const customerIds = [...new Set(rows.map((r) => r.customerId))];
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  // Boş kümede sorgu atılmaz (`in: []` yazılmaz).
  const customers = customerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }) : [];
  return { customers: new Map(customers.map((c) => [c.id, c.name])), items: new Map(items.map((i) => [i.id, i.name])) };
}

function labelOf(dimensionId: string, value: string | null, labels: MoneyLabels): string | null {
  if (dimensionId === "yon") return value === "DOMESTIC" ? "Yurtiçi" : value === "EXPORT" ? "Yurtdışı" : "Yön kaydı yok";
  if (value === null) return null;
  return (dimensionId === "musteri" ? labels.customers : labels.items).get(value) ?? null;
}

export const shipmentCube: SemanticCube = {
  id: "sevk",
  name: "Sevk",
  permission: SALES_PERMISSION,
  module: SALES_MODULE,
  source: (range) => Prisma.sql`(${shippedPartsSql(range)}) p`,
  timeColumn: "p.at",
  measures: [
    {
      id: "sevk.brutMetre", permission: SALES_PERMISSION, module: SALES_MODULE, kind: "sum",
      sql: Prisma.sql`SUM(p.qty)::float`,
      parity: { report: "sales/sevkiyat", field: "anaSayi", legacy: "sales/destination-mix" },
    },
    {
      id: "sevk.tutar", permission: SALES_PERMISSION, module: SALES_MODULE, kind: "helper",
      helper: { dimensions: ["musteri", "kumas", "yon"], perCurrency: true, compute: computeShippedAmount },
      parity: { report: "sales/sevkiyat", field: "tutar", legacy: "sales/destination-mix" },
    },
  ],
  dimensions,
  notes: ["Sevk rakamı brüttür: sonradan gelen iade bu sayıyı düşürmez, iade ayrı raporlanır."],
};
