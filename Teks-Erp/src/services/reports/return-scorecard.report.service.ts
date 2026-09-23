// =============================================================================
// İADE KARNESİ — "ne kadar geri geldi, kimden ve neden"
// =============================================================================
// `RollReturn` tablosu 2026-06'dan beri zengin veri taşıyor (neden, müşteri,
// kumaş, renk, metraj, kalite) ama Raporlar altında HİÇBİR yüzeyi yoktu: veri
// yalnız muhasebe Excel'inin bir sayfasında ve sevkiyat detayında görünüyordu.
// Tekstilde iade oranı + nedeni kalite geri-beslemesinin ana kaynağıdır.
//
// ── ÇIPA: `RollReturn.createdAt` ────────────────────────────────────────────
// Gerçek bir olay damgası (iadenin teslim alındığı an). İptal edilmiş iadeler
// (`cancelledAt IS NOT NULL`) HER YERDE dışlanır — yanlış kabul edilip geri
// alınmış bir iade hiç olmamıştır.
//
// ── PAYDA BRÜT'TÜR — kök CLAUDE.md kuralının BEŞİNCİ tüketicisi ─────────────
// "Dönemde sevk edilen metraj" hesaplanırken `RollReturn` satırları GERİ EKLENİR.
// Sebep: iade, topun `shipmentId`'sini NULL'lar (`return.service.ts:322-325`) →
// canlı sorgu NET okur. Net paydayla oran ŞİŞER (iade/(sevk−iade) > iade/sevk)
// ve tam da en çok iade alınan dönemde en çok şişer. Kaynak `RollReturn`'dür,
// snapshot DEĞİL — `attachTotals`, `accounting-export`, `getShipmentById` ve
// `collectShipmentDocContent` de aynı kaynağı seçti; beşinci bir kaynak beşinci
// bir rakam demekti.
//
// ⚠️ İKİ KÜMENİN KAPSAMI BİLİNÇLİ OLARAK FARKLI ve bu bir hata değildir: pay
// *dönemde İADE ALINAN*, payda *dönemde SEVK EDİLEN*. Temmuzda iade edilen bir
// haziran sevkiyatı temmuzun payına girer, paydasına girmez. Bu, sektörün
// standart "iade oranı" tanımıdır (kohort oranı DEĞİL) ve ekranda böyle
// yazılır — aksi halde kullanıcı rakamı kohort sanıp yanlış okur.
//
// ── DOĞRUDAN SEVKLER DE PAYDAYA GİRER ──────────────────────────────────────
// `DirectShipment` (fasondan doğrudan müşteriye) ayrı tablodur ve metrajı
// denormalize (`totalQty`). Dışarıda bırakmak paydayı küçültüp oranı şişirirdi.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { attachPrev, buildBreakdown, pctOf, round1, type BreakdownDim, type BreakdownRow } from "./_breakdown";
import { factoryDaySql } from "../../constants/time";
import { shippedGrossTotal, type ShippedFilter } from "./_shipped";
import { shipmentDestinationSql } from "./_destination";

// ---------- Tipler -----------------------------------------------------------

export interface ReturnScorecardSummary {
  returnQty: number;
  returnRollCount: number;
  /** Aynı dönemde sevk edilen BRÜT metraj (iade geri eklenmiş). */
  shippedQty: number;
  /** returnQty / shippedQty (%). Kohort oranı DEĞİL — dosya başlığına bak. */
  returnPct: number;
  /** Sebebi katalogdan seçilmemiş iade adedi — veri kalitesi sinyali. */
  freeTextReasonCount: number;
  missingReasonCount: number;
  prevReturnQty?: number;
  prevReturnPct?: number;
  prevShippedQty?: number;
}

export interface ReturnScorecard {
  summary: ReturnScorecardSummary;
  byCustomer: BreakdownRow[];
  byReason: BreakdownRow[];
  byItem: BreakdownRow[];
  byColor: BreakdownRow[];
  daily: Array<{ day: string; qty: number; count: number }>;
}

