// =============================================================================
// FİRE KARNESİ — "ne kadar hurda çıktı ve NEDEN"
// =============================================================================
// Kalite Karnesi'nin ikizi: o "ne kadarı 1. kalite", bu "ne kadarı çöp oldu ve
// hangi hata yüzünden". Aynı evren, aynı çıpa (`Roll.finalizedAt`) — yani iki
// karnenin toplam üretim metrajı BİREBİR AYNI çıkar (bekçide kilitli). Ayrışsalardı
// aynı ay için iki farklı "üretim" rakamı dolaşıma girerdi.
//
// ── İKİ AYRI ZAMAN ÇIPASI, İKİ AYRI TABLO — bilinçli ────────────────────────
//   • HURDA metrajı  → `Roll.finalizedAt` ("bu dönemde hurdaya AYRILAN mal")
//   • HATA adedi     → `RollError.detectedAt` ("bu dönemde GÖRÜLEN hata")
// İkisi farklı sorulardır: bugün tespit edilen hata gelecek ay hurdaya dönüşebilir
// (ya da hiç dönüşmez — `NO_CUT`). Tek çıpaya zorlamak birini yanlışlardı.
// Karışmasın diye tablolar farklı BİRİMDE raporlanır: hurda METRE, tespit ADET.
// Toplanabilir görünen iki sayı, toplanmaması gerekiyorsa aynı birimde basılmaz.
//
// ── "KESİM KAYBI" METRİĞİ BİLİNÇLİ OLARAK YOK ──────────────────────────────
// Ölçüldü (2026-08-09, fabrika kopyası): kesimde tüketilen ebeveybin `currentQty`
// SIFIRA çekiliyor ve metraj çocuklara geçiyor. Naif `Σ(initialQty − currentQty)`
// bu yüzden **2522 m'lik hayali bir kayıp** raporlardı. Ebeveyn↔çocuk dengesi de
// tutarlı değil (0 metrajlı ebeveynler, açıklanamayan ±200/−50 m farklar). Bir
// "kayıp" rakamı ancak kimse onu açıklayamıyorsa zararlıdır — modelde bunu
// taşıyacak bir kesim-olayı kaydı doğana kadar bu metrik YAZILMAYACAK.
//
// ── FİRE ≠ "FİRE KALİTESİ" ─────────────────────────────────────────────────
// Bu karne `RollStatus.SCRAP`'ı (mal fiziksel olarak elendi) ölçer. Katalogdaki
// "Fire" ADLI kalite bambaşka bir şeydir ve fabrikanın kendi ayarına bağlıdır —
// canlıda `targetStatus = WAREHOUSE`, yani "Fire" kalitesi verilmiş top DEPODA
// durur, hurda değildir. Kalite dağılımı Kalite Karnesi'nin işidir; burada
// karşılaştırma için yalnız toplam üretim metrajı ortaktır.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { attachPrev, buildBreakdown, pctOf, round1, type BreakdownDim, type BreakdownRow } from "./_breakdown";
import { factoryDaySql } from "../../constants/time";
import { K18_DEAD_STATUSES } from "../batch.service";

// ---------- Tipler -----------------------------------------------------------

export interface ScrapScorecardSummary {
  scrapQty: number;
  scrapRollCount: number;
  /** Dönemde üretimi biten TOPLAM metraj — Kalite Karnesi ile birebir aynı evren. */
  producedQty: number;
  /** Hurda / toplam üretim (%). */
  scrapPct: number;
  /** Dönemde TESPİT edilen hata adedi (ayrı çıpa: detectedAt). */
  defectsDetected: number;
  /** Bunların kaçı hâlâ karara bağlanmamış (Tambur'da bekliyor). */
  defectsOpen: number;
  prevScrapQty?: number;
  prevScrapPct?: number;
  prevDefectsDetected?: number;
}

export interface DefectDetectionRow {
  key: string;
  label: string;
  /** Tespit adedi. */
  count: number;
  /** Kesildi (hata parçası çıkarıldı). */
  cutCount: number;
  /** Hataya rağmen tutuldu. */
  noCutCount: number;
  /** Henüz karara bağlanmadı. */
  openCount: number;
  prevCount?: number;
}

