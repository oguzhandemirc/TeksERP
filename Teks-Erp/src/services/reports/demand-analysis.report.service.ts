// =============================================================================
// TALEP ANALİZİ — "hangi kumaş-renk-en isteniyor, ne zaman"
// =============================================================================
// Amaç stoğa üretim kararı: fabrika ağırlıkla stoka üretiyor ve neyi üreteceğini
// bugün hafızadan seçiyor. Bu rapor talebi ÜÇLÜ SPEC düzeyinde (kumaş + renk +
// en) sıralar — çünkü depodaki mal ancak birebir aynı spec'i karşılar; kumaş
// düzeyinde "çok isteniyor" demek yanlış rengi üretmeye yol açar.
//
// ⚠️ Mevcut "Müşteri Sipariş Profili" raporu ile KARIŞTIRMA: o, tek müşterinin
// favorilerini gösterir (müşteri bazlı). Bu, FABRİKA GENELİ talebi gösterir.
// İkisi farklı soruları cevaplar ve toplamları birbirini tutmak zorunda değildir.
//
// ── MEVSİMSELLİK: AY BAZLI, dönemden BAĞIMSIZ ──────────────────────────────
// "Hangi ay hangi kumaş" sorusu seçili tarih aralığına sıkıştırılamaz — 30
// günlük pencerede mevsim yoktur. Aylık seri bu yüzden SON 24 AYI okur ve
// ekranda öyle etiketlenir (iki zaman kapsamı; Müşteri Karnesi'ndeki ayrımın
// aynısı).
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { attachPrev, buildBreakdown, pctOf, round1, type BreakdownDim, type BreakdownRow } from "./_breakdown";
import { factoryMonthSql } from "../../constants/time";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";
import { customerScopeSql, customerScopeWhere, lineScopeSql, lineScopeWhere, type ReportFilterInput } from "./_filters";

/** Mevsimsellik penceresi (ay). Dönemden bağımsız — başlıktaki gerekçe. */
const SEASONALITY_MONTHS = 24;
/** Spec listesi tavanı — `DetailTable` sanallaştırma yapmaz. Aşım GİZLENMEZ. */
const MAX_SPECS = 300;

export interface DemandSpecRow {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: number | null;
  /** Bu spec'i isteyen kalem adedi. */
  lineCount: number;
  /** Bu spec'i isteyen farklı müşteri sayısı — "tek müşteri kaprisi mi" ayrımı. */
  customerCount: number;
  qty: number;
  sharePct: number;
  prevQty?: number;
}

export interface DemandAnalysisSummary {
  totalQty: number;
  lineCount: number;
  /** Farklı kumaş-renk-en üçlüsü sayısı — çeşitlilik göstergesi. */
  specCount: number;
  itemCount: number;
  colorCount: number;
  /** Metrajın %80'ini taşıyan spec sayısı (üretim odağı). */
  coreSpecCount: number;
  /** Rengi belirtilmemiş talep — ham/serbest boyanacak. */
  colorlessQty: number;
  prevTotalQty?: number;
  specsOmitted: number;
}

export interface DemandAnalysisReport {
  summary: DemandAnalysisSummary;
  specs: DemandSpecRow[];
  byItem: BreakdownRow[];
  byColor: BreakdownRow[];
  /** Ay bazlı seri — SON 24 AY, seçili dönemden bağımsız. */
  monthly: Array<{ month: string; qty: number; lineCount: number }>;
}

interface LineCell {
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: Prisma.Decimal | null;
  customerId: string;
  qty: number;
}

const dims = {
  item: {
    keyOf: (c: LineCell) => c.itemId,
    labelOf: (c: LineCell) => c.itemName,
    countOf: () => 1,
    qtyOf: (c: LineCell) => c.qty,
  } satisfies BreakdownDim<LineCell>,
  color: {
    keyOf: (c: LineCell) => c.colorId ?? "__NO_COLOR__",
    labelOf: (c: LineCell) => c.colorName ?? "Renk belirtilmemiş",
    countOf: () => 1,
    qtyOf: (c: LineCell) => c.qty,
  } satisfies BreakdownDim<LineCell>,
};

/** Spec anahtarı — depo eşleşmesiyle AYNI üçlü (üretim dengesi emsali). */
const specKey = (c: LineCell) =>
  `${c.itemId}|${c.colorId ?? "-"}|${c.width == null ? "-" : c.width.toString()}`;

async function collect(range: DateRange, f: ReportFilterInput): Promise<LineCell[]> {
  const lines = await prisma.orderLine.findMany({
    where: {
      order: {
        orderDate: { gte: range.from, lte: range.to },
        status: { not: "CANCELLED" },
        ...customerScopeWhere(f),
      },
      // İptal edilmiş kalem talep DEĞİLDİR — stoğa üretim kararı ona dayanamaz.
      ...ACTIVE_LINE,
      ...lineScopeWhere(f),
    },
    select: {
      quantity: true,
      width: true,
      itemId: true,
      item: { select: { name: true } },
      colorId: true,
      color: { select: { name: true, hex: true } },
      order: { select: { customerId: true } },
    },
  });
  return lines.map((l) => ({
    itemId: l.itemId,
    itemName: l.item.name,
    colorId: l.colorId,
    colorName: l.color?.name ?? null,
    colorHex: l.color?.hex ?? null,
    width: l.width,
    customerId: l.order.customerId,
    qty: Number(l.quantity),
  }));
}