// ---------- Ham toplama ------------------------------------------------------

interface ReturnCell {
  customerId: string;
  customerName: string;
  reasonKey: string;
  reasonLabel: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  count: number;
  qty: number;
}

const REASON_FREE = "__FREE_TEXT__";
const REASON_NONE = "__NO_REASON__";

/** Yön süzgeci iadenin GELDİĞİ sevkiyatın donmuş yönüdür; sevkiyatsız iade o kümeye girmez. */
async function collectReturns(range: DateRange, f: ShippedFilter = {}): Promise<ReturnCell[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      customerId: string;
      customerName: string;
      reasonKey: string;
      reasonLabel: string;
      itemId: string;
      itemName: string;
      colorId: string | null;
      colorName: string | null;
      count: bigint;
      qty: number | null;
    }>
  >(Prisma.sql`
    SELECT
      rr."customerId"  AS "customerId",
      cu.name          AS "customerName",
      -- SEBEP ÜÇ DURUMLUDUR ve üçü de ayrı raporlanır:
      --   katalogdan seçilmiş · serbest metin yazılmış · hiç girilmemiş.
      -- Serbest metinler TEK kovada toplanır: her farklı yazımı ayrı satır yapmak
      -- ("hasarli", "Hasarlı ", "hasar") kırılımı okunmaz hale getirirdi. Sayının
      -- kendisi bir sinyaldir: yüksekse KATALOG eksiktir (elle sebep dersi,
      -- kök CLAUDE.md 2026-08-04).
      CASE
        WHEN rr."reasonId" IS NOT NULL THEN rr."reasonId"::text
        WHEN COALESCE(TRIM(rr."reasonText"), '') <> '' THEN ${REASON_FREE}
        ELSE ${REASON_NONE}
      END AS "reasonKey",
      CASE
        WHEN rr."reasonId" IS NOT NULL THEN rn.name
        WHEN COALESCE(TRIM(rr."reasonText"), '') <> '' THEN 'Serbest metin (katalog dışı)'
        ELSE 'Sebep girilmemiş'
      END AS "reasonLabel",
      rr."itemId"      AS "itemId",
      i.name           AS "itemName",
      rr."colorId"     AS "colorId",
      c.name           AS "colorName",
      COUNT(*)         AS "count",
      SUM(rr.qty)::float AS "qty"
    FROM roll_returns rr
    JOIN customers cu            ON cu.id = rr."customerId"
    JOIN items i                 ON i.id  = rr."itemId"
    LEFT JOIN colors c           ON c.id  = rr."colorId"
    LEFT JOIN return_reasons rn  ON rn.id = rr."reasonId"
    WHERE rr."createdAt" >= ${range.from}
      AND rr."createdAt" <= ${range.to}
      AND rr."cancelledAt" IS NULL
      ${f.destination ? Prisma.sql`AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = rr."fromShipmentId" ${shipmentDestinationSql(f.destination, "s")})` : Prisma.empty}
    GROUP BY rr."customerId", cu.name, rr."reasonId", rn.name, rr."reasonText",
             rr."itemId", i.name, rr."colorId", c.name
  `);

  return rows.map((r) => ({
    customerId: r.customerId,
    customerName: r.customerName,
    reasonKey: r.reasonKey,
    reasonLabel: r.reasonLabel,
    itemId: r.itemId,
    itemName: r.itemName,
    colorId: r.colorId,
    colorName: r.colorName,
    count: Number(r.count),
    qty: Number(r.qty ?? 0),
  }));
}

// Payda `_shipped.ts`'ten gelir — Sevk & Termin Karnesi'nin başlık metriğiyle
// AYNI TANIM. Burada ikinci bir hesap yazmak, aynı ay için iki farklı sevk
// rakamı üretirdi (dosya başlığındaki brüt kuralının ta kendisi).

// ---------- Ana giriş --------------------------------------------------------