export interface ScrapScorecard {
  summary: ScrapScorecardSummary;
  /** Hurdaya ayrılan topların hata türü kırılımı — METRE (çıpa: finalizedAt). */
  scrapByDefect: BreakdownRow[];
  byItem: BreakdownRow[];
  byColor: BreakdownRow[];
  bySource: BreakdownRow[];
  /** Hatayı TESPİT eden istasyon — ADET (çıpa: detectedAt). */
  detectionByStation: DefectDetectionRow[];
  /** Dönemde tespit edilen hatalar, türe göre — ADET (çıpa: detectedAt). */
  detectionByDefect: DefectDetectionRow[];
  daily: Array<{ day: string; scrapQty: number; scrapCount: number }>;
}

// ---------- Ham toplama ------------------------------------------------------

interface ScrapCell {
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  subId: string | null;
  subName: string | null;
  fromSubcontractor: boolean;
  defectId: string | null;
  defectName: string | null;
  rollCount: number;
  qty: number;
}

const NO_DEFECT_KEY = "__NO_DEFECT__";
const NO_DEFECT_LABEL = "Hata kaydı yok";

/**
 * Hurda topların TEK sorgusu. Hata bağı `LEFT JOIN LATERAL` ile topun İLK
 * hatasından alınır.
 *
 * ⚠️ NEDEN LATERAL + LIMIT 1, neden düz JOIN DEĞİL: bir topta birden çok
 * `RollError` olabilir ve düz JOIN o topun metrajını hata sayısı kadar
 * ÇOĞALTIRDI (2 hatalı 100 m'lik top → 200 m hurda). Metraj topun kendisine
 * aittir, hatasına değil; bu yüzden atıf tek hataya sabitlenir ve seçim
 * deterministiktir (en erken tespit — hurdaya götüren ilk sebep).
 */
async function collectScrap(range: DateRange): Promise<ScrapCell[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      itemId: string;
      itemName: string;
      colorId: string | null;
      colorName: string | null;
      subId: string | null;
      subName: string | null;
      fromSubcontractor: boolean;
      defectId: string | null;
      defectName: string | null;
      rollCount: bigint;
      qty: number | null;
    }>
  >(Prisma.sql`
    SELECT
      r."itemId"                                 AS "itemId",
      i.name                                     AS "itemName",
      r."colorId"                                AS "colorId",
      c.name                                     AS "colorName",
      sr."subcontractorId"                       AS "subId",
      sub.name                                   AS "subName",
      (r."entrySource" = 'SUBCONTRACTOR_RETURN') AS "fromSubcontractor",
      e."defectId"                               AS "defectId",
      e."defectName"                             AS "defectName",
      COUNT(*)                                   AS "rollCount",
      SUM(r."currentQty")::float                 AS "qty"
    FROM rolls r
    JOIN items i                        ON i.id  = r."itemId"
    LEFT JOIN colors c                  ON c.id  = r."colorId"
    LEFT JOIN subcontractor_receipts sr ON sr.id = r."parentReceiptId"
    LEFT JOIN subcontractors sub        ON sub.id = sr."subcontractorId"
    LEFT JOIN LATERAL (
      SELECT re."defectTypeId" AS "defectId",
             COALESCE(dt.name, re."errorType") AS "defectName"
      FROM roll_errors re
      LEFT JOIN defect_types dt ON dt.id = re."defectTypeId"
      WHERE re."rollId" = r.id
      ORDER BY re."detectedAt" ASC
      LIMIT 1
    ) e ON true
    WHERE r.status = 'SCRAP'
      AND r."finalizedAt" >= ${range.from}
      AND r."finalizedAt" <= ${range.to}
    GROUP BY r."itemId", i.name, r."colorId", c.name, sr."subcontractorId", sub.name,
             (r."entrySource" = 'SUBCONTRACTOR_RETURN'), e."defectId", e."defectName"
  `);

  return rows.map((r) => ({
    itemId: r.itemId,
    itemName: r.itemName,
    colorId: r.colorId,
    colorName: r.colorName,
    subId: r.subId,
    subName: r.subName,
    fromSubcontractor: Boolean(r.fromSubcontractor),
    defectId: r.defectId,
    defectName: r.defectName,
    rollCount: Number(r.rollCount),
    qty: Number(r.qty ?? 0),
  }));
}