/**
 * Aylık seri. Gruplama `factoryMonthSql` ile — saat dilimi literali çağıran
 * tarafa kopyalanmaz (tek kaynak `constants/time.ts`; bekçi o kopyayı yakalar).
 */
async function collectMonthly(f: ReportFilterInput): Promise<Array<{ month: string; qty: number; lineCount: number }>> {
  const rows = await prisma.$queryRaw<Array<{ month: Date; qty: number | null; lineCount: bigint }>>(Prisma.sql`
    SELECT ${factoryMonthSql('o."orderDate"')} AS month,
           COALESCE(SUM(ol.quantity), 0)::float8  AS qty,
           COUNT(ol.id)                           AS "lineCount"
    FROM orders o
    -- aktif-kalem: iptal edilmiş kalem talep değildir (Prisma tarafındaki
    -- ACTIVE_LINE'ın ham SQL karşılığı — aylık seri de aynı kümeyi saymalı,
    -- aksi halde spec listesiyle grafik ayrışır).
    JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL ${lineScopeSql(f)}
    WHERE o.status <> 'CANCELLED' ${customerScopeSql(f)}
      -- tz-ok: "son N ay" MUTLAK bir penceredir (iki an arası fark), takvim
      -- günü sorusu değil; gruplama ayrıca factoryMonthSql ile yapılıyor.
      AND o."orderDate" >= (now() - (${SEASONALITY_MONTHS} || ' months')::interval)
    GROUP BY 1
    ORDER BY 1
  `);
  return rows.map((r) => ({
    month: r.month.toISOString().slice(0, 7),
    qty: round1(r.qty ?? 0),
    lineCount: Number(r.lineCount),
  }));
}

export async function getDemandAnalysis(
  range: DateRange,
  compareRange: DateRange | null = null,
  filters: ReportFilterInput = {},
): Promise<DemandAnalysisReport> {
  const [cells, monthly, prevCells] = await Promise.all([
    collect(range, filters),
    collectMonthly(filters),
    compareRange ? collect(compareRange, filters) : Promise.resolve(null),
  ]);

  const totalQty = round1(cells.reduce((s, c) => s + c.qty, 0));

  // Spec toplamı — müşteri sayısı için Set (aynı müşteri iki kalem verirse 1 sayılsın).
  const specMap = new Map<
    string,
    Omit<DemandSpecRow, "sharePct" | "prevQty"> & { customers: Set<string> }
  >();
  for (const c of cells) {
    const key = specKey(c);
    let s = specMap.get(key);
    if (!s) {
      s = {
        key,
        itemId: c.itemId,
        itemName: c.itemName,
        colorId: c.colorId,
        colorName: c.colorName,
        colorHex: c.colorHex,
        width: c.width == null ? null : Number(c.width),
        lineCount: 0,
        customerCount: 0,
        qty: 0,
        customers: new Set(),
      };
      specMap.set(key, s);
    }
    s.lineCount++;
    s.qty += c.qty;
    s.customers.add(c.customerId);
  }

  const prevSpecQty = new Map<string, number>();
  if (prevCells) {
    for (const c of prevCells) {
      prevSpecQty.set(specKey(c), (prevSpecQty.get(specKey(c)) ?? 0) + c.qty);
    }
  }

  const allSpecs: DemandSpecRow[] = [...specMap.values()]
    .map((s) => ({
      key: s.key,
      itemId: s.itemId,
      itemName: s.itemName,
      colorId: s.colorId,
      colorName: s.colorName,
      colorHex: s.colorHex,
      width: s.width,
      lineCount: s.lineCount,
      customerCount: s.customers.size,
      qty: round1(s.qty),
      sharePct: pctOf(s.qty, totalQty),
      ...(prevCells ? { prevQty: round1(prevSpecQty.get(s.key) ?? 0) } : {}),
    }))
    // Deterministik: metraj DESC → kalem DESC → ad (aynı istek aynı dosyayı üretsin).
    .sort(
      (a, b) =>
        b.qty - a.qty ||
        b.lineCount - a.lineCount ||
        a.itemName.localeCompare(b.itemName, "tr") ||
        (a.colorName ?? "").localeCompare(b.colorName ?? "", "tr"),
    );

  // Metrajın %80'ini taşıyan spec sayısı — "kaç ürünü stoklarsam talebin
  // dörtte üçünü karşılarım" sorusunun cevabı.
  let cum = 0;
  let coreSpecCount = 0;
  for (const s of allSpecs) {
    if (cum >= 80) break;
    cum += s.sharePct;
    coreSpecCount++;
  }

  const byItem = buildBreakdown(cells, dims.item);
  const byColor = buildBreakdown(cells, dims.color);
  if (prevCells) {
    attachPrev(byItem, prevCells, dims.item);
    attachPrev(byColor, prevCells, dims.color);
  }

  return {
    summary: {
      totalQty,
      lineCount: cells.length,
      specCount: allSpecs.length,
      itemCount: new Set(cells.map((c) => c.itemId)).size,
      colorCount: new Set(cells.filter((c) => c.colorId).map((c) => c.colorId)).size,
      coreSpecCount,
      colorlessQty: round1(cells.filter((c) => !c.colorId).reduce((s, c) => s + c.qty, 0)),
      ...(prevCells
        ? { prevTotalQty: round1(prevCells.reduce((s, c) => s + c.qty, 0)) }
        : {}),
      specsOmitted: Math.max(0, allSpecs.length - MAX_SPECS),
    },
    specs: allSpecs.slice(0, MAX_SPECS),
    byItem,
    byColor,
    monthly,
  };
}