const dims = {
  customer: {
    keyOf: (c: ReturnCell) => c.customerId,
    labelOf: (c: ReturnCell) => c.customerName,
    countOf: (c: ReturnCell) => c.count,
    qtyOf: (c: ReturnCell) => c.qty,
  } satisfies BreakdownDim<ReturnCell>,
  reason: {
    keyOf: (c: ReturnCell) => c.reasonKey,
    labelOf: (c: ReturnCell) => c.reasonLabel,
    countOf: (c: ReturnCell) => c.count,
    qtyOf: (c: ReturnCell) => c.qty,
  } satisfies BreakdownDim<ReturnCell>,
  item: {
    keyOf: (c: ReturnCell) => c.itemId,
    labelOf: (c: ReturnCell) => c.itemName,
    countOf: (c: ReturnCell) => c.count,
    qtyOf: (c: ReturnCell) => c.qty,
  } satisfies BreakdownDim<ReturnCell>,
  color: {
    keyOf: (c: ReturnCell) => c.colorId ?? "__NOCOLOR__",
    labelOf: (c: ReturnCell) => c.colorName ?? "Renksiz / Ham",
    countOf: (c: ReturnCell) => c.count,
    qtyOf: (c: ReturnCell) => c.qty,
  } satisfies BreakdownDim<ReturnCell>,
};

export async function getReturnScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
  f: ShippedFilter = {},
): Promise<ReturnScorecard> {
  const [cells, shipped, dailyRows, prevCells, prevShipped] = await Promise.all([
    collectReturns(range, f),
    shippedGrossTotal(range, f),
    prisma.$queryRaw<Array<{ day: Date; qty: number | null; cnt: bigint }>>(Prisma.sql`
      SELECT ${factoryDaySql('rr."createdAt"')} AS day,
             SUM(rr.qty)::float                 AS qty,
             COUNT(*)                           AS cnt
      FROM roll_returns rr
      WHERE rr."createdAt" >= ${range.from} AND rr."createdAt" <= ${range.to}
        AND rr."cancelledAt" IS NULL
        ${f.destination ? Prisma.sql`AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = rr."fromShipmentId" ${shipmentDestinationSql(f.destination, "s")})` : Prisma.empty}
      GROUP BY 1 ORDER BY 1
    `),
    compareRange ? collectReturns(compareRange, f) : Promise.resolve<ReturnCell[]>([]),
    compareRange ? shippedGrossTotal(compareRange, f) : Promise.resolve(0),
  ]);

  const returnQty = cells.reduce((a, c) => a + c.qty, 0);
  const returnRollCount = cells.reduce((a, c) => a + c.count, 0);

  const byCustomer = buildBreakdown(cells, dims.customer);
  const byReason = buildBreakdown(cells, dims.reason);
  const byItem = buildBreakdown(cells, dims.item);
  const byColor = buildBreakdown(cells, dims.color);

  if (compareRange) {
    attachPrev(byCustomer, prevCells, dims.customer);
    attachPrev(byReason, prevCells, dims.reason);
    attachPrev(byItem, prevCells, dims.item);
    attachPrev(byColor, prevCells, dims.color);
  }

  const summary: ReturnScorecardSummary = {
    returnQty: round1(returnQty),
    returnRollCount,
    shippedQty: round1(shipped),
    returnPct: pctOf(returnQty, shipped),
    freeTextReasonCount: cells.filter((c) => c.reasonKey === REASON_FREE).reduce((a, c) => a + c.count, 0),
    missingReasonCount: cells.filter((c) => c.reasonKey === REASON_NONE).reduce((a, c) => a + c.count, 0),
  };
  if (compareRange) {
    const prevQty = prevCells.reduce((a, c) => a + c.qty, 0);
    summary.prevReturnQty = round1(prevQty);
    summary.prevShippedQty = round1(prevShipped);
    summary.prevReturnPct = pctOf(prevQty, prevShipped);
  }

  return {
    summary,
    byCustomer,
    byReason,
    byItem,
    byColor,
    daily: dailyRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      qty: round1(Number(r.qty ?? 0)),
      count: Number(r.cnt),
    })),
  };
}