/** Dönemde üretimi biten TOPLAM metraj — Kalite Karnesi ile aynı evren/kural. */
async function producedTotal(range: DateRange): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ qty: number | null }>>(Prisma.sql`
    SELECT SUM(r."currentQty")::float AS qty
    FROM rolls r
    WHERE r."finalizedAt" >= ${range.from}
      AND r."finalizedAt" <= ${range.to}
      AND r.status::text NOT IN (${Prisma.join(K18_DEAD_STATUSES.map((s) => s as string))})
  `);
  return Number(rows[0]?.qty ?? 0);
}

interface DetectionCell {
  key: string;
  label: string;
  count: number;
  cutCount: number;
  noCutCount: number;
  openCount: number;
}

/** Dönemde TESPİT edilen hatalar — tür ve istasyon kırılımı, tek sorgu. */
async function collectDetections(
  range: DateRange,
): Promise<{ byDefect: DetectionCell[]; byStation: DetectionCell[]; total: number; open: number }> {
  const rows = await prisma.$queryRaw<
    Array<{
      defectKey: string | null;
      defectLabel: string | null;
      stationKey: string | null;
      stationLabel: string | null;
      count: bigint;
      cutCount: bigint;
      noCutCount: bigint;
      openCount: bigint;
    }>
  >(Prisma.sql`
    SELECT
      re."defectTypeId"                       AS "defectKey",
      COALESCE(dt.name, re."errorType")       AS "defectLabel",
      s.id                                    AS "stationKey",
      s.name                                  AS "stationLabel",
      COUNT(*)                                                        AS "count",
      COUNT(*) FILTER (WHERE re."actionTaken" = 'CUT')                AS "cutCount",
      COUNT(*) FILTER (WHERE re."actionTaken" = 'NO_CUT')             AS "noCutCount",
      COUNT(*) FILTER (WHERE re."isProcessed" = false)                AS "openCount"
    FROM roll_errors re
    LEFT JOIN defect_types dt      ON dt.id = re."defectTypeId"
    LEFT JOIN work_order_steps wos ON wos.id = re."detectedAtStepId"
    LEFT JOIN stations s           ON s.id = wos."stationId"
    WHERE re."detectedAt" >= ${range.from} AND re."detectedAt" <= ${range.to}
    GROUP BY re."defectTypeId", COALESCE(dt.name, re."errorType"), s.id, s.name
  `);

  const fold = (
    keyOf: (r: (typeof rows)[number]) => string,
    labelOf: (r: (typeof rows)[number]) => string,
  ): DetectionCell[] => {
    const m = new Map<string, DetectionCell>();
    for (const r of rows) {
      const key = keyOf(r);
      let cell = m.get(key);
      if (!cell) {
        cell = { key, label: labelOf(r), count: 0, cutCount: 0, noCutCount: 0, openCount: 0 };
        m.set(key, cell);
      }
      cell.count += Number(r.count);
      cell.cutCount += Number(r.cutCount);
      cell.noCutCount += Number(r.noCutCount);
      cell.openCount += Number(r.openCount);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "tr"));
  };

  const byDefect = fold(
    (r) => r.defectKey ?? NO_DEFECT_KEY,
    (r) => r.defectLabel ?? "Tanımsız hata",
  );
  const byStation = fold(
    (r) => r.stationKey ?? "__NO_STATION__",
    (r) => r.stationLabel ?? "İstasyon bilinmiyor",
  );
  const total = byDefect.reduce((a, c) => a + c.count, 0);
  const open = byDefect.reduce((a, c) => a + c.openCount, 0);
  return { byDefect, byStation, total, open };
}

// ---------- Ana giriş --------------------------------------------------------

const dims = {
  item: {
    keyOf: (c: ScrapCell) => c.itemId,
    labelOf: (c: ScrapCell) => c.itemName,
    countOf: (c: ScrapCell) => c.rollCount,
    qtyOf: (c: ScrapCell) => c.qty,
  } satisfies BreakdownDim<ScrapCell>,
  color: {
    keyOf: (c: ScrapCell) => c.colorId ?? "__NOCOLOR__",
    labelOf: (c: ScrapCell) => c.colorName ?? "Renksiz / Ham",
    countOf: (c: ScrapCell) => c.rollCount,
    qtyOf: (c: ScrapCell) => c.qty,
  } satisfies BreakdownDim<ScrapCell>,
  // Fason atfı Kalite Karnesi ile AYNI üç kovalı kural — firması çözülemeyen
  // fason topu "Fabrika içi"ne yazılamaz (yanlış atıf, eksik veriden kötüdür).
  source: {
    keyOf: (c: ScrapCell) => c.subId ?? (c.fromSubcontractor ? "__SUB_UNKNOWN__" : "__INHOUSE__"),
    labelOf: (c: ScrapCell) =>
      c.subName ?? (c.fromSubcontractor ? "Fason (firma belirsiz)" : "Fabrika içi"),
    countOf: (c: ScrapCell) => c.rollCount,
    qtyOf: (c: ScrapCell) => c.qty,
  } satisfies BreakdownDim<ScrapCell>,
  defect: {
    keyOf: (c: ScrapCell) => c.defectId ?? NO_DEFECT_KEY,
    labelOf: (c: ScrapCell) => c.defectName ?? NO_DEFECT_LABEL,
    countOf: (c: ScrapCell) => c.rollCount,
    qtyOf: (c: ScrapCell) => c.qty,
  } satisfies BreakdownDim<ScrapCell>,
};

export async function getScrapScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
): Promise<ScrapScorecard> {
  const [cells, produced, detections, dailyRows, prevCells, prevProduced, prevDetections] =
    await Promise.all([
      collectScrap(range),
      producedTotal(range),
      collectDetections(range),
      prisma.$queryRaw<Array<{ day: Date; qty: number | null; cnt: bigint }>>(Prisma.sql`
        SELECT ${factoryDaySql('r."finalizedAt"')} AS day,
               SUM(r."currentQty")::float          AS qty,
               COUNT(*)                            AS cnt
        FROM rolls r
        WHERE r.status = 'SCRAP'
          AND r."finalizedAt" >= ${range.from} AND r."finalizedAt" <= ${range.to}
        GROUP BY 1 ORDER BY 1
      `),
      compareRange ? collectScrap(compareRange) : Promise.resolve<ScrapCell[]>([]),
      compareRange ? producedTotal(compareRange) : Promise.resolve(0),
      compareRange
        ? collectDetections(compareRange)
        : Promise.resolve({ byDefect: [], byStation: [], total: 0, open: 0 }),
    ]);

  const scrapQty = cells.reduce((a, c) => a + c.qty, 0);
  const scrapRollCount = cells.reduce((a, c) => a + c.rollCount, 0);

  const scrapByDefect = buildBreakdown(cells, dims.defect);
  const byItem = buildBreakdown(cells, dims.item);
  const byColor = buildBreakdown(cells, dims.color);
  const bySource = buildBreakdown(cells, dims.source);

  if (compareRange) {
    attachPrev(scrapByDefect, prevCells, dims.defect);
    attachPrev(byItem, prevCells, dims.item);
    attachPrev(byColor, prevCells, dims.color);
    attachPrev(bySource, prevCells, dims.source);
  }

  const prevDefectCount = new Map(prevDetections.byDefect.map((d) => [d.key, d.count]));
  const withPrev = (rows: DetectionCell[], usePrev: boolean): DefectDetectionRow[] =>
    rows.map((r) => ({
      ...r,
      ...(usePrev ? { prevCount: prevDefectCount.get(r.key) ?? 0 } : {}),
    }));

  const summary: ScrapScorecardSummary = {
    scrapQty: round1(scrapQty),
    scrapRollCount,
    producedQty: round1(produced),
    scrapPct: pctOf(scrapQty, produced),
    defectsDetected: detections.total,
    defectsOpen: detections.open,
  };
  if (compareRange) {
    const prevScrap = prevCells.reduce((a, c) => a + c.qty, 0);
    summary.prevScrapQty = round1(prevScrap);
    summary.prevScrapPct = pctOf(prevScrap, prevProduced);
    summary.prevDefectsDetected = prevDetections.total;
  }

  return {
    summary,
    scrapByDefect,
    byItem,
    byColor,
    bySource,
    detectionByStation: withPrev(detections.byStation, false),
    detectionByDefect: withPrev(detections.byDefect, Boolean(compareRange)),
    daily: dailyRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      scrapQty: round1(Number(r.qty ?? 0)),
      scrapCount: Number(r.cnt),
    })),
  };
}
